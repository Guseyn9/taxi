/**
 * TEST-E2E-001 — подтверждение посадки в голосовом заказе, живой backend.
 *
 * Что здесь настоящее: frontend, Taxi API, состояние заказа, переходы FSM,
 * оба участника (водитель и пассажир — реальные учётки gruzvill). Ни один
 * endpoint не подменяется: единственное, что мокируется, — тайлы карты, они к
 * проверяемому сценарию отношения не имеют (§4 ТЗ).
 * Сценарий восстановления после неподтверждённого ответа запускается только
 * с локальными адресами приложения и Core и подменяет один ответ проверки кода.
 *
 * Что делает браузер: смотрит заказ, откликается, едет, приезжает, вводит код
 * посадки и подтверждает. Backend-вызовы из теста — только подготовка данных и
 * НЕЗАВИСИМАЯ проверка состояния заказа (§19).
 */

import { expect } from '@playwright/test'
import { test } from './fixtures/tabSession'
import { apiBase, appUrl, driverAccount, passengerAccount } from './fixtures/accounts'
import { expectAppBooted } from './fixtures/appShell'
import {
  boardingCodeOf,
  cancelOrder,
  cancelTestOrders,
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
  boardingConfirmButton,
  boardingCodeInput,
  departAndArrive,
  expectUiDriverState,
  isBoardingFormVisible,
  measureUiStateDelay,
  openBoardingForm,
  openDriverMap,
  submitBoardingCode,
  withBoardingDiagnostics,
  messageModalStatus,
} from './fixtures/driverUi'
import {slowPassengerNetwork} from './fixtures/passengerUi'

/**
 * Бюджет на локальную синхронизацию после успешного подтверждения. Заведомо
 * меньше периода опроса активных заказов (5 с) и отложенного refresh (1.5 с):
 * уложиться в него можно только за счёт локального перехода, а не за счёт того,
 * что бэкенд рано или поздно вернёт Started.
 */
const UI_SYNC_BUDGET_MS = 1500

interface IPreparedOrder {
  readonly orderId: string
}

let driver: ISession
let passenger: ISession
let car: ICar
const createdOrders: string[] = []

