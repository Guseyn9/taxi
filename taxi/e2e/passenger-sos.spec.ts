/**
 * TEST-E2E-007 — А.1.6, Passenger SOS after Started. Живой backend.
 *
 * Требуемая цепочка (Task Contract, tasks/Playwright-E2E-007.txt):
 * создание заказа → Performer → Arrived → Started → Passenger SOS →
 * причина → подтверждение → backend mutation → реакция Driver → persistence.
 *
 * ═══ ЭТОТ ТЕСТ ПРОВЕРЯЕТ ТРЕБУЕМЫЙ КОНТРАКТ, А НЕ ИЗМЕРЕННУЮ РЕАЛЬНОСТЬ ═════
 *
 * Разведка (2 независимых прогона на живом gruzvill, e2e/README.md,
 * TEST-E2E-007) установила фактическое поведение live SOS:
 *
 *   Passenger нажимает SOS (доступен только при c_state=Started)
 *           ↓
 *   открывается `AlarmModal` (`components/modals/AlarmModal.tsx`) — ЧИСТО
 *   КЛИЕНТСКИЙ 60-секундный таймер. Списка причин НЕТ (ни radio/checkbox/
 *   select/li — измерено 0 на обоих прогонах), confirm-кнопки нет, backend НЕ
 *   вызывается ни разу, `b_state`/`c_state`/`performer`/`active` не меняются.
 *
 * ЭТО GAP, А НЕ КОНТРАКТ. Первая версия этого теста ошибочно проверяла
 * измеренное поведение как ожидаемое (тест был зелёным именно потому, что
 * требуемая функция отсутствует, — противоположность назначению
 * регрессионного E2E). Исправлено по прямому замечанию ревью
 * (tasks/Playwright-E2E-007.txt, "Правки по задаче"):
 *
 *   A.1.6 GAP: текущая реализация Passenger SOS после Started представляет
 *   собой локальный 60-секундный AlarmModal без выбора причины,
 *   подтверждения и backend mutation. Требуемый сценарий
 *   `SOS → причина → подтверждение` не реализован.
 *
 * Поэтому тест ниже проверяет ТРЕБУЕМЫЙ бизнес-контракт (после клика SOS
 * пассажиру должна быть доступна хотя бы одна причина для выбора) и
 * ЗАКОНОМЕРНО ПАДАЕТ на живом backend, пока эта функциональность не будет
 * реализована. Это ожидаемо и намеренно — красный результат здесь означает
 * «функция A.1.6 не реализована», а не «тест сломан». Дальнейшие шаги
 * требуемого сценария (выбор конкретной причины, подтверждение, проверка
 * backend-мутации, реакция Driver UI, persistence) не написаны как код:
 * до появления хотя бы одного реального элемента выбора причины у них не
 * было бы настоящих селекторов, а выдумывать их — то же самое, что
 * подменять реальный SOS фиктивным поведением (прямо запрещено ТЗ, см.
 * Out of Scope). Они дописываются по мере реализации причины/подтверждения,
 * тем же приёмом, что и `chooseVotingCandidate`/`cancelAssignedOrder`
 * (passengerUi.ts) — реальный клик, а не API и не мок.
 *
 * Второе исправление по тому же ревью: бизнес-переход в `Performer`
 * выполняется ЧЕРЕЗ UI ПАССАЖИРА (`chooseVotingCandidate`), а не вызовом API
 * `choosePerformer`, как было в первой версии. API в этом тесте — только для
 * подготовки заказа, чтения состояния и уборки, как и требует общее правило
 * проекта (см. A.1.2, voting-order.spec.ts).
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
  DRIVER_STORAGE,
  PICKUP,
  STATE_NAMES,
  clickPrimaryAction,
  confirmActionResult,
  expectUiDriverState,
  openBoardingForm,
  openDriverMap,
  openOrderCard,
  submitBoardingCode,
  takeOrderButton,
} from './fixtures/driverUi'
import {
  PASSENGER_PAGE,
  PASSENGER_STORAGE,
  chooseVotingCandidate,
  expectPassengerDriverState,
  expectVotingCandidates,
  miniOrderCard,
  openPassengerVotingOrder,
  sosAlarmModal,
  sosAlarmReasonElementCount,
  sosOpenButton,
} from './fixtures/passengerUi'

test.describe.configure({ timeout: 6 * 60 * 1000 })

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
        `в списке активных пассажира: ${active ?? 'unknown'} | ` +
        `водитель=u${driver?.session?.userId} (car ${driver?.car?.c_id}) | ` +
        `участники заказа: ${participants}`
      console.error(`E2E FAILURE DIAGNOSTICS: ${diagnostics}`)
      testInfo.annotations.push({ type: 'backend', description: diagnostics })
    }
  }

  // Уборка — не часть проверяемого сценария, выполняется независимо от того,
  // на каком шаге тест остановился.
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

  // Окно подтверждения отклика (CardModal.tsx, DRIVER_VOTING_READY_SENT) —
  // без закрытия оверлей перехватывает дальнейшие клики (voting-order.spec.ts).
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

test('А.1.6 — Passenger SOS после Started: причина и подтверждение (GAP — не реализовано, тест намеренно красный)', async() => {
  // Предусловие — голосовой заказ, проверенный контракт (тот же, что у A.1.2).
  const orderId = await createVotingOrder(passenger, {
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

  // Create order → Driver Performer → Driver Arrived → Driver Started —
  // целиком через UI обеих ролей.
  await driveOrderToStarted(orderId)

  // Точка входа перед SOS: b_state=Approved, c_state=Started, единственный
  // исполнитель — наш водитель, заказ активен — ОДНОВРЕМЕННО, а не по
  // отдельности (иначе есть риск поймать промежуточное состояние перехода).
  await expect
    .poll(
      async() => {
        const order = await readOrder(passenger, orderId)
        const active = await isOrderActiveFor(passenger, orderId)
        const performers = orderDriverStates(order)
          .filter(item => item.state === DRIVER_STATE.Started)
          .map(item => item.userId)
        return Number(order.b_state) === ORDER_STATE.Approved &&
          performers.length === 1 && performers[0] === driver.session.userId &&
          active === true
      },
      {
        message: 'точка входа перед SOS: Approved + Started + единственный performer + active — одновременно',
        timeout: 90_000,
      },
    )
    .toBe(true)

  // Passenger clicks SOS.
  const sosButton = sosOpenButton(passengerPage)
  await expect(sosButton, 'пассажиру доступна кнопка SOS после Started').toBeVisible({ timeout: 60_000 })
  await sosButton.click()

  const modal = sosAlarmModal(passengerPage)
  await expect(modal, 'после клика SOS открылся диалог подтверждения').toBeVisible({ timeout: 10_000 })

  // ТРЕБУЕМЫЙ КОНТРАКТ A.1.6 (Task Contract, §Expected Behavior, п.2-3):
  // диалог должен предложить пассажиру хотя бы одну причину для выбора.
  //
  // GAP: фактическая реализация (AlarmModal.tsx) не содержит ни одного
  // элемента выбора причины — эта проверка ПАДАЕТ на живом backend, пока
  // функциональность не реализована. Это ожидаемый, намеренный результат:
  // тест проверяет требуемый бизнес-сценарий A.1.6, а не измеренный GAP, и
  // не должен становиться зелёным до тех пор, пока причина/подтверждение/
  // backend-мутация не появятся на самом деле (см. заголовок файла).
  await expect
    .poll(() => sosAlarmReasonElementCount(passengerPage), {
      message: 'A.1.6 GAP: диалог SOS должен предлагать хотя бы одну причину для выбора — см. e2e/README.md, TEST-E2E-007',
      timeout: 10_000,
    })
    .toBeGreaterThan(0)

  // Дальше по требуемому сценарию: select reason → confirm SOS → verify
  // backend mutation → verify Driver result → reload → verify persistence.
  // Не реализовано намеренно (см. заголовок файла) — до появления реального
  // элемента выбора причины у этих шагов нет настоящих селекторов/контракта,
  // а сочинять их означало бы то же самое, что подменять SOS фиктивным
  // поведением. Дописать по образцу chooseVotingCandidate/cancelAssignedOrder
  // (passengerUi.ts) сразу, как только причина/подтверждение появятся в UI.
})
