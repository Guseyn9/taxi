/**
 * TEST-E2E-011 — водитель прерывает поездку до назначения.
 *
 * Живые frontend/backend/FSM. Отмена выполняется только через UI карты и
 * диалог причины; API используется для предусловий, независимого readback и
 * уборки. Единственный сетевой мок — тайлы карты.
 */
import { BrowserContext, Page, devices, expect, test } from '@playwright/test'
import { appUrl, driverAccount, passengerAccount } from './fixtures/accounts'
import { expectAppBooted, stubMapTiles } from './fixtures/appShell'
import {
  cancelOrder,
  cancelTestOrders,
  createStandardOrder,
  driverStateOf,
  DRIVER_STATE,
  getDriverCar,
  goOnline,
  ICar,
  ISession,
  login,
  readOrder,
} from './fixtures/taxiApi'
import {
  DRIVER_STORAGE,
  PICKUP,
  clickPrimaryAction,
  driverMapAction,
  expectDriverMapState,
  openOrderCard,
  takeOrderButton,
} from './fixtures/driverUi'

test.describe.configure({ timeout: 8 * 60 * 1000 })

const LABEL = 'E2E011_DRIVER_INTERRUPT'
const ROUTE_DESTINATION = {
  latitude: PICKUP.latitude + 0.0048,
  longitude: PICKUP.longitude + 0.0192,
}

let driver: ISession
let passenger: ISession
let car: ICar
let driverContext: BrowserContext
let driverPage: Page
const createdOrders: string[] = []

const reasonText = (error: unknown) => (error as Error)?.message ?? String(error)

async function backendState(orderId: string): Promise<number | undefined> {
  return driverStateOf(await readOrder(driver, orderId), driver.userId)
}

async function expectBackendState(orderId: string, state: number, message: string): Promise<void> {
  await expect.poll(
    () => backendState(orderId),
    { message, timeout: 90_000, intervals: [250, 500, 1000] },
  ).toBe(state)
}

async function openSession(browser: import('@playwright/test').Browser, storageState: string) {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    storageState,
    baseURL: appUrl(),
    locale: 'ru-RU',
    permissions: ['geolocation'],
    geolocation: PICKUP,
  })
  context.setDefaultTimeout(30_000)
  context.setDefaultNavigationTimeout(60_000)
  await stubMapTiles(context)
  return context
}

test.beforeAll(async({ browser }) => {
  driver = await login(driverAccount(), 'водитель')
  passenger = await login(passengerAccount(), 'пассажир')
  car = await getDriverCar(driver)
  await goOnline(driver, car, PICKUP)
  await cancelTestOrders(passenger)

  driverContext = await openSession(browser, DRIVER_STORAGE)
  driverPage = await driverContext.newPage()
})

test.afterEach(async({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const orderId of createdOrders) {
      const order = await readOrder(driver, orderId).catch(() => undefined)
      const state = order ? driverStateOf(order, driver.userId) : undefined
      const diagnostic = `TEST-E2E-011 orderId=${orderId} driverId=${driver.userId} ` +
        `c_state=${state ?? 'unknown'} b_state=${order?.b_state ?? 'unknown'}`
      console.error(diagnostic)
      testInfo.annotations.push({ type: 'backend', description: diagnostic })
    }
  }

  while (createdOrders.length) {
    const orderId = createdOrders.pop() as string
    try {
      // Не отправляем отмену повторно после того, как сценарий уже подтвердил
      // конечное Canceled-состояние на backend.
      if (await backendState(orderId) !== DRIVER_STATE.Canceled)
        await cancelOrder(passenger, orderId)
    } catch (error) {
      const message = `TEST-E2E-011 cleanup failed: orderId=${orderId}: ${reasonText(error)}`
      console.error(message)
      testInfo.annotations.push({ type: 'cleanup-failed', description: message })
    }
  }
})

test.afterAll(async() => {
  await driverContext?.close()
  if (passenger)
    await cancelTestOrders(passenger).catch(error => console.error(
      `TEST-E2E-011 sweep failed: ${reasonText(error)}`,
    ))
})

