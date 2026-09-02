/**
 * TEST-E2E-001 — подтверждение посадки в голосовом заказе, живой backend.
 *
 * Что здесь настоящее: frontend, Taxi API, состояние заказа, переходы FSM,
 * оба участника (водитель и пассажир — реальные учётки gruzvill). Ни один
 * endpoint не подменяется: единственное, что мокируется, — тайлы карты, они к
 * проверяемому сценарию отношения не имеют (§4 ТЗ).
 *
 * Что делает браузер: смотрит заказ, откликается, едет, приезжает, вводит код
 * посадки и подтверждает. Backend-вызовы из теста — только подготовка данных и
 * НЕЗАВИСИМАЯ проверка состояния заказа (§19).
 */

import { expect, test } from '@playwright/test'
import { driverAccount, passengerAccount } from './fixtures/accounts'
import {
  boardingCodeOf,
  cancelDriverActiveOrders,
  cancelOrder,
  choosePerformer,
  createVotingOrder,
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
  DRIVER_PAGE,
  PICKUP,
  boardingCodeInput,
  clickPrimaryAction,
  expectUiDriverState,
  isBoardingFormVisible,
  measureUiStateDelay,
  openBoardingForm,
  openDriverMap,
  submitBoardingCode,
} from './fixtures/driverUi'

/**
 * Бюджет на локальную синхронизацию после успешного подтверждения. Заведомо
 * меньше периода опроса активных заказов (5 с) и отложенного refresh (1.5 с):
 * уложиться в него можно только за счёт локального перехода, а не за счёт того,
 * что бэкенд рано или поздно вернёт Started.
 */
const UI_SYNC_BUDGET_MS = 1500

interface IPreparedOrder {
  readonly orderId: string
  readonly boardingCode: string
}

let driver: ISession
let passenger: ISession
let car: ICar
let boardingCode: string
const createdOrders: string[] = []

test.beforeAll(async() => {
  driver = await login(driverAccount(), 'водитель')
  passenger = await login(passengerAccount(), 'пассажир')
  car = await getDriverCar(driver)
  boardingCode = boardingCodeOf(car)
  await goOnline(driver, car, PICKUP)
})

const reason = (error: unknown) => (error as Error)?.message ?? String(error)

test.afterEach(async({}, testInfo) => {
  // §24: при падении нужно, чем разбираться на бэкенде. Печатаются только
  // идентификаторы и состояние заказа — ни токена, ни пароля, ни cookie.
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const orderId of createdOrders) {
      const state = await backendState(orderId).catch(() => undefined)
      const diagnostics = `orderId=${orderId} driverId=${driver?.userId} ` +
        `carId=${car?.c_id} c_state=${state ?? 'unknown'}`
      console.error(`E2E FAILURE DIAGNOSTICS: ${diagnostics}`)
      testInfo.annotations.push({ type: 'backend', description: diagnostics })
    }
  }

  // §22: каждый прогон убирает за собой, аккаунты не зависают. Если отменить не
  // вышло — заказ остаётся живым на бэкенде, поэтому его номер обязан попасть в
  // лог: по нему тестовый заказ можно найти и удалить руками.
  while (createdOrders.length) {
    const orderId = createdOrders.pop() as string
    try {
      await cancelOrder(passenger, orderId)
    } catch (error) {
      console.error(
        `E2E CLEANUP FAILED: orderId=${orderId} — заказ остался на бэкенде, ` +
        `отмените его вручную. Причина: ${reason(error)}`)
      testInfo.annotations.push({ type: 'cleanup-failed', description: `orderId=${orderId}` })
    }
  }
})

test.afterAll(async() => {
  // Подмести то, что осталось от прерванных прогонов: следующий прогон не
  // должен начинаться с водителем, занятым чужим заказом.
  if (!passenger || !driver)
    return
  try {
    const { cancelled, skipped } = await cancelDriverActiveOrders(passenger, driver.userId)
    if (cancelled)
      console.log(`E2E sweep: отменено зависших тестовых заказов — ${cancelled}`)
    if (skipped.length)
      console.warn(
        `E2E sweep: не тронуто заказов — ${skipped.length} (${skipped.join(', ')}). ` +
        'Уборка отменяет только заказы с тестовыми метками.')
  } catch (error) {
    console.error(`E2E SWEEP FAILED: ${reason(error)}`)
  }
})

async function prepareVotingOrder(label: string): Promise<IPreparedOrder> {
  const orderId = await createVotingOrder(passenger, {
    pickup: PICKUP,
    destination: DESTINATION,
    driverId: driver.userId,
    carClassId: car.cc_id,
    label,
  })
  createdOrders.push(orderId)
  return { orderId, boardingCode }
}

/** Состояние заказа на бэкенде — независимая от UI проверка (§13). */
async function backendState(orderId: string): Promise<number | undefined> {
  const order = await readOrder(driver, orderId)
  return driverStateOf(order, driver.userId)
}

async function expectBackendState(orderId: string, state: number, message: string): Promise<void> {
  await expect.poll(() => backendState(orderId), { message, timeout: 90_000 }).toBe(state)
}

