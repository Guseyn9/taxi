/**
 * TEST-E2E-004 — А.1.3, предложение. Живой backend.
 *
 * Сквозной сценарий: пассажир получает заказ режима «Предложение» → ДВА
 * водителя видят один и тот же заказ и предлагают СВОИ условия через форму в
 * интерфейсе → пассажир выбирает одно из предложений кликом → выбранный водитель
 * довозит заказ до начала поездки → пассажир видит смену состояний.
 *
 * Что здесь настоящее: frontend, Taxi API, состояние заказа, переходы FSM и все
 * ТРИ роли — у пассажира и у каждого водителя свой браузерный контекст со своей
 * сессией. Ни один endpoint сценария не подменяется; единственный мок — тайлы
 * карты.
 *
 * Через API делается только подготовка предусловия (водители на линии, заказ
 * создан) и НЕЗАВИСИМАЯ от интерфейса проверка состояния заказа. Все действия
 * сценария — клики и ввод в браузере: и формирование предложения, и его
 * подтверждение, и выбор исполнителя пассажиром.
 *
 * ОБЪЁМ ТЕСТА — то же осознанное решение, что и в А.1.1/А.1.2: создание заказа
 * здесь является fixture/предусловием и покрытием пассажирской формы создания
 * заказа НЕ считается. Обоснование — e2e/README.md.
 *
 * ЧЕМ А.1.3 ОТЛИЧАЕТСЯ ОТ ДВУХ ПРЕДЫДУЩИХ — всё установлено замерами на живом
 * gruzvill до написания теста (e2e/README.md, TEST-E2E-004):
 *
 * 1. Признак режима — межгородний класс поездки вместе с ценой заказчика. Это
 *    ЕДИНСТВЕННЫЙ признак «Предложения», переживающий backend: `b_cars_count=0`
 *    возвращается как "1", `b_only_offer` не возвращается вовсе, а
 *    `b_options.order_mode` бэкенд не принимает. Проверяется он не равенством
 *    поля, а `isOfferOrderSnapshot` — тем же контрактом, по которому режим
 *    определяет приложение.
 *
 * 2. Предложение водителя — ДВА шага в интерфейсе: сначала открывается форма,
 *    затем вводится цена и отправляется. Кнопки подписаны одинаково, поэтому
 *    различаются атрибутом, а не текстом.
 *
 * 3. Кода посадки в А.1.3 НЕТ. Переход `Arrived → Started` идёт прямым действием,
 *    как у А.1.1: путь через код гейтится `isVotingOrder`, а не `isOfferOrder`
 *    (pages/Driver/Map.tsx). Тест отдельно проверяет, что формы кода не было.
 *
 * 4. Заказ создаётся БЕЗ метки [DRV:<id>] и с `b_max_waiting = 900` — по тем же
 *    причинам, что и голосование: метка спрятала бы заказ от второго водителя, а
 *    вне окна 0 < x ≤ 900 пассажирский интерфейс сам отменяет choice-заказ через
 *    180 с (VotingForm.tsx).
 *
 * ПОЧЕМУ ВОДИТЕЛЕЙ ДВА. Один заказ должен получить два РАЗНЫХ предложения: только
 * так проверяются бизнес-инвариант «исполнитель ровно один», отсутствие путаницы
 * между предложениями и состояние проигравшего кандидата.
 */

import { Browser, BrowserContext, Page, devices, expect, test } from '@playwright/test'
import { appUrl, driver2Account, driverAccount, passengerAccount } from './fixtures/accounts'
import { stubMapTiles } from './fixtures/appShell'
import {
  DRIVER_STATE,
  INTERCITY_LOCATION_CLASS,
  cancelOrder,
  cancelTestOrders,
  createOfferOrder,
  customerPriceOf,
  driverStateOf,
  getDriverCar,
  goOnline,
  isOfferOrderSnapshot,
  isOrderActiveFor,
  ICar,
  IOrderSnapshot,
  ISession,
  ISweepResult,
  login,
  offerPriceOf,
  offersOf,
  orderDriverStates,
  performersOf,
  readOrder,
} from './fixtures/taxiApi'
import {
  DESTINATION,
  DRIVER2_STORAGE,
  DRIVER_STORAGE,
  PICKUP,
  STATE_NAMES,
  clickPrimaryAction,
  confirmActionResult,
  expectUiDriverState,
  isBoardingFormVisible,
  isOfferFormVisible,
  openDriverMap,
  openOfferForm,
  openOrderCard,
  submitDriverOffer,
} from './fixtures/driverUi'
import {
  PASSENGER_STORAGE,
  chooseVotingCandidate,
  expectCandidateOfferPrice,
  expectOrderVisibleToPassenger,
  expectPassengerDriverState,
  expectVotingCandidates,
  openPassengerVotingOrder,
  passengerDriverId,
} from './fixtures/passengerUi'