test('прерывание до назначения: Started → Canceled через UI водителя с причиной', async() => {
  const orderId = await createStandardOrder(passenger, {
    pickup: PICKUP,
    destination: ROUTE_DESTINATION,
    driverId: driver.userId,
    carClassId: car.cc_id,
    label: LABEL,
  })
  createdOrders.push(orderId)

  const created = await readOrder(passenger, orderId)
  expect(created.b_id, 'backend вернул созданный заказ').toBe(orderId)

  // Назначение — настоящее действие водителя через UI.
  await openOrderCard(driverPage, orderId)
  const take = takeOrderButton(driverPage)
  await expect(take).toBeVisible({ timeout: 90_000 })
  await expect(take).toBeEnabled()
  await take.click()
  await expectBackendState(orderId, DRIVER_STATE.Performer, 'водитель назначен исполнителем')

  await driverPage.goto('/driver-order?tab=map&driverEmulator=1')
  await expectAppBooted(driverPage)
  await expectDriverMapState(driverPage, orderId, DRIVER_STATE.Performer, 'карта показывает назначенный заказ')
  await clickPrimaryAction(driverPage)
  await expectBackendState(orderId, DRIVER_STATE.Arrived, 'водитель выехал')
  await expectDriverMapState(driverPage, orderId, DRIVER_STATE.Arrived, 'карта показывает Arrived')
  await clickPrimaryAction(driverPage)
  await expectBackendState(orderId, DRIVER_STATE.Started, 'поездка началась')
  await expectDriverMapState(driverPage, orderId, DRIVER_STATE.Started, 'карта показывает Started')

  const interruptAction = driverMapAction(driverPage, orderId)
  await expect(interruptAction).toBeVisible()
  await expect(interruptAction, 'до прибытия к назначению доступно прерывание')
    .toHaveClass(/finish-drive-button--interrupted/)

  // Слушаем реальный запрос до подтверждения в модальном окне.
  const cancelRequests: Array<{ url: string, body: string }> = []
  const onRequest = (request: import('@playwright/test').Request) => {
    if (request.method() !== 'POST')
      return
    const pathname = new URL(request.url()).pathname
    if (pathname.endsWith(`/drive/get/${orderId}`) ||
        pathname.endsWith(`/api/commands/taxi/order/${orderId}`)) {
      cancelRequests.push({ url: request.url(), body: request.postData() ?? '' })
    }
  }
  driverPage.on('request', onRequest)

  const modal = driverPage.locator('.cancel-order-modal').filter({ visible: true }).first()
  try {
    await interruptAction.click()
    await expect(modal, 'открылся диалог причины прерывания').toBeVisible()
    const reasons = modal.locator('.reason-item')
    await expect(reasons, 'доступен список причин').toHaveCount(6, { timeout: 30_000 })
    // Выбираем не первый вариант, чтобы проверить передачу пользовательского выбора.
    await reasons.nth(1).click()
    const selectedReason = (await reasons.nth(1).innerText()).trim()
    expect(selectedReason, 'выбранная причина непустая').not.toBe('')

    await modal.getByText('Прервать поездку', { exact: true }).click()

    await expect(modal, 'диалог закрылся после подтверждения').toBeHidden({ timeout: 90_000 })
    await expectBackendState(orderId, DRIVER_STATE.Canceled, 'backend подтвердил Canceled после UI-подтверждения')

    expect(cancelRequests.length, 'браузер отправил настоящий lifecycle-запрос отмены').toBeGreaterThan(0)
    expect(
      cancelRequests.some(request => request.body.includes(selectedReason)),
      'выбранная причина передана в запросе backend',
    ).toBeTruthy()

    await expect(interruptAction, 'активное действие прерванной поездки исчезло с карты')
      .toHaveCount(0, { timeout: 90_000 })
  } finally {
    driverPage.off('request', onRequest)
  }
})