/**
 * Довести заказ до состояния «водитель у пассажира, ждём код посадки»:
 * отклик водителя и «Поехал»/«Приехал» — кликами в браузере, выбор водителя —
 * действием пассажира.
 */
async function driveToBoarding(page: import('@playwright/test').Page, orderId: string): Promise<void> {
  await page.goto(`/driver-order/${orderId}?driverEmulator=1`)

  // STEP 3 — отклик на голосовой заказ через интерфейс.
  const take = page.getByTestId('driver-order-take')
  await expect(take, 'карточка голосового заказа с кнопкой отклика').toBeVisible({ timeout: 120_000 })
  await take.click()

  await expectBackendState(orderId, DRIVER_STATE.Considering, 'водитель стал кандидатом')

  // Пассажир выбирает этого водителя — его часть сценария, не водительская.
  await choosePerformer(passenger, orderId, driver.userId)
  await expectBackendState(orderId, DRIVER_STATE.Performer, 'пассажир выбрал водителя')

  await openDriverMap(page)
  await expectUiDriverState(page, DRIVER_STATE.Performer, 'карта показывает принятый заказ')

  // STEP 4 — «Поехал» и «Приехал» кликами.
  await clickPrimaryAction(page)
  await expectBackendState(orderId, DRIVER_STATE.Arrived, 'водитель выехал/прибыл')
  await expectUiDriverState(page, DRIVER_STATE.Arrived, 'карта показывает прибытие')
}

test.describe('TEST-E2E-001 — посадка по коду в голосовом заказе', () => {

  test.beforeEach(async({ context }) => {
    await context.setGeolocation(PICKUP)
    // Единственный допустимый мок (§4): тайлы карты. К посадке отношения не имеют.
    await context.route(/tile\.openstreetmap|tiles?\..*\/\d+\/\d+\/\d+\.png/, route =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }))
  })

  test('A: правильный код переводит заказ и интерфейс в Started', async({ page }) => {
    const { orderId } = await prepareVotingOrder('A')
    await driveToBoarding(page, orderId)

    // STEP 5-6 — форма кода посадки и настоящий код водителя.
    await openBoardingForm(page)
    await submitBoardingCode(page, boardingCode)

    // STEP 9 — то, ради чего тест написан. Замер обязателен: дефект был не в том,
    // что интерфейс НИКОГДА не догонит бэкенд, а в том, что он догонял его только
    // следующим опросом списка заказов. Без верхней границы тест проходит и на
    // сломанном коде — проверено инъекцией регрессии.
    const delay = await measureUiStateDelay(page, DRIVER_STATE.Started, UI_SYNC_BUDGET_MS)
    test.info().annotations.push({ type: 'ui-sync', description: `${delay} ms` })
    expect(await isBoardingFormVisible(page), 'форма кода посадки закрылась').toBe(false)

    // STEP 8 — backend как независимое подтверждение.
    await expectBackendState(orderId, DRIVER_STATE.Started, 'бэкенд перевёл заказ в Started')
  })

  test('B: некорректный код не переводит заказ в Started', async({ page }) => {
    const { orderId } = await prepareVotingOrder('B')
    await driveToBoarding(page, orderId)

    await openBoardingForm(page)
    // Код заведомо неверной формы: приложение отклоняет его само и до бэкенда
    // команда не доходит.
    await submitBoardingCode(page, '12')

    expect(await backendState(orderId), 'заказ не ушёл в Started').not.toBe(DRIVER_STATE.Started)
    await expect(boardingCodeInput(page), 'карточка осталась в режиме посадки').toBeVisible()
    expect(await backendState(orderId)).toBe(DRIVER_STATE.Arrived)
  })

  test('C: двойное подтверждение не ломает состояние заказа', async({ page }) => {
    const { orderId } = await prepareVotingOrder('C')
    await driveToBoarding(page, orderId)

    await openBoardingForm(page)
    const input = boardingCodeInput(page)
    await input.fill(boardingCode)

    const confirm = page.getByTestId('driver-boarding-confirm')
    // Два клика подряд, без ожидания результата первого.
    await confirm.click()
    await confirm.click({ force: true }).catch(() => undefined)

    await expectBackendState(orderId, DRIVER_STATE.Started, 'заказ ровно один раз ушёл в Started')
    await expectUiDriverState(page, DRIVER_STATE.Started, 'интерфейс показывает Started')
  })

  test('D: после перезагрузки страница остаётся в Started', async({ page }) => {
    const { orderId } = await prepareVotingOrder('D')
    await driveToBoarding(page, orderId)

    await openBoardingForm(page)
    await submitBoardingCode(page, boardingCode)
    await expectBackendState(orderId, DRIVER_STATE.Started, 'бэкенд перевёл заказ в Started')

    await page.goto(DRIVER_PAGE)

    // Проверяет, что исправление — не только локальный optimistic state.
    await expectUiDriverState(page, DRIVER_STATE.Started, 'после перезагрузки интерфейс всё ещё Started')
    expect(await isBoardingFormVisible(page), 'подтверждение кода не вернулось').toBe(false)
  })

})