// Сценарий длиннее голосования: три роли, три загрузки приложения и две формы
// предложения между ними. Каждое ожидание — по факту, а не по таймеру.
test.describe.configure({ timeout: 12 * 60 * 1000 })

const LABEL = 'A13'

/** Состояние заказа целиком (b_state, types/types.ts → EBookingStates). */
const ORDER_STATE = { Processing: 1, Approved: 2 } as const

/**
 * Цены предложений. Обе заведомо отличаются и от цены заказчика (150), и друг от
 * друга: иначе совпадение значений скрыло бы путаницу между водителями.
 */
const OFFER_PRICE = { driver1: 731, driver2: 842 } as const

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
let driver1: IRole
let driver2: IRole
const createdOrders: string[] = []

const reason = (error: unknown) => (error as Error)?.message ?? String(error)

const stateName = (state: number | undefined) =>
  state === undefined ? 'нет записи' : `${STATE_NAMES[state] ?? 'неизвестно'}(${state})`

function reportSweep(when: string, result: ISweepResult): void {
  if (result.cancelled)
    console.log(`E2E sweep (${when}): отменено тестовых заказов — ${result.cancelled}`)
  if (result.skipped.length)
    console.warn(
      `E2E sweep (${when}): не тронуто заказов — ${result.skipped.length} ` +
      `(${result.skipped.join(', ')}). Уборка отменяет только заказы с тестовыми метками.`)
}

/**
 * Отдельная сессия пользователя. Пассажир и оба водителя — три разных контекста
 * с разными storageState: общих cookies и localStorage у ролей нет.
 */
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

  driver1 = await prepareDriver(browser, driverAccount(), DRIVER_STORAGE, 'водитель 1')
  driver2 = await prepareDriver(browser, driver2Account(), DRIVER2_STORAGE, 'водитель 2')

  // Смысл А.1.3 в том, что на один заказ приходит несколько РАЗНЫХ предложений.
  // Одна и та же учётка в обеих переменных — это не два водителя, и тест на ней
  // ничего не докажет.
  expect(
    driver2.session.userId,
    'второй водитель — отдельная учётка: E2E_DRIVER2_* должен указывать не на того же пользователя',
  ).not.toBe(driver1.session.userId)

  // Прогон начинается без тестового мусора: заказ, оставшийся от прерванного
  // прогона, занимает водителя и сбивает пассажирский экран.
  reportSweep('перед прогоном', await cancelTestOrders(passenger))

  passengerContext = await openSession(browser, PASSENGER_STORAGE)
  passengerPage = await passengerContext.newPage()
})

test.afterEach(async({}, testInfo) => {
  const failed = testInfo.status !== testInfo.expectedStatus

  // При падении нужно, чем разбираться на бэкенде: на каком переходе нарушился
  // контракт, в каком состоянии остался каждый участник и что стало с
  // предложениями. Печатаются только идентификаторы, состояния и цены — ни
  // токена, ни пароля, ни cookie.
  if (failed) {
    for (const orderId of createdOrders) {
      const order = await readOrder(passenger, orderId).catch(() => undefined)
      const active = await isOrderActiveFor(passenger, orderId).catch(() => undefined)
      const participants = order ?
        orderDriverStates(order).map(item => `u${item.userId}=${stateName(item.state)}`).join(', ') :
        'заказ не прочитан'
      const offers = order ?
        offersOf(order).map(item => `u${item.userId}: цена=${item.price ?? 'нет'}`).join('; ') || 'предложений нет' :
        'заказ не прочитан'
      const diagnostics = `orderId=${orderId} b_state=${order?.b_state ?? 'unknown'} ` +
        `режим «Предложение»=${order ? isOfferOrderSnapshot(order) : 'unknown'} ` +
        `(b_location_class=${order?.b_location_class ?? 'unknown'}, ` +
        `customer_price=${order ? customerPriceOf(order) ?? 'нет' : 'unknown'}) ` +
        `в списке активных пассажира: ${active ?? 'unknown'} | ` +
        `driver1=u${driver1?.session?.userId} (car ${driver1?.car?.c_id}), ` +
        `driver2=u${driver2?.session?.userId} (car ${driver2?.car?.c_id}) | ` +
        `участники заказа: ${participants} | предложения: ${offers}`
      console.error(`E2E FAILURE DIAGNOSTICS: ${diagnostics}`)
      testInfo.annotations.push({ type: 'backend', description: diagnostics })
    }
  }

  // Каждый прогон убирает за собой. Если отменить не вышло — заказ остаётся
  // живым на бэкенде, поэтому его номер обязан попасть в лог прогона.
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
  await driver1?.context?.close()
  await driver2?.context?.close()

  // Подмести тестовые заказы, оставшиеся от прерванных прогонов. Участие
  // водителя основанием для отмены не является — только тестовая метка.
  if (!passenger)
    return
  try {
    reportSweep('после прогона', await cancelTestOrders(passenger))
  } catch (error) {
    console.error(`E2E SWEEP FAILED: ${reason(error)}`)
  }
})