test.beforeAll(async() => {
  driver = await login(driverAccount(), 'водитель')
  passenger = await login(passengerAccount(), 'пассажир')
  const { cancelled, skipped } = await cancelTestOrders(passenger)
  if (cancelled || skipped.length)
    console.log(`E2E sweep перед проверкой посадки: отменено ${cancelled}, пропущено ${skipped.length}`)
  car = await getDriverCar(driver)
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
  // Подмести тестовые заказы, оставшиеся от прерванных прогонов: следующий
  // прогон не должен начинаться с водителем, занятым таким заказом.
  if (!passenger)
    return
  try {
    const { cancelled, skipped } = await cancelTestOrders(passenger)
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
  return { orderId }
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
  await page.goto(`/driver-order/${orderId}`)
  // Без этой проверки сбой загрузки конфигурации приложения выглядит как
  // «кнопка отклика не появилась»: на экране «Database is unavailable» её и
  // правда нет. См. e2e/fixtures/appShell.ts.
  await expectAppBooted(page)

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
  await departAndArrive(page)
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
    await withBoardingDiagnostics(page, orderId, async actions => {
      await openBoardingForm(page)
      await submitBoardingCode(page, boardingCodeOf(await readOrder(passenger, orderId)))
      // Start the UI budget after the server acknowledges the transition.
      await expect.poll(() => actions.of(orderId, 'set_start_state').some(item => item.status === 'success')).toBe(true)
      const delay = await measureUiStateDelay(page, DRIVER_STATE.Started, UI_SYNC_BUDGET_MS)
      test.info().annotations.push({ type: 'ui-sync', description: `${delay} ms` })
      expect(await isBoardingFormVisible(page), 'форма кода посадки закрылась').toBe(false)
      await expectBackendState(orderId, DRIVER_STATE.Started, 'бэкенд перевёл заказ в Started')
    })
  })

  test('Локально: неподтверждённая проверка кода сохраняет заказ до успешного повтора', async({ page }) => {
    test.skip(
      [appUrl(), apiBase()].some(url => new URL(url).hostname !== '127.0.0.1'),
      'Подмена ответа проверки кода допускается только на изолированном локальном Core',
    )
    const { orderId } = await prepareVotingOrder('unconfirmed-boarding')
    await driveToBoarding(page, orderId)
    const code = boardingCodeOf(await readOrder(passenger, orderId))
    const orderUrl = new URL(`drive/get/${orderId}`, apiBase().replace(/\/?$/, '/')).href
    let unconfirmedResponses = 0
    await page.route(orderUrl, async route => {
      const request = route.request()
      const body = request.postData() ?? ''
      if (request.method() === 'POST' && /name="action"\r?\n\r?\ncheck_driver_code\r?\n/.test(body)) {
        unconfirmedResponses += 1
        await route.fulfill({ status: 200, json: {}, headers: { 'access-control-allow-origin': '*' } })
      } else {
        await route.continue()
      }
    })

    await withBoardingDiagnostics(page, orderId, async actions => {
      await openBoardingForm(page)
      await submitBoardingCode(page, code)
      await expect(page.getByText('Сервис не подтвердил проверку кода посадки.', { exact: false })).toBeVisible()
      await expect(boardingCodeInput(page)).toBeVisible()
      await expect(boardingConfirmButton(page)).toBeEnabled()
      expect(unconfirmedResponses).toBe(1)
      expect(actions.of(orderId, 'set_start_state')).toHaveLength(0)
      expect(await backendState(orderId)).toBe(DRIVER_STATE.Arrived)

      await page.unroute(orderUrl)
      await submitBoardingCode(page, code)
      await expectBackendState(orderId, DRIVER_STATE.Started, 'Core подтвердил повторную проверку и старт')
      await expectUiDriverState(page, DRIVER_STATE.Started, 'карта обновилась после успешного повтора')
      expect(actions.of(orderId, 'check_driver_code')).toHaveLength(2)
      expect(actions.of(orderId, 'set_start_state')).toHaveLength(1)
    })
  })

  test('B: некорректный код не переводит заказ в Started', async({ page }) => {
    const { orderId } = await prepareVotingOrder('B')
    await driveToBoarding(page, orderId)

    await withBoardingDiagnostics(page, orderId, async actions => {
      await openBoardingForm(page)
      const correct = boardingCodeOf(await readOrder(passenger, orderId))
      await submitBoardingCode(page, correct === '9' ? '8' : '9')
      await expect.poll(async() =>
        (await page.getByRole('alert').count()) > 0 || await messageModalStatus(page) === 'fail',
      { message: 'неверный код показан ошибкой' }).toBe(true)
      expect(actions.of(orderId, 'set_start_state').length, 'локально отклонённый код не начинает поездку').toBe(0)
      expect(await backendState(orderId), 'заказ не ушёл в Started').not.toBe(DRIVER_STATE.Started)
      await expect(boardingCodeInput(page), 'карточка осталась в режиме посадки').toBeVisible()
      expect(await backendState(orderId)).toBe(DRIVER_STATE.Arrived)
    })
  })

  test('C: двойное подтверждение не ломает состояние заказа', async({ page }) => {
    const { orderId } = await prepareVotingOrder('C')
    await driveToBoarding(page, orderId)

    await withBoardingDiagnostics(page, orderId, async actions => {
      await openBoardingForm(page)
      await boardingCodeInput(page).fill(boardingCodeOf(await readOrder(passenger, orderId)))
      const confirm = page.getByTestId('driver-boarding-confirm')
      const restoreNetwork = await slowPassengerNetwork(page, 1_500)
      try {
        await confirm.click()
        await confirm.click({ force: true })
      } finally {
        await restoreNetwork()
      }
      await expectBackendState(orderId, DRIVER_STATE.Started, 'заказ ровно один раз ушёл в Started')
      expect(actions.of(orderId, 'set_start_state').length, 'двойной клик отправил одну команду Start').toBe(1)
      await expectUiDriverState(page, DRIVER_STATE.Started, 'интерфейс показывает Started')
    })
  })

  test('D: после перезагрузки страница остаётся в Started', async({ page }) => {
    const { orderId } = await prepareVotingOrder('D')
    await driveToBoarding(page, orderId)

    await withBoardingDiagnostics(page, orderId, async() => {
      await openBoardingForm(page)
      await submitBoardingCode(page, boardingCodeOf(await readOrder(passenger, orderId)))
      await expectBackendState(orderId, DRIVER_STATE.Started, 'бэкенд перевёл заказ в Started')
      await page.goto(DRIVER_PAGE)
      await expectUiDriverState(page, DRIVER_STATE.Started, 'после перезагрузки интерфейс всё ещё Started')
      expect(await isBoardingFormVisible(page), 'подтверждение кода не вернулось').toBe(false)
    })
  })

})
