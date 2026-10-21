/**
 * TEST-E2E-010 — штатное завершение поездки водителем.
 *
 * Живой frontend / Taxi API / backend FSM. API используется только для
 * предусловий, независимого readback и уборки; завершение инициируется кликом
 * по штатной кнопке карты водителя.
 */
import { BrowserContext, Page, Request, devices, expect, test } from '@playwright/test'
import { appUrl, driverAccount, passengerAccount } from './fixtures/accounts'
import { stubMapTiles } from './fixtures/appShell'
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
  DESTINATION,
  DRIVER_STORAGE,
  PICKUP,
  clickPrimaryAction,
  driverMapAction,
  expectDriverMapState,
  openOrderCard,
  switchToDriverMap,
  takeOrderButton,
} from './fixtures/driverUi'
import { PASSENGER_STORAGE } from './fixtures/passengerUi'

test.describe.configure({ timeout: 8 * 60 * 1000 })

const LABEL = 'E2E010_FINISH'

let driver: ISession
let passenger: ISession
let car: ICar
let driverContext: BrowserContext
let passengerContext: BrowserContext
let driverPage: Page
const createdOrders: string[] = []

const reason = (error: unknown) => (error as Error)?.message ?? String(error)

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

async function backendState(orderId: string): Promise<number | undefined> {
  return driverStateOf(await readOrder(driver, orderId), driver.userId)
}

async function expectBackendState(orderId: string, state: number, message: string): Promise<void> {
  await expect.poll(() => backendState(orderId), { message, timeout: 90_000, intervals: [250, 500, 1000] }).toBe(state)
}

test.beforeAll(async({ browser }) => {
  driver = await login(driverAccount(), 'водитель')
  passenger = await login(passengerAccount(), 'пассажир')
  car = await getDriverCar(driver)
  await goOnline(driver, car, PICKUP)
  await cancelTestOrders(passenger)

  passengerContext = await openSession(browser, PASSENGER_STORAGE)
  driverContext = await openSession(browser, DRIVER_STORAGE)
  driverPage = await driverContext.newPage()
})

test.afterEach(async({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const orderId of createdOrders) {
      const order = await readOrder(driver, orderId).catch(() => undefined)
      const state = order ? driverStateOf(order, driver.userId) : undefined
      const diagnostic = `TEST-E2E-010 orderId=${orderId} driverId=${driver.userId} ` +
        `c_state=${state ?? 'unknown'} b_state=${order?.b_state ?? 'unknown'}`
      console.error(diagnostic)
      testInfo.annotations.push({ type: 'backend', description: diagnostic })
    }
  }

  while (createdOrders.length) {
    const orderId = createdOrders.pop() as string
    try {
      // A completed order is already terminal; do not send a cancellation
      // command after the behaviour under test has succeeded.
      if (await backendState(orderId) !== DRIVER_STATE.Finished)
        await cancelOrder(passenger, orderId)
    } catch (error) {
      const message = `TEST-E2E-010 cleanup failed: orderId=${orderId}: ${reason(error)}`
      console.error(message)
      testInfo.annotations.push({ type: 'cleanup-failed', description: message })
    }
  }
})

test.afterAll(async() => {
  await passengerContext?.close()
  await driverContext?.close()
  if (passenger)
    await cancelTestOrders(passenger).catch(error => console.error(`TEST-E2E-010 sweep failed: ${reason(error)}`))
})

test('штатное завершение: Started → Finished через кнопку карты водителя', async() => {
  const orderId = await createStandardOrder(passenger, {
    pickup: PICKUP,
    destination: DESTINATION,
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

  // «Поехал» и «Приехал» — клики на карте. Стандартный заказ не требует кода посадки.
  await switchToDriverMap(driverPage)
  await expectDriverMapState(driverPage, orderId, DRIVER_STATE.Performer, 'карта показывает назначенный заказ')
  await clickPrimaryAction(driverPage)
  await expectBackendState(orderId, DRIVER_STATE.Arrived, 'водитель выехал')
  await expectDriverMapState(driverPage, orderId, DRIVER_STATE.Arrived, 'карта показывает Arrived')
  await clickPrimaryAction(driverPage)
  await expectBackendState(orderId, DRIVER_STATE.Started, 'поездка началась')
  await expectDriverMapState(driverPage, orderId, DRIVER_STATE.Started, 'карта показывает Started')

  const finishAction = driverMapAction(driverPage, orderId)
  await expect(finishAction).toBeVisible()
  await expect(finishAction, 'до прибытия к назначению кнопка ведёт к прерыванию, а не к завершению')
    .toHaveClass(/finish-drive-button--interrupted/)

  // Меняем геопозицию браузера через штатный Playwright geolocation provider.
  // Это внешний GPS-вход приложения, не изменение состояния заказа/FSM.
  await driverContext.setGeolocation(DESTINATION)
  await expect(finishAction, 'после достижения назначения доступно штатное завершение')
    .not.toHaveClass(/finish-drive-button--interrupted/, { timeout: 120_000 })

  const lifecycleRequests: Request[] = []
  const onRequest = (request: Request) => {
    if (request.method() !== 'POST')
      return
    const pathname = new URL(request.url()).pathname
    if (pathname.endsWith(`/drive/get/${orderId}`) ||
        pathname.endsWith(`/api/commands/taxi/order/${orderId}`))
      lifecycleRequests.push(request)
  }
  driverPage.on('request', onRequest)
  try {
    await expect(finishAction).toBeEnabled()
    const commandRequest = driverPage.waitForRequest(request =>
      request.method() === 'POST' &&
      (new URL(request.url()).pathname.endsWith(`/drive/get/${orderId}`) ||
       new URL(request.url()).pathname.endsWith(`/api/commands/taxi/order/${orderId}`)),
    { timeout: 30_000 })
    await finishAction.click()
    const request = await commandRequest
    const response = await request.response()
    expect(response, 'запрос завершения получил HTTP-ответ').toBeTruthy()
    expect([200, 202], 'legacy API или Command API принял запрос завершения')
      .toContain(response?.status())

    await expectBackendState(orderId, DRIVER_STATE.Finished, 'backend подтвердил Finished после UI-клика')
    expect(lifecycleRequests).toHaveLength(1)

    await expect(finishAction, 'карта больше не показывает активное действие этого заказа')
      .toBeHidden({ timeout: 90_000 })
    expect(await backendState(orderId), 'конечное состояние остаётся Finished').toBe(DRIVER_STATE.Finished)
  } finally {
    driverPage.off('request', onRequest)
  }
})