/** Состояние конкретного водителя в заказе — независимая от UI проверка. */
async function backendState(orderId: string, role: IRole): Promise<number | undefined> {
  const order = await readOrder(role.session, orderId)
  return driverStateOf(order, role.session.userId)
}

async function expectBackendState(
  orderId: string,
  role: IRole,
  state: number,
  message: string,
): Promise<void> {
  await expect
    .poll(() => backendState(orderId, role), { message, timeout: 90_000 })
    .toBe(state)
}

/** Цена предложения водителя на бэкенде — независимо от того, что показывает UI. */
async function backendOfferPrice(orderId: string, role: IRole): Promise<number | undefined> {
  const order = await readOrder(passenger, orderId)
  return offerPriceOf(order, role.session.userId)
}

/**
 * Водитель формирует и подтверждает своё предложение — целиком через интерфейс.
 *
 * Два шага: первая кнопка открывает форму, вторая отправляет. Endpoint
 * предложения из теста не вызывается ни разу.
 *
 * Приложение подтверждает приём действия не окном, а состоянием карточки:
 * success-попап для предложения оно сознательно не показывает
 * (components/modals/CardModal.tsx), поэтому признаком принятого действия
 * служит закрывшаяся форма.
 */
async function makeOffer(role: IRole, price: number): Promise<void> {
  await openOfferForm(role.page)
  await submitDriverOffer(role.page, price)
  await expect
    .poll(() => isOfferFormVisible(role.page), {
      message: `${role.title}: приложение приняло предложение и закрыло форму`,
      timeout: 90_000,
    })
    .toBe(false)
}

