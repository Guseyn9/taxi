/**
 * TEST-E2E-007 — А.1.6, Passenger SOS after Started. Живой backend.
 *
 * Сценарий (ТЗ `tasks/ТЗ-Passenger-SOS.txt`, §8):
 *
 *   создание заказа → Driver берёт заказ → Passenger выбирает водителя →
 *   Driver Arrived → код посадки → Started → Passenger SOS → причина →
 *   Подтвердить → set_cancel_state → Canceled.
 *
 * Всё бизнес-состояние переходит ТОЛЬКО через UI обеих ролей. API здесь — для
 * создания заказа-fixture, чтения состояния (readback), диагностики и уборки.
 * Отмена выполняется кликом по `sos-confirm`, а не вызовом `set_cancel_state`.
 *
 * Контракт backend (замерен разведкой Этапа 1, e2e/README.md):
 *
 *   POST /drive/get/{b_id}  multipart: token, u_hash, action=set_cancel_state,
 *   reason=<label причины>  →  b_state 2→3, active true→false,
 *   b_cancel_reason = переданный label, c_state водителя остаётся Started(5).
 *
 * Достижимость точек входа в UI (проверено кодом, см. README):
 *  * Passenger: единственная достижимая кнопка SOS — в плашке `MiniOrders`;
 *    `PassengerLiveOrder` (`showLiveOrderPanel = false`) и `OnTheWayModal`
 *    (нет вызова `setOnTheWayModal(true)`) через интерфейс недостижимы —
 *    их маршрутизация проверена unit-тестом `tools/__tests__/passengerSos.test.js`.
 *  * Driver: страница заказа `/driver-order/:id` показывает Alarm при Started и
 *    открывает прежний `AlarmModal` (`alarm-timer-modal`), а не Passenger SOS.
 *
 * Ошибка backend (HTTP 200, `status:"error"`) на live безопасно не
 * воспроизводится без обхода UI (пришлось бы отменить заказ API за спиной
 * интерфейса), поэтому AC-11 покрыт unit-тестом `submitPassengerSos`.
 */

import { Browser, BrowserContext, Page, devices, expect, test } from '@playwright/test'
import { appUrl, driverAccount, passengerAccount } from './fixtures/accounts'
import { expectAppBooted, stubMapTiles } from './fixtures/appShell'
import {
  DRIVER_STATE,
  ICar,
  ISession,
  boardingCodeOf,
  cancelOrder,
  cancelTestOrders,
  createStandardOrder,
  createVotingOrder,
  driverStateOf,
  getDriverCar,
  goOnline,
  isOrderActiveFor,
  login,
  orderDriverStates,
  readOrder,
} from './fixtures/taxiApi'
import {
  DESTINATION,
  DRIVER_LIST_PAGE,
  DRIVER_STORAGE,
  PICKUP,
  STATE_NAMES,
  clickPrimaryAction,
  confirmActionResult,
  expectUiDriverState,
  openBoardingForm,
  openDriverMap,
  openOrderCard,
  orderCard,
  submitBoardingCode,
  takeOrderButton,
  uiDriverState,
} from './fixtures/driverUi'
import {
  ICancelRequest,
  PASSENGER_PAGE,
  PASSENGER_STORAGE,
  chooseVotingCandidate,
  expectPassengerDriverState,
  expectVotingCandidates,
  miniOrderCard,
  openPassengerVotingOrder,
  sosCloseButton,
  sosConfirmButton,
  sosModal,
  sosOpenButton,
  sosReason,
  sosReasonOptions,
  sosSelectedReasons,
  waitForCancelResponse,
  watchCancelRequests,
} from './fixtures/passengerUi'

test.describe.configure({ timeout: 10 * 60 * 1000 })

const LABEL = 'A16'

/** Состояние заказа целиком (b_state, types/types.ts → EBookingStates). */
const ORDER_STATE = { Processing: 1, Approved: 2, Canceled: 3 } as const

interface IRole {
  readonly title: string
  session: ISession
  car: ICar
  context: BrowserContext
  page: Page
}

let passenger: ISession
let passengerContext: BrowserContext
let passengerPage: Page
let driver: IRole
let boardingCode: string
const createdOrders: string[] = []
let cancelRequests: ICancelRequest[] = []

const reason = (error: unknown) => (error as Error)?.message ?? String(error)

