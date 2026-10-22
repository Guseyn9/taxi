/**
 * TEST-E2E-012 — пассажир отменяет Standard до назначения водителя.
 *
 * Заказ создаётся через настоящую форму пассажира, чтобы интерфейс находился
 * в состоянии submitted/locked и показывал штатную кнопку отмены. Отмена —
 * только пользовательскими кликами; API используется для readback и cleanup.
 */
import { BrowserContext, expect, test } from '@playwright/test'
import { appUrl, passengerAccount, passengerPhone } from './fixtures/accounts'
import { stubMapTiles } from './fixtures/appShell'
import { PICKUP } from './fixtures/driverUi'
import {
  PASSENGER_PAGE,
  PASSENGER_STORAGE,
  PASSENGER_ORDER_POINTS,
  cancelAssignedOrder,
  expandPassengerOrderForm,
  expectPassengerOrderCreated,
  fillPassengerOrderPoints,
  fillPassengerPhone,
  miniOrderCard,
  openPassengerOrderForm,
  orderCancelOpenButton,
  submitPassengerOrder,
  watchCancelRequests,
  waitForCancelResponse,
  watchOrderCreationRequest,
} from './fixtures/passengerUi'
import {
  ISession,
  cancelOrder,
  isOrderActiveFor,
  login,
  readOrder,
} from './fixtures/taxiApi'

test.describe.configure({ timeout: 4 * 60 * 1000 })

const ORDER_STATE = { Processing: 1, Canceled: 3 } as const
let passenger: ISession
let context: BrowserContext
const createdOrderIds: string[] = []

test.beforeAll(async({ browser }) => {
  passenger = await login(passengerAccount(), 'TEST-E2E-012 пассажир')
  context = await browser.newContext({
    baseURL: appUrl(),
    storageState: PASSENGER_STORAGE,
    locale: 'ru-RU',
    permissions: ['geolocation'],
    geolocation: PICKUP,
  })
  context.setDefaultTimeout(30_000)
  context.setDefaultNavigationTimeout(60_000)
  await stubMapTiles(context)
})

test.afterEach(async({}, testInfo) => {
  while (createdOrderIds.length) {
    const orderId = createdOrderIds.pop() as string
    try {
      await cancelOrder(passenger, orderId)
    } catch (error) {
      const message = (error as Error)?.message ?? String(error)
      const snapshot = await readOrder(passenger, orderId).catch(() => undefined)
      if (Number(snapshot?.b_state) !== ORDER_STATE.Canceled) {
        const diagnostic = `orderId=${orderId}; b_state=${snapshot?.b_state ?? 'unknown'}; cleanup=${message}`
        console.error(`E2E CLEANUP FAILED: ${diagnostic}`)
        testInfo.annotations.push({ type: 'cleanup-failed', description: diagnostic })
      }
    }
  }
})

test.afterAll(async() => {
  await context?.close()
})

test('пассажир отменяет Standard до назначения водителя через UI', async() => {
  const page = await context.newPage()
  let orderId: string | undefined
  try {
    await openPassengerOrderForm(page)
    await expandPassengerOrderForm(page)
    await fillPassengerOrderPoints(page, PASSENGER_ORDER_POINTS.pickup, PASSENGER_ORDER_POINTS.destination)
    await fillPassengerPhone(page, passengerPhone())

    const creation = watchOrderCreationRequest(page)
    try {
      await submitPassengerOrder(page, 'order')
      const result = await creation.waitForCreated()
      expect(result.status, 'создание Standard принято backend').toBe(200)
      expect(result.body?.status, 'backend вернул успешное создание').toBe('success')
      orderId = result.orderId
      createdOrderIds.push(orderId)
      expect(creation.requests, 'форма отправила ровно один запрос создания').toHaveLength(1)
    } finally {
      creation.dispose()
    }

    const before = await readOrder(passenger, orderId)
    expect(String(before.b_id)).toBe(orderId)
    expect(Number(before.b_state), 'Standard находится в поиске').toBe(ORDER_STATE.Processing)
    expect(before.drivers ?? [], 'до отмены водитель не назначен').toHaveLength(0)
    expect(await isOrderActiveFor(passenger, orderId)).toBe(true)
    await expectPassengerOrderCreated(page, orderId)

    const cancelButton = orderCancelOpenButton(page)
    await expect(cancelButton, 'штатная кнопка отмены доступна в заблокированной форме заказа')
      .toBeVisible({ timeout: 30_000 })
    await expect(cancelButton).toBeEnabled()

    const requests = watchCancelRequests(page, orderId)
    const responsePromise = waitForCancelResponse(page, orderId)
    await cancelAssignedOrder(page)
    const response = await responsePromise

    expect(response.status, 'HTTP-ответ отмены').toBe(200)
    expect(response.body?.status, 'backend принял отмену').toBe('success')
    expect(requests, 'UI отправил ровно одну команду отмены').toHaveLength(1)
    expect(requests[0].action).toBe('set_cancel_state')
    expect(requests[0].hasToken).toBe(true)

    await expect.poll(async() => Number((await readOrder(passenger, orderId!)).b_state), {
      message: 'backend перевёл заказ в Canceled',
      timeout: 90_000,
      intervals: [250, 500, 1000],
    }).toBe(ORDER_STATE.Canceled)

    expect(await isOrderActiveFor(passenger, orderId)).toBe(false)
    await expect(miniOrderCard(page, orderId)).toHaveCount(0, { timeout: 90_000 })
    expect(Number((await readOrder(passenger, orderId)).b_state)).toBe(ORDER_STATE.Canceled)
  } finally {
    await page.close()
  }
})