test('А.1.3 — предложение: от создания заказа до начала поездки', async() => {
  // ШАГ 1. Предусловие: у пассажира есть заказ режима «Предложение», общий для
  // обоих водителей и с ожиданием из доверенного окна.
  const orderId = await createOfferOrder(passenger, {
    pickup: PICKUP,
    destination: DESTINATION,
    carClassId: driver1.car.cc_id,
    label: LABEL,
    maxWaitingSeconds: 900,
  })
  createdOrders.push(orderId)

  // ПРОВЕРКА 1 (AC-1) — заказ создан и однозначно опознаётся как А.1.3.
  // Проверяется контракт целиком, а не одно поле: заказ, потерявший любой из
  // двух признаков, приложением «Предложением» уже не считается, и водительской
  // формы предложения в интерфейсе не будет.
  const created = await readOrder(passenger, orderId)
  expect(created.b_id, 'заказ создан и читается с бэкенда').toBe(orderId)
  expect(isOfferOrderSnapshot(created), 'заказ опознаётся приложением как «Предложение»').toBe(true)
  expect(String(created.b_location_class), 'класс поездки межгородний').toBe(INTERCITY_LOCATION_CLASS)
  expect(customerPriceOf(created), 'у заказа есть цена заказчика').toBe(150)
  expect(String(created.b_voting ?? '0'), 'заказ НЕ голосовой — это другой режим').toBe('0')
  expect(Number(created.b_state), 'заказ активен и ждёт водителей').toBe(ORDER_STATE.Processing)
  expect(orderDriverStates(created), 'у только что созданного заказа участников нет').toEqual([])
  expect(offersOf(created), 'у только что созданного заказа предложений нет').toEqual([])

  // ШАГ 2 (AC-2) — пассажир видит свой заказ в приложении.
  await expectOrderVisibleToPassenger(passengerPage, orderId)

  // ШАГ 3 и ШАГ 4 (AC-2) — ОДИН И ТОТ ЖЕ заказ доступен обоим водителям.
  // Карточка ищется по номеру заказа, так что это именно созданный заказ.
  await openOrderCard(driver1.page, orderId)
  await openOrderCard(driver2.page, orderId)

  // До предложений исполнителя нет и заказ всё ещё ждёт водителей.
  const beforeOffers = await readOrder(passenger, orderId)
  expect(Number(beforeOffers.b_state), 'до предложений заказ в состоянии поиска водителя')
    .toBe(ORDER_STATE.Processing)
  expect(performersOf(beforeOffers), 'до предложений исполнителя нет').toEqual([])

  // ШАГ 4-5 (AC-3, AC-4) — оба водителя формируют СВОИ предложения через форму в
  // интерфейсе, и backend сохраняет предложение с той ценой, которую ввёл именно
  // этот водитель. Endpoint предложения из теста не вызывается.
  await makeOffer(driver1, OFFER_PRICE.driver1)
  await expectBackendState(
    orderId, driver1, DRIVER_STATE.Considering, 'водитель 1 стал кандидатом со своим предложением')
  await expect
    .poll(() => backendOfferPrice(orderId, driver1), {
      message: 'backend сохранил цену предложения водителя 1',
      timeout: 90_000,
    })
    .toBe(OFFER_PRICE.driver1)

  await makeOffer(driver2, OFFER_PRICE.driver2)
  await expectBackendState(
    orderId, driver2, DRIVER_STATE.Considering, 'водитель 2 стал кандидатом со своим предложением')
  await expect
    .poll(() => backendOfferPrice(orderId, driver2), {
      message: 'backend сохранил цену предложения водителя 2',
      timeout: 90_000,
    })
    .toBe(OFFER_PRICE.driver2)

  // ПРОВЕРКА (AC-4) — предложение исполнителя НЕ назначает. Этим А.1.3
  // отличается от А.1.1, где клик «Взять заказ» сразу делает водителя Performer.
  const duringOffers = await readOrder(passenger, orderId)
  expect(
    performersOf(duringOffers),
    'появление предложений само по себе исполнителя не назначает',
  ).toEqual([])
  expect(Number(duringOffers.b_state), 'заказ по-прежнему ждёт выбора пассажира')
    .toBe(ORDER_STATE.Processing)
  expect(
    offersOf(duringOffers)
      .map(item => ({ userId: item.userId, price: item.price }))
      .sort((a, b) => a.userId.localeCompare(b.userId)),
    'на бэкенде ровно два предложения, и цены не перепутаны между водителями',
  ).toEqual(
    [
      { userId: driver1.session.userId, price: OFFER_PRICE.driver1 },
      { userId: driver2.session.userId, price: OFFER_PRICE.driver2 },
    ].sort((a, b) => a.userId.localeCompare(b.userId)),
  )

  // ШАГ 6 (AC-5) — пассажир получил предложения и видит ИМЕННО предложение
  // каждого водителя: сверяется сырое значение цены из разметки, а не
  // отформатированная подпись с валютой из конфигурации.
  await openPassengerVotingOrder(passengerPage, orderId)
  await expectVotingCandidates(passengerPage, [driver1.session.userId, driver2.session.userId])
  await expectCandidateOfferPrice(
    passengerPage, driver1.session.userId, OFFER_PRICE.driver1,
    'пассажир видит предложение водителя 1 с его ценой')
  await expectCandidateOfferPrice(
    passengerPage, driver2.session.userId, OFFER_PRICE.driver2,
    'пассажир видит предложение водителя 2 с его ценой')

  // ШАГ 7 (AC-6) — пассажир принимает предложение водителя 1 кликом. Подменять
  // это действие вызовом endpoint нельзя: именно оно завершает сценарий А.1.3.
  await chooseVotingCandidate(passengerPage, driver1.session.userId)

  await expectBackendState(
    orderId, driver1, DRIVER_STATE.Performer,
    'после принятия предложения водитель 1 стал исполнителем')

  // ШАГ 8 (AC-7) — исполнитель ровно один, и это автор принятого предложения.
  const assigned = await readOrder(passenger, orderId)
  expect(performersOf(assigned), 'исполнитель ровно один, и это водитель принятого предложения')
    .toEqual([driver1.session.userId])
  expect(Number(assigned.b_state), 'заказ перешёл в состояние с назначенным исполнителем')
    .toBe(ORDER_STATE.Approved)
  expect(
    offerPriceOf(assigned, driver1.session.userId),
    'у назначенного водителя сохранилось именно его предложение',
  ).toBe(OFFER_PRICE.driver1)

  // Проигравший исполнителем не стал. `drivers` — записи участия, а не список
  // исполнителей, поэтому проверяется не отсутствие записи, а её состояние.
  // Замерено на gruzvill: бэкенд оставляет проигравшего Considering и сохраняет
  // его предложение (e2e/README.md, TEST-E2E-004).
  const loserState = driverStateOf(assigned, driver2.session.userId)
  expect(
    loserState,
    `второй водитель после выбора не исполнитель, а ${stateName(loserState)}`,
  ).not.toBe(DRIVER_STATE.Performer)
  expect(
    ([DRIVER_STATE.Considering, DRIVER_STATE.Canceled] as number[]).includes(Number(loserState)),
    `второй водитель в корректном состоянии после выбора: ${stateName(loserState)}`,
  ).toBe(true)

  // ШАГ 9 (AC-8) — пассажир видит ИМЕННО того водителя, которого назначил
  // бэкенд. Сверяется идентификатор, а не имя: имя не уникально.
  await expectPassengerDriverState(
    passengerPage, DRIVER_STATE.Performer, 'пассажир видит назначенного водителя')
  expect(
    await passengerDriverId(passengerPage),
    'пассажиру показан тот же водитель, что назначен на бэкенде',
  ).toBe(driver1.session.userId)

  // ШАГ 10 (AC-9) — выбранный водитель выезжает: backend, водительский и
  // пассажирский интерфейсы согласованы на Arrived.
  //
  // Карта открывается переходом, а не вкладкой: исполнителем водитель стал уже
  // после отправки предложения и ЧУЖИМ действием — выбором пассажира, — поэтому
  // на карточке заказа основного действия карты ещё нет (как и у А.1.2).
  await openDriverMap(driver1.page)

  // Приложение сообщает водителю, что его предложение приняли, и пока это окно
  // открыто, до карты не добраться — оно модальное. Это часть контракта А.1.3, а
  // не помеха: у стандартного заказа и у голосования такого уведомления нет
  // (pages/Driver/index.tsx, driver-offer-realtime-watch — окно показывается
  // только для заказа, который приложение считает предложением). Поэтому оно же
  // служит подтверждением со стороны водителя: его предложение приняли.
  await confirmActionResult(
    driver1.page, 'success', 'водитель 1 уведомлён, что его предложение принято')

  await expectUiDriverState(
    driver1.page, DRIVER_STATE.Performer, 'карта водителя показывает принятый заказ')
  await clickPrimaryAction(driver1.page)
  await expectBackendState(orderId, driver1, DRIVER_STATE.Arrived, 'бэкенд перевёл заказ в Arrived')
  await expectUiDriverState(driver1.page, DRIVER_STATE.Arrived, 'карта показывает прибытие')
  await expectPassengerDriverState(
    passengerPage, DRIVER_STATE.Arrived, 'пассажир видит, что водитель прибыл')

  // ШАГ 11 (AC-10) — начало поездки. У А.1.3 переход Arrived → Started идёт
  // ПРЯМЫМ действием, без кода посадки: код гейтится isVotingOrder, а не
  // isOfferOrder (pages/Driver/Map.tsx). Это проверяется явно — иначе тест
  // молча прошёл бы и по чужому пути.
  expect(
    await isBoardingFormVisible(driver1.page),
    'у заказа-предложения формы кода посадки нет — это путь голосования',
  ).toBe(false)
  await clickPrimaryAction(driver1.page)
  await expectBackendState(orderId, driver1, DRIVER_STATE.Started, 'бэкенд перевёл заказ в Started')
  await expectUiDriverState(driver1.page, DRIVER_STATE.Started, 'карта показывает начатую поездку')
  expect(
    await isBoardingFormVisible(driver1.page),
    'поездка началась без ввода кода посадки',
  ).toBe(false)

  // ШАГ 12 (AC-10) — пассажир видит начало поездки.
  await expectPassengerDriverState(
    passengerPage, DRIVER_STATE.Started, 'пассажир видит, что поездка началась')

  // ШАГ 13 (AC-11) — в поездке ровно один водитель, и это автор принятого
  // предложения. Проигравший в неё не попал ни на одном шаге.
  const started = await readOrder(passenger, orderId)
  const inTrip = orderDriverStates(started)
    .filter(item => item.state >= DRIVER_STATE.Performer)
    .map(item => item.userId)
  expect(inTrip, 'поездку выполняет ровно один водитель — тот, чьё предложение приняли')
    .toEqual([driver1.session.userId])
  expect(
    driverStateOf(started, driver1.session.userId),
    'выбранный водитель находится именно в Started',
  ).toBe(DRIVER_STATE.Started)
  expect(
    offerPriceOf(started, driver1.session.userId),
    'поездка идёт по цене принятого предложения',
  ).toBe(OFFER_PRICE.driver1)
})
