/**
 * TEST-E2E-012 — пассажир отменяет стандартный заказ до назначения водителя.
 *
 * Заказ создаётся API только как предусловие. Само действие отмены выполняется
 * через настоящую кнопку пассажира и подтверждение в модальном окне. Backend
 * проверяется отдельным чтением; отмена через API допустима только в cleanup.
 */
import { BrowserContext, expect, test } from '@playwright/test'
import { appUrl, passengerAccount } from './fixtures/accounts'
import { expectAppBooted, stubMapTiles } from './fixtures/appShell'
import {
  ISession,
  cancelOrder,
  createStandardOrder,
  isOrderActiveFor,
  login,
  readOrder,
} from './fixtures/taxiApi'
import {
  PASSENGER_PAGE,
  PASSENGER_STORAGE,
  cancelAssignedOrder,
  miniOrderCard,
  orderCancelOpenButton,
  watchCancelRequests,
  waitForCancelResponse,
} from './fixtures/passengerUi'
import { PICKUP, DESTINATION } from './fixtures/driverUi'

test.describe.configure({ timeout: 4 * 60 * 1000 })

const ORDER_STATE = { Processing: 1, Canceled: 3 } as const
const LABEL = 'E2E012'

let passenger: ISession
let context: BrowserContext
const createdOrderIds: string[] = []

test.beforeAll(async({ browser }) => {
  passenger = await login(passengerAccount(), 'TEST-E2E-012 пассажир')
  context = await browser.newContext({
    baseURL: appUrl(),
    storageState: PASSENGER_STORAGE,
    locale: 'ru-RU',
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
      // Заказ, отменённый сценарием, уже терминален; повторная отмена ожидаемо
      // отклоняется backend. Другие ошибки cleanup должны быть видны в CI.
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

test('пассажир отменяет стандартный заказ до назначения водителя', async() => {
  const orderId = await createStandardOrder(passenger, {
    pickup: PICKUP,
    destination: DESTINATION,
    label: LABEL,
    maxWaitingSeconds: 900,
  })
  createdOrderIds.push(orderId)

  const before = await readOrder(passenger, orderId)
  expect(String(before.b_id), 'создан и читается именно тестовый заказ').toBe(orderId)
  expect(Number(before.b_state), 'стандартный заказ находится в поиске').toBe(ORDER_STATE.Processing)
  expect(before.drivers ?? [], 'до отмены у заказа нет водителей').toHaveLength(0)
  expect(await isOrderActiveFor(passenger, orderId), 'до отмены заказ активен').toBe(true)

  const page = await context.newPage()
  try {
    await page.goto(PASSENGER_PAGE)
    await expectAppBooted(page)
    await expect(miniOrderCard(page, orderId), 'пассажир видит именно свой заказ').toBeVisible({ timeout: 90_000 })

    const cancelButton = orderCancelOpenButton(page)
    await expect(cancelButton, 'на экране заказа доступна основная кнопка «Отменить»')
      .toBeVisible({ timeout: 90_000 })
    await expect(cancelButton, 'кнопка отмены доступна для заказа без назначенного водителя')
      .toBeEnabled({ timeout: 30_000 })

    // Наблюдение начинается до кликов: API-команда не вызывается из теста.
    const requests = watchCancelRequests(page, orderId)
    const responsePromise = waitForCancelResponse(page, orderId)
    await cancelAssignedOrder(page)
    const response = await responsePromise

    expect(response.status, 'HTTP-ответ отмены').toBe(200)
    expect(response.body?.status, 'backend принял отмену').toBe('success')
    expect(requests, 'кнопка отправила ровно одну команду отмены').toHaveLength(1)
    expect(requests[0].action).toBe('set_cancel_state')
    expect(requests[0].hasToken, 'запрос содержит сессию пассажира').toBe(true)

    await expect.poll(async() => Number((await readOrder(passenger, orderId)).b_state), {
      message: 'backend перевёл заказ в терминальное Canceled',
      timeout: 90_000,
      intervals: [250, 500, 1000],
    }).toBe(ORDER_STATE.Canceled)

    expect(await isOrderActiveFor(passenger, orderId), 'отменённый заказ больше не активен').toBe(false)
    await expect(miniOrderCard(page, orderId), 'отменённый заказ исчез из активного списка пассажира')
      .toHaveCount(0, { timeout: 90_000 })

    const after = await readOrder(passenger, orderId)
    expect(Number(after.b_state), 'терминальное состояние сохраняется при повторном чтении')
      .toBe(ORDER_STATE.Canceled)
  } finally {
    await page.close()
  }
})
