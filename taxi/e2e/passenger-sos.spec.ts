/**
 * TEST-E2E-007 — А.1.6, Passenger SOS after Started. Живой backend.
 *
 * Цепочка: создание заказа → Performer → Arrived → Started → Passenger SOS →
 * проверка результата у обеих ролей → backend → reload → persistence.
 *
 * ═══ КОНТРАКТ SOS ЗАМЕРЕН ДО НАПИСАНИЯ ТЕСТА ═══════════════════════════════
 *
 * Разведка (2 независимых прогона на живом gruzvill, временная оснастка
 * `e2e/_recon-sos.spec.ts`, из репозитория удалена — см. e2e/README.md,
 * TEST-E2E-007) установила: то, что описывает Task Contract как
 * `SOS → причина → подтверждение`, в текущей реализации НЕ существует.
 * Фактический контракт:
 *
 *   Passenger нажимает SOS (доступен только при c_state=Started)
 *           ↓
 *   открывается `AlarmModal` (`components/modals/AlarmModal.tsx`) — ЧИСТО
 *   КЛИЕНТСКИЙ 60-секундный таймер: заголовок "Alarm", "Estimate 60 Seconds",
 *   ОДНА кнопка "Cancel Alarm". Списка причин НЕТ (ни radio/checkbox/select/li
 *   — измерено 0 на обоих прогонах), отдельной confirm-кнопки нет.
 *           ↓
 *   Network: НИ ОДНОГО запроса к backend, специфичного клику. Единственный
 *   API-трафик за время наблюдения — штатный опрос активных заказов
 *   (`POST /drive?fields=00000000u1`, ~раз в 5с), идущий независимо от SOS.
 *   `POST /drive/get/{b_id}` с любым `action` НЕ вызывается.
 *           ↓
 *   b_state / c_state / performer / active — НЕ МЕНЯЮТСЯ.
 *
 * Отсюда главные особенности этого теста, отличающие его от A.1.1–A.1.6:
 *
 * 1. **Это тест ОТСУТСТВИЯ эффекта, а не перехода состояния.** SOS в текущей
 *    реализации не мутирует ни заказ, ни участие водителя — тест проверяет
 *    именно это (закрытая, воспроизводимая на двух прогонах разведки форма
 *    контракта), а не «превращает» его в отмену или что-то ещё.
 * 2. **"select reason" / "confirm SOS" из исходного Task Contract заменены**
 *    на явную проверку ОТСУТСТВИЯ списка причин (`sosAlarmReasonElementCount
 *    === 0`) и на закрытие единственной доступной кнопкой "Cancel Alarm".
 *    Если однажды появится настоящий reason-flow — эта проверка на 0
 *    провалится первой и явно, а не будет молча обойдена.
 * 3. **Таймер не дожидается автозакрытия.** Разведка показала, что 60-секундный
 *    countdown тикает медленнее реального времени под автоматизацией
 *    (вероятный троттлинг фонового `setInterval`, см. e2e/README.md, раздел
 *    GAP) — ждать его в CI ненадёжно по длительности. Тест закрывает модал
 *    явным кликом "Cancel Alarm", как и было измерено в разведке (прогон 1).
 * 4. **`data-testid` на SOS/AlarmModal добавлены этим же изменением**
 *    (`passenger-sos-open`, `sos-alarm-modal`, `sos-alarm-cancel`) — до этого
 *    их не было (единственная кнопка сценариев A.1.1–A.1.6 без стабильного
 *    локатора). Разметка — не поведение: обработчики и вёрстка не менялись.
 */