const stateName = (state: number | undefined) =>
  state === undefined ? 'нет записи' : `${STATE_NAMES[state] ?? 'неизвестно'}(${state})`

/** Отдельная сессия пользователя — общих cookies/localStorage у ролей нет. */
async function openSession(browser: Browser, storageState: string): Promise<BrowserContext> {
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

/** Водитель на линии со своей машиной и своим браузерным контекстом. */
async function prepareDriver(
  browser: Browser,
  account: ReturnType<typeof driverAccount>,
  storage: string,
  title: string,
): Promise<IRole> {
  const session = await login(account, title)
  const car = await getDriverCar(session)
  await goOnline(session, car, PICKUP)
  const context = await openSession(browser, storage)
  return { title, session, car, context, page: await context.newPage() }
}

test.beforeAll(async({ browser }) => {
  passenger = await login(passengerAccount(), 'пассажир')
  driver = await prepareDriver(browser, driverAccount(), DRIVER_STORAGE, 'водитель')
  boardingCode = boardingCodeOf(driver.car)

  await cancelTestOrders(passenger)

  passengerContext = await openSession(browser, PASSENGER_STORAGE)
  passengerPage = await passengerContext.newPage()
})

test.afterEach(async({}, testInfo) => {
  const failed = testInfo.status !== testInfo.expectedStatus

  if (failed) {
    for (const orderId of createdOrders) {
      const order = await readOrder(passenger, orderId).catch(() => undefined)
      const active = await isOrderActiveFor(passenger, orderId).catch(() => undefined)
      const participants = order ?
        orderDriverStates(order).map(item => `u${item.userId}=${stateName(item.state)}`).join(', ') :
        'заказ не прочитан'
      const diagnostics = `orderId=${orderId} b_state=${order?.b_state ?? 'unknown'} ` +
        `b_cancel_reason=${(order as any)?.b_cancel_reason ?? 'нет'} ` +
        `в списке активных пассажира: ${active ?? 'unknown'} | ` +
        `водитель=u${driver?.session?.userId} (car ${driver?.car?.c_id}) | ` +
        `участники заказа: ${participants} | ` +
        `set_cancel_state из браузера пассажира: ${JSON.stringify(cancelRequests)}`
      console.error(`E2E FAILURE DIAGNOSTICS: ${diagnostics}`)
      testInfo.annotations.push({ type: 'backend', description: diagnostics })
    }
  }

  // Уборка — не часть проверяемого сценария. Успешный прогон сам переводит заказ
  // в терминальное Canceled(3) — повторная отмена закономерно отбивается
  // backend'ом («wrong booking state»), это не сбой уборки.
  while (createdOrders.length) {
    const orderId = createdOrders.pop() as string
    try {
      await cancelOrder(passenger, orderId)
    } catch (error) {
      const message = reason(error)
      if (!/wrong booking state/i.test(message)) {
        console.error(
          `E2E CLEANUP FAILED: orderId=${orderId} — заказ остался на бэкенде, ` +
          `отмените его вручную. Причина: ${message}`)
        testInfo.annotations.push({ type: 'cleanup-failed', description: `orderId=${orderId}` })
      }
    }
  }
})

test.afterAll(async() => {
  await passengerContext?.close()
  await driver?.context?.close()

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

async function backendDriverState(orderId: string): Promise<number | undefined> {
  const order = await readOrder(passenger, orderId)
  return driverStateOf(order, driver.session.userId)
}

/**
 * Довести голосовой заказ до `Started` — целиком через UI обеих ролей, тем же
 * путём, что и A.1.2 (voting-order.spec.ts): отклик водителя кликом →
 * пассажир выбирает исполнителя кликом "Выбрать" в своём списке откликов
 * (`chooseVotingCandidate`, НЕ API `choosePerformer`) → «Поехал»/«Приехал»
 * кликом → код посадки кликом.
 */
async function driveOrderToStarted(orderId: string): Promise<void> {
  await openOrderCard(driver.page, orderId)
  const take = takeOrderButton(driver.page)
  await expect(take, 'в карточке заказа есть кнопка отклика').toBeVisible({ timeout: 60_000 })
  await expect(take, 'кнопка отклика доступна').toBeEnabled({ timeout: 60_000 })
  await take.click()

  // Окно подтверждения отклика — без закрытия оверлей перехватывает дальнейшие
  // клики (voting-order.spec.ts).
  await confirmActionResult(driver.page, 'success', 'водитель уведомлён, что отклик принят')

  await expect
    .poll(() => backendDriverState(orderId), { message: 'водитель стал кандидатом (Considering)', timeout: 90_000 })
    .toBe(DRIVER_STATE.Considering)

  // Бизнес-переход в Performer — ТОЛЬКО через UI пассажира.
  await openPassengerVotingOrder(passengerPage, orderId)
  await expectVotingCandidates(passengerPage, [driver.session.userId])
  await chooseVotingCandidate(passengerPage, driver.session.userId)

  await expect
    .poll(() => backendDriverState(orderId), { message: 'пассажир выбрал водителя (Performer)', timeout: 90_000 })
    .toBe(DRIVER_STATE.Performer)
  await expectPassengerDriverState(passengerPage, DRIVER_STATE.Performer, 'пассажир видит назначенного водителя')

  await openDriverMap(driver.page)
  await expectUiDriverState(driver.page, DRIVER_STATE.Performer, 'карта водителя показывает принятый заказ')
  await clickPrimaryAction(driver.page)
  await expect
    .poll(() => backendDriverState(orderId), { message: 'водитель выехал/прибыл (Arrived)', timeout: 90_000 })
    .toBe(DRIVER_STATE.Arrived)
  await expectUiDriverState(driver.page, DRIVER_STATE.Arrived, 'карта показывает прибытие')
  await expectPassengerDriverState(passengerPage, DRIVER_STATE.Arrived, 'пассажир видит, что водитель прибыл')

  await openBoardingForm(driver.page)
  await submitBoardingCode(driver.page, boardingCode)
  await expect
    .poll(() => backendDriverState(orderId), { message: 'заказ перешёл в Started', timeout: 90_000 })
    .toBe(DRIVER_STATE.Started)
  await expectUiDriverState(driver.page, DRIVER_STATE.Started, 'карта показывает начатую поездку')
  await expectPassengerDriverState(passengerPage, DRIVER_STATE.Started, 'пассажир видит, что поездка началась')
}

/** Заказ по-прежнему идёт: Approved + водитель Started + активен (одновременно). */
async function expectTripStillStarted(orderId: string, message: string): Promise<void> {
  await expect
    .poll(
      async() => {
        const order = await readOrder(passenger, orderId)
        return Number(order.b_state) === ORDER_STATE.Approved &&
          driverStateOf(order, driver.session.userId) === DRIVER_STATE.Started &&
          await isOrderActiveFor(passenger, orderId) === true
      },
      { message, timeout: 60_000 },
    )
    .toBe(true)
}

test('А.1.6 — Passenger SOS после Started: причина, подтверждение, отмена поездки', async() => {
  let orderId = ''

  await test.step('Fixture: заказ создан (API допустим только для fixture)', async() => {
    orderId = await createVotingOrder(passenger, {
      pickup: PICKUP,
      destination: DESTINATION,
      carClassId: driver.car.cc_id,
      label: LABEL,
    })
    createdOrders.push(orderId)

    const created = await readOrder(passenger, orderId)
    expect(created.b_id, 'заказ создан и читается с бэкенда').toBe(orderId)
    expect(Number(created.b_state), 'заказ активен и ждёт водителей').toBe(ORDER_STATE.Processing)

    await passengerPage.goto(PASSENGER_PAGE)
    await expectAppBooted(passengerPage)
    await expect(miniOrderCard(passengerPage, orderId), `заказ ${orderId} виден пассажиру`)
      .toBeVisible({ timeout: 120_000 })

    // Подписка до любых действий пассажира: видно и «Close не отправил отмену»,
    // и «Confirm отправил её ровно один раз».
    cancelRequests = watchCancelRequests(passengerPage, orderId)
  })

  await test.step('Driver берёт заказ → Passenger выбирает водителя → Arrived → код посадки → Started (через UI)', async() => {
    await driveOrderToStarted(orderId)
  })

  await test.step('Точка входа перед SOS: Approved + Started + единственный performer + active', async() => {
    await expect
      .poll(
        async() => {
          const order = await readOrder(passenger, orderId)
          const active = await isOrderActiveFor(passenger, orderId)
          const started = orderDriverStates(order)
            .filter(item => item.state === DRIVER_STATE.Started)
            .map(item => item.userId)
          return Number(order.b_state) === ORDER_STATE.Approved &&
            started.length === 1 && started[0] === driver.session.userId &&
            active === true
        },
        {
          message: 'точка входа перед SOS: Approved + Started + единственный performer + active — одновременно',
          timeout: 90_000,
        },
      )
      .toBe(true)
  })

  // AC-1: SOS доступен после Started.
  const sosButton = sosOpenButton(passengerPage, orderId)
  await expect(sosButton, 'AC-1: пассажиру доступна кнопка SOS после Started').toBeVisible({ timeout: 60_000 })

  await test.step('AC-2/3/5: SOS открывает PassengerSosModal с причинами; Confirm недоступен до выбора', async() => {
    await expect(sosModal(passengerPage), 'до клика SOS-модал не показан').toHaveCount(0)
    await sosButton.click()

    await expect(sosModal(passengerPage), 'AC-2: после клика SOS виден sos-alarm-modal').toBeVisible({ timeout: 10_000 })
    await expect(
      passengerPage.getByTestId('alarm-timer-modal'),
      'Passenger SOS не открывает 60-секундный AlarmModal',
    ).toBeHidden()

    await expect
      .poll(() => sosReasonOptions(passengerPage).count(), { message: 'AC-3: в SOS-модале есть причины', timeout: 10_000 })
      .toBeGreaterThan(0)
    const reasonsCount = await sosReasonOptions(passengerPage).count()
    for (let index = 0; index < reasonsCount; index += 1) {
      await expect(sosReason(passengerPage, index), `причина ${index} видна и подписана`).toBeVisible()
      await expect(sosReason(passengerPage, index)).not.toHaveText('')
    }

    await expect(sosSelectedReasons(passengerPage), 'причина не предвыбрана').toHaveCount(0)
    await expect(sosConfirmButton(passengerPage), 'AC-5: до выбора причины Confirm недоступен').toBeDisabled()
    expect(cancelRequests, 'AC-5: до выбора причины отмена не отправлялась').toHaveLength(0)
  })

  await test.step('Close без отмены: заказ остаётся Started, set_cancel_state не вызывался', async() => {
    await sosCloseButton(passengerPage).click()
    await expect(sosModal(passengerPage), 'SOS-модал закрылся').toHaveCount(0)

    expect(cancelRequests, 'Close не отправил set_cancel_state').toHaveLength(0)
    await expectTripStillStarted(orderId, 'после Close заказ по-прежнему Approved + Started + active')
    await expect(sosOpenButton(passengerPage, orderId), 'SOS по-прежнему доступен').toBeVisible()
  })

  await test.step('Состояние не «протекает»: выбранная причина сбрасывается после Close/повторного открытия', async() => {
    await sosOpenButton(passengerPage, orderId).click()
    await expect(sosModal(passengerPage)).toBeVisible({ timeout: 10_000 })

    await sosReason(passengerPage, 0).click()
    await expect(sosReason(passengerPage, 0), 'AC-4: выбранная причина визуально отмечена')
      .toHaveAttribute('aria-checked', 'true')
    await expect(sosSelectedReasons(passengerPage), 'выбрана ровно одна причина').toHaveCount(1)
    await expect(sosConfirmButton(passengerPage), 'после выбора причины Confirm доступен').toBeEnabled()

    await sosCloseButton(passengerPage).click()
    await expect(sosModal(passengerPage)).toHaveCount(0)
    expect(cancelRequests, 'Close после выбора причины не отправил set_cancel_state').toHaveLength(0)
    await expectTripStillStarted(orderId, 'после Close с выбранной причиной заказ по-прежнему идёт')

    await sosOpenButton(passengerPage, orderId).click()
    await expect(sosModal(passengerPage)).toBeVisible({ timeout: 10_000 })
    await expect(sosSelectedReasons(passengerPage), 'при повторном открытии причина не выбрана').toHaveCount(0)
    await expect(sosConfirmButton(passengerPage), 'при повторном открытии Confirm снова недоступен').toBeDisabled()
  })

  let chosenReason = ''
  await test.step('AC-4/6/10: выбор причины и Confirm отправляют реальный set_cancel_state с этой причиной', async() => {
    // Не первая причина: так тест не совпадает с "первой по умолчанию".
    const chosen = sosReason(passengerPage, 1)
    await chosen.click()
    await expect(chosen, 'AC-4: выбранная причина отмечена').toHaveAttribute('aria-checked', 'true')
    await expect(sosSelectedReasons(passengerPage), 'выбрана ровно одна причина').toHaveCount(1)
    chosenReason = ((await chosen.textContent()) ?? '').trim()
    expect(chosenReason, 'у выбранной причины есть текст').not.toBe('')

    const confirm = sosConfirmButton(passengerPage)
    await expect(confirm, 'после выбора причины Confirm доступен').toBeEnabled()

    // Реальный клик пользователя; запрос ловится из браузера пассажира.
    const [response] = await Promise.all([
      waitForCancelResponse(passengerPage, orderId),
      confirm.click(),
    ])

    expect(response.status, 'AC-6: backend ответил HTTP 200').toBe(200)
    expect(String(response.body?.code), 'AC-6: бизнес-ответ code=200').toBe('200')
    expect(response.body?.status, 'AC-6: бизнес-ответ не status=error').not.toBe('error')

    expect(cancelRequests, 'AC-6: Confirm отправил set_cancel_state ровно один раз').toHaveLength(1)
    expect(cancelRequests[0].reason, 'AC-10: в запросе ушла выбранная причина (текст как в UI)').toBe(chosenReason)
    expect(cancelRequests[0].hasToken, 'запрос авторизован пассажиром').toBe(true)
  })

  await test.step('AC-7/10: backend — Canceled, active=false, причина сохранена', async() => {
    await expect
      .poll(async() => Number((await readOrder(passenger, orderId)).b_state), {
        message: 'AC-7: бэкенд перевёл заказ в Canceled(3) после SOS-подтверждения',
        timeout: 90_000,
      })
      .toBe(ORDER_STATE.Canceled)

    const cancelled = await readOrder(passenger, orderId)
    expect(
      (cancelled as any).b_cancel_reason,
      'AC-10: backend сохранил именно ту причину, которую выбрал пассажир',
    ).toBe(chosenReason)
    expect(
      await isOrderActiveFor(passenger, orderId),
      'AC-7: заказ перестал быть активным (признак завершения — b_state=3 + active=false)',
    ).toBe(false)
  })

  await test.step('AC-8: Passenger UI — модал закрыт, активной поездки нет', async() => {
    await expect(sosModal(passengerPage), 'AC-8: SOS-модал закрылся').toHaveCount(0, { timeout: 30_000 })
    await expect(
      miniOrderCard(passengerPage, orderId),
      'AC-8: заказ исчез из активных у пассажира',
    ).toHaveCount(0, { timeout: 90_000 })
    await expect(sosOpenButton(passengerPage, orderId), 'AC-8: кнопки SOS по отменённому заказу нет').toHaveCount(0)
  })

  await test.step('AC-8: после reload пассажира заказ остаётся отменённым', async() => {
    await passengerPage.goto(PASSENGER_PAGE)
    await expectAppBooted(passengerPage)
    await expect(
      miniOrderCard(passengerPage, orderId),
      'после reload отменённый заказ не вернулся в список активных',
    ).toHaveCount(0, { timeout: 90_000 })

    const afterReload = await readOrder(passenger, orderId)
    expect(Number(afterReload.b_state), 'после reload заказ по-прежнему Canceled').toBe(ORDER_STATE.Canceled)
    expect(await isOrderActiveFor(passenger, orderId), 'после reload заказ по-прежнему неактивен').toBe(false)
  })

  await test.step('AC-9: Driver не может продолжить отменённую поездку', async() => {
    // Приложение проактивно уведомляет водителя (A.1.5, pages/Driver →
    // notifyClientCancelled); пока окно открыто, оверлей перехватывает клики.
    await confirmActionResult(driver.page, 'warning', 'водитель уведомлён, что пассажир отменил заказ')

    // c_state водителя на backend НЕ сбрасывается (замерено на Этапе 1: остаётся
    // Started(5), как Performer в A.1.5) — признак «поездка не продолжается» это
    // b_state=3 + active=false и то, что UI не даёт водителю действий.
    await driver.page.getByTestId('driver-tab-map').click()
    await expect
      .poll(() => uiDriverState(driver.page), {
        message: 'у водителя нет основного действия (Finish/Interrupt) по отменённому заказу',
        timeout: 90_000,
      })
      .toBeUndefined()

    await driver.page.goto(DRIVER_LIST_PAGE)
    await expectAppBooted(driver.page)
    await expect(
      orderCard(driver.page, orderId),
      'отменённый заказ не предлагается водителю',
    ).toHaveCount(0, { timeout: 30_000 })

    await openDriverMap(driver.page)
    await expect
      .poll(() => uiDriverState(driver.page), {
        message: 'после reload у водителя по-прежнему нет действий по отменённой поездке',
        timeout: 60_000,
      })
      .toBeUndefined()
  })
})

/**
 * Driver Order → прежний AlarmModal. Alarm на странице заказа водителя
 * (`pages/Order`, `/driver-order/:id`) есть только у ОБЫЧНОГО заказа при
 * Started: у голосового та же страница показывает голосовую ветку («Going to
 * the call»/«Hide order»), поэтому основной тест (голосовой заказ) её не видит.
 * Стандартный заказ доводится до Started одним водителем, без пассажира
 * (A.1.1, standard-order.spec.ts) — через UI водителя.
 *
 * Нужен потому, что изменена Redux-привязка Passenger SOS: Driver не должен
 * получить Passenger SOS, а его Alarm — остаться таймером. `CardModal` (вторая
 * Driver-точка с Alarm) через E2E не отделить от страницы заказа — у обеих один
 * `driver-alarm-open`; её маршрутизация проверена unit-тестом
 * (`tools/__tests__/passengerSos.test.js`).
 */
test('А.1.6 (Driver) — Alarm водителя остаётся прежним AlarmModal, Passenger SOS не затронут', async() => {
  const orderId = await createStandardOrder(passenger, {
    pickup: PICKUP,
    destination: DESTINATION,
    carClassId: driver.car.cc_id,
    label: `${LABEL}D`,
  })
  createdOrders.push(orderId)

  await openOrderCard(driver.page, orderId)
  const take = takeOrderButton(driver.page)
  await expect(take, 'в карточке заказа есть кнопка принятия').toBeVisible({ timeout: 60_000 })
  await expect(take).toBeEnabled({ timeout: 60_000 })
  await take.click()
  await expect
    .poll(() => backendDriverState(orderId), { message: 'стандартный вызов: водитель стал исполнителем', timeout: 90_000 })
    .toBe(DRIVER_STATE.Performer)

  await openDriverMap(driver.page)
  await expectUiDriverState(driver.page, DRIVER_STATE.Performer, 'карта показывает принятый заказ')
  await clickPrimaryAction(driver.page)
  await expect
    .poll(() => backendDriverState(orderId), { message: 'водитель выехал (Arrived)', timeout: 90_000 })
    .toBe(DRIVER_STATE.Arrived)
  await expectUiDriverState(driver.page, DRIVER_STATE.Arrived, 'карта показывает прибытие')
  await clickPrimaryAction(driver.page)
  await expect
    .poll(() => backendDriverState(orderId), { message: 'поездка началась (Started)', timeout: 90_000 })
    .toBe(DRIVER_STATE.Started)
  await expectUiDriverState(driver.page, DRIVER_STATE.Started, 'карта показывает начатую поездку')

  // Страница заказа водителя (pages/Order) при Started.
  await driver.page.goto(`/driver-order/${orderId}`)
  await expectAppBooted(driver.page)

  const alarmOpen = driver.page.getByTestId('driver-alarm-open')
  await expect(alarmOpen, 'водителю при Started доступна кнопка Alarm').toBeVisible({ timeout: 90_000 })
  await alarmOpen.click()

  const timerModal = driver.page.getByTestId('alarm-timer-modal')
  await expect(timerModal, 'у водителя открылся прежний AlarmModal (таймер)').toBeVisible({ timeout: 10_000 })
  await expect(sosModal(driver.page), 'Passenger SOS-модал у водителя не появляется').toHaveCount(0)
  await expect(sosReasonOptions(driver.page), 'у водителя нет списка причин Passenger SOS').toHaveCount(0)

  await timerModal.getByRole('button').click()
  await expect(timerModal, 'AlarmModal закрылся своей кнопкой').toBeHidden({ timeout: 10_000 })

  // Alarm водителя не обращается к backend и не меняет заказ.
  const order = await readOrder(passenger, orderId)
  expect(Number(order.b_state), 'после Alarm водителя заказ по-прежнему Approved').toBe(ORDER_STATE.Approved)
  expect(driverStateOf(order, driver.session.userId), 'водитель по-прежнему в Started').toBe(DRIVER_STATE.Started)
  expect(await isOrderActiveFor(passenger, orderId), 'заказ по-прежнему активен').toBe(true)
})