import { Browser, BrowserContext, Page, devices, expect, test } from '@playwright/test'
import { apiBase, appUrl, driverAccount, passengerAccount } from './fixtures/accounts'
import { expectAppBooted, stubMapTiles } from './fixtures/appShell'
import {
  DRIVER_STATE,
  ICar,
  ISession,
  boardingCodeOf,
  cancelOrder,
  cancelTestOrders,
  choosePerformer,
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
  openBoardingForm,
  openDriverMap,
  openOrderCard,
  submitBoardingCode,
  takeOrderButton,
  uiDriverState,
} from './fixtures/driverUi'
import {
  PASSENGER_PAGE,
  PASSENGER_STORAGE,
  miniOrderCard,
  openPassengerOrderCard,
  sosAlarmCancelButton,
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

  // Уборка. SOS не переводит заказ в терминальное состояние (измеренный
  // контракт) — в отличие от A.1.5, здесь отмена в конце ВСЕГДА нужна и
  // ожидаемо успешна, а не «падает предсказуемо, потому что заказ уже
  // терминален».
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
 * Довести голосовой заказ до `Started` — тот же путь, что и посадка по коду
 * (driver-boarding.spec.ts): отклик кликом → пассажир выбирает водителя через
 * API (как и в остальных тестах — это действие ПАССАЖИРА, а не водителя) →
 * «Поехал»/«Приехал» кликом → код посадки кликом.
 */
async function driveToStarted(orderId: string): Promise<void> {
  await openOrderCard(driver.page, orderId)
  const take = takeOrderButton(driver.page)
  await expect(take, 'в карточке заказа есть кнопка отклика').toBeVisible({ timeout: 60_000 })
  await expect(take, 'кнопка отклика доступна').toBeEnabled({ timeout: 60_000 })
  await take.click()

  // Окно подтверждения отклика (CardModal.tsx, DRIVER_VOTING_READY_SENT) —
  // без закрытия оверлей перехватывает дальнейшие клики (voting-order.spec.ts).
  await confirmActionResult(driver.page, 'success', 'водитель уведомлён, что отклик принят')

  await expect
    .poll(() => backendDriverState(orderId), { message: 'водитель стал кандидатом', timeout: 90_000 })
    .toBe(DRIVER_STATE.Considering)

  await choosePerformer(passenger, orderId, driver.session.userId)
  await expect
    .poll(() => backendDriverState(orderId), { message: 'пассажир выбрал водителя', timeout: 90_000 })
    .toBe(DRIVER_STATE.Performer)

  await openDriverMap(driver.page)
  await clickPrimaryAction(driver.page)
  await expect
    .poll(() => backendDriverState(orderId), { message: 'водитель выехал/прибыл (Arrived)', timeout: 90_000 })
    .toBe(DRIVER_STATE.Arrived)

  await openBoardingForm(driver.page)
  await submitBoardingCode(driver.page, boardingCode)
  await expect
    .poll(() => backendDriverState(orderId), { message: 'заказ перешёл в Started', timeout: 90_000 })
    .toBe(DRIVER_STATE.Started)
}

test('А.1.6 — Passenger SOS после Started: клиентский таймер без изменения состояния заказа', async() => {
  // ШАГ 1-2 (Create order). Предусловие — голосовой заказ, проверенный
  // контракт (тот же, что у A.1.2/посадки по коду).
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

  // ШАГИ 3-6 (Driver Performer → Arrived → Started) — целиком через UI водителя.
  await driveToStarted(orderId)

  // Точка входа перед SOS (ТЗ, §1): b_state=Approved, c_state=Started,
  // единственный performer — наш водитель, заказ активен — ОДНОВРЕМЕННО, а не
  // по отдельности (иначе есть риск поймать промежуточное состояние перехода).
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

  // ШАГ 7 (Passenger clicks SOS) — раскрыть карточку заказа пассажира. Не
  // через `selectPassengerOrder`: тот хелпер ждёт `passenger-driver-panel`,
  // который для голосового заказа в Started не рендерится (см.
  // `openPassengerOrderCard`, fixtures/passengerUi.ts, и e2e/README.md).
  await openPassengerOrderCard(passengerPage, orderId)

  const sosButton = sosOpenButton(passengerPage)
  await expect(sosButton, 'пассажиру доступна кнопка SOS после Started').toBeVisible({ timeout: 60_000 })

  // Отследить сетевой обмен пассажирской страницы вокруг клика SOS — именно
  // из браузерного контекста, а не вызовом API из теста (§ "проверить, что
  // тест действительно выполняет SOS через UI").
  const apiRequestsDuringSos: string[] = []
  const onRequest = (request: Parameters<Parameters<Page['on']>[1]>[0]) => {
    const url = (request as any).url()
    if (url.startsWith(apiBase()))
      apiRequestsDuringSos.push(`${(request as any).method()} ${url}`)
  }
  passengerPage.on('request', onRequest as any)

  await sosButton.click()

  const modal = sosAlarmModal(passengerPage)
  await expect(modal, 'после клика SOS открылся AlarmModal').toBeVisible({ timeout: 10_000 })
  await expect(modal, 'модал SOS показывает измеренный заголовок "Alarm"').toContainText('Alarm')

  // ШАГ 8 (select reason) — измеренный контракт: причин выбирать НЕЧЕГО.
  expect(
    await sosAlarmReasonElementCount(passengerPage),
    'в SOS-модале нет элементов выбора причины (измеренный контракт, e2e/README.md, TEST-E2E-007)',
  ).toBe(0)

  // ШАГ 9 (confirm SOS) — единственное доступное действие: закрыть таймер
  // явным кликом (разведка показала, что ждать автозакрытия в CI ненадёжно).
  const cancelButton = sosAlarmCancelButton(passengerPage)
  await expect(cancelButton, 'кнопка закрытия SOS-таймера видна').toBeVisible({ timeout: 10_000 })
  await cancelButton.click()
  await expect(modal, 'SOS-модал закрылся').toBeHidden({ timeout: 10_000 })

  passengerPage.off('request', onRequest as any)

  // Ни один запрос к apiBase() за время SOS не должен быть мутирующим —
  // измеренный контракт: единственный трафик — штатный опрос активных
  // заказов (`/drive?fields=...`), а не `/drive/get/{id}` с каким-либо `action`.
  const mutatingRequests = apiRequestsDuringSos.filter(entry =>
    /\/drive\/get\//.test(entry) || /[?&]action=/.test(entry))
  expect(
    mutatingRequests,
    `SOS не должен вызывать мутирующие backend-запросы (измерено: клиентский таймер без API); ` +
    `весь трафик за время SOS: ${JSON.stringify(apiRequestsDuringSos)}`,
  ).toEqual([])

  // ШАГ 10 (verify backend state) — независимая проверка: ничего не изменилось.
  const afterSos = await readOrder(passenger, orderId)
  expect(Number(afterSos.b_state), 'после SOS b_state не меняется (измеренный контракт)')
    .toBe(ORDER_STATE.Approved)
  expect(driverStateOf(afterSos, driver.session.userId), 'после SOS c_state водителя остаётся Started')
    .toBe(DRIVER_STATE.Started)
  expect(await isOrderActiveFor(passenger, orderId), 'после SOS заказ остаётся активным')
    .toBe(true)

  // ШАГ 11 (verify Driver result) — SOS не обращается к backend, поэтому
  // водитель не должен быть ни уведомлён, ни ограничен в действиях.
  const notificationVisible = await driver.page
    .locator('[data-testid="message-modal"]').filter({ visible: true }).count()
  expect(notificationVisible, 'SOS не уведомляет водителя (backend в действии не участвует)').toBe(0)
  expect(await uiDriverState(driver.page), 'состояние водителя на карте не изменилось')
    .toBe(DRIVER_STATE.Started)

  // ШАГ 12-13 (reload → verify persistence). Backend — решающая проверка
  // постоянства; UI-список пассажира тоже проверяется, но с запасом по
  // времени (разведка видела задержку синхронизации карточки после reload,
  // не связанную с самим SOS, — см. GAP в e2e/README.md).
  await passengerPage.reload()
  await expectAppBooted(passengerPage)
  await expect(
    miniOrderCard(passengerPage, orderId),
    'после reload заказ остаётся в списке активных заказов пассажира',
  ).toBeVisible({ timeout: 120_000 })

  await openDriverMap(driver.page)
  await expect
    .poll(() => uiDriverState(driver.page), { message: 'после reload водитель по-прежнему в Started', timeout: 90_000 })
    .toBe(DRIVER_STATE.Started)

  const persisted = await readOrder(passenger, orderId)
  expect(Number(persisted.b_state), 'backend после reload по-прежнему Approved')
    .toBe(ORDER_STATE.Approved)
  expect(driverStateOf(persisted, driver.session.userId), 'backend после reload по-прежнему Started')
    .toBe(DRIVER_STATE.Started)
  expect(await isOrderActiveFor(passenger, orderId), 'после reload заказ по-прежнему активен')
    .toBe(true)
})
