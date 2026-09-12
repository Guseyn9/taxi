/**
 * TEST-E2E-005 — А.1.4, отказ выбранного водителя. Живой backend.
 *
 * НЕГАТИВНАЯ ветка заказа-предложения: водитель предложил свои условия →
 * пассажир выбрал именно его → водитель отказался от назначенного заказа →
 * система НЕ переводит заказ в поездку и возвращает его в поиск исполнителя.
 *
 * Зачем именно этот сценарий. А.1.1 проверяет прямое назначение, А.1.2 —
 * конкурентный выбор, А.1.3 — конкурентные ценовые предложения. Все три
 * проверяют УСПЕШНОЕ назначение. Здесь проверяется инвариант FSM, которого не
 * проверяет ни один из них:
 *
 *   выбор кандидата сам по себе не гарантирует начала поездки, если выбранный
 *   водитель затем отказывается.
 *
 * Что здесь настоящее: frontend, Taxi API, состояние заказа, переходы FSM и все
 * ТРИ роли — у пассажира и у каждого водителя свой браузерный контекст со своей
 * сессией. Ни один endpoint сценария не подменяется; единственный мок — тайлы
 * карты.
 *
 * Через API делается только подготовка предусловия (водители на линии, заказ
 * создан) и НЕЗАВИСИМАЯ от интерфейса проверка состояния заказа. Все действия
 * сценария — клики и ввод в браузере: и предложение, и выбор исполнителя
 * пассажиром, и отказ водителя.
 *
 * ОБЪЁМ ТЕСТА — то же осознанное решение, что и в А.1.1–А.1.3: создание заказа
 * здесь является fixture/предусловием и покрытием пассажирской формы создания
 * заказа НЕ считается. Обоснование — e2e/README.md.
 *
 * ═══ КОНТРАКТ ОТКАЗА ЗАМЕРЕН ДО НАПИСАНИЯ ТЕСТА ═══════════════════════════════
 *
 * ТЗ намеренно не задавало финальное `b_state` заранее. Оно установлено
 * измерением на живом gruzvill (e2e/README.md, TEST-E2E-005; backend-часть
 * воспроизведена на трёх заказах, UI-часть — на четвёртом):
 *
 *   отказ выбранного водителя
 *           ↓
 *   c_state водителя:  Performer(3) → Canceled(2)
 *   performer заказа:  есть → none
 *   b_state заказа:    Approved(2) → Processing(1)      ← ВОЗВРАТ В ПОИСК
 *   заказ активен:     да
 *   предложение:       СОХРАНЯЕТСЯ
 *
 * Отсюда три особенности этого теста:
 *
 * 1. **Инвариант строится на паре `b_state` + `c_state`.** Одного «водитель
 *    больше не Performer» недостаточно: замерено, что тот же `set_cancel_state`
 *    от ПАССАЖИРА даёт другой результат — заказ уходит в `Canceled`, а водитель
 *    остаётся `Performer`. Различает эти два случая только пара полей.
 *
 * 2. **Исчезновение предложения НЕ проверяется** — оно сохраняется. Проверка
 *    «предложения больше нет» противоречила бы контракту.
 *
 * 3. **Возврат в поиск проверяется поведением, а не числом.** После отказа
 *    второй водитель отправляет своё предложение, и пассажир его видит. Это
 *    доказывает, что заказ действительно снова принимает предложения, а не
 *    просто что `b_state` совпал с ожидаемым числом.
 *
 * ═══ ПОЧЕМУ СЦЕНАРИЙ НЕ ВОЗВРАЩАЕТСЯ К СПИСКУ ЗАКАЗОВ ════════════════════════
 *
 * Карточка заказа перерисовывается по данным заказа, поэтому после выбора
 * пассажира она сама переходит в ветку `Performer` — навигация не нужна. Это
 * важно: при возврате к списку окно «предложение принято» всплывает ЗАНОВО
 * (watcher поднимает его при каждом монтировании, пока водитель `Performer`), и
 * оверлей перехватывает клики. Замерено, см. README.
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
  confirmActionResult,
  declineAssignedOrder,
  expectOrderInDriverList,
  isOfferFormVisible,
  isOrderCancelAvailable,
  offerPriceInput,
  offerSendButton,
  openOfferForm,
  openOrderCard,
  orderCard,
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
  passengerDriverPanelFor,
  passengerDriverPanelInTrip,
} from './fixtures/passengerUi'

// Сценарий длиннее А.1.3: после отказа проверяется ещё и возврат заказа в поиск
// вторым водителем. Каждое ожидание — по факту, а не по таймеру.
test.describe.configure({ timeout: 12 * 60 * 1000 })

const LABEL = 'A14'

/** Состояние заказа целиком (b_state, types/types.ts → EBookingStates). */
const ORDER_STATE = { Processing: 1, Approved: 2, Canceled: 3 } as const

/**
 * Цены предложений. Разные и обе отличаются от цены заказчика (150): совпадение
 * значений скрыло бы путаницу между водителями.
 */
const OFFER_PRICE = { driver1: 617, driver2: 823 } as const

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

  // Смысл А.1.4 требует двух РАЗНЫХ водителей: первый отказывается, второй
  // доказывает, что заказ действительно вернулся в поиск. Одна и та же учётка в
  // обеих переменных этого не проверит.
  expect(
    driver2.session.userId,
    'второй водитель — отдельная учётка: E2E_DRIVER2_* должен указывать не на того же пользователя',
  ).not.toBe(driver1.session.userId)

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
        `исполнители: ${order ? performersOf(order).map(id => `u${id}`).join(',') || 'нет' : 'unknown'} | ` +
        `отказавшийся=u${driver1?.session?.userId} (car ${driver1?.car?.c_id}), ` +
        `второй=u${driver2?.session?.userId} (car ${driver2?.car?.c_id}) | ` +
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
 * Три шага, потому что ТЗ требует проверить каждый: форма открылась, введённое
 * значение отображается, предложение отправлено. Приложение подтверждает приём
 * не окном, а состоянием карточки — success-попап для предложения оно
 * сознательно не показывает (components/modals/CardModal.tsx), поэтому признаком
 * принятого действия служит закрывшаяся форма.
 */
async function makeOffer(role: IRole, price: number): Promise<void> {
  await openOfferForm(role.page)

  const input = offerPriceInput(role.page)
  await input.fill(String(price))
  await expect(input, `${role.title}: введённая цена отображается в форме`)
    .toHaveValue(String(price))

  await offerSendButton(role.page).click()
  await expect
    .poll(() => isOfferFormVisible(role.page), {
      message: `${role.title}: приложение приняло предложение и закрыло форму`,
      timeout: 90_000,
    })
    .toBe(false)
}

test('А.1.4 — отказ выбранного водителя: заказ не уезжает в поездку и возвращается в поиск', async() => {
  // ШАГ 1. Предусловие: заказ режима «Предложение», общий для обоих водителей и
  // с ожиданием из доверенного окна пассажирского интерфейса.
  const orderId = await createOfferOrder(passenger, {
    pickup: PICKUP,
    destination: DESTINATION,
    carClassId: driver1.car.cc_id,
    label: LABEL,
    maxWaitingSeconds: 900,
  })
  createdOrders.push(orderId)

  // ПРОВЕРКА 1 — заказ создан и однозначно опознаётся как А.1.3/OFFER. Это те же
  // проверенные признаки, что и в TEST-E2E-004: проверяется контракт целиком, а
  // не одно поле, потому что заказ, потерявший любой из признаков, приложением
  // «Предложением» не считается — и водительской формы предложения не будет.
  const created = await readOrder(passenger, orderId)
  expect(created.b_id, 'заказ создан и читается с бэкенда').toBe(orderId)
  expect(isOfferOrderSnapshot(created), 'заказ опознаётся приложением как «Предложение»').toBe(true)
  expect(String(created.b_location_class), 'класс поездки межгородний').toBe(INTERCITY_LOCATION_CLASS)
  expect(customerPriceOf(created), 'у заказа есть цена заказчика').toBe(150)
  expect(String(created.b_voting ?? '0'), 'заказ НЕ голосовой — это другой режим').toBe('0')
  expect(Number(created.b_state), 'заказ активен и ждёт водителей').toBe(ORDER_STATE.Processing)
  expect(orderDriverStates(created), 'у только что созданного заказа участников нет').toEqual([])

  // ШАГ 2 — пассажир видит ИМЕННО созданный заказ.
  await expectOrderVisibleToPassenger(passengerPage, orderId)

  // ШАГ 3 — водитель 1 открывает список заказов и находит именно этот заказ:
  // карточка ищется по номеру заказа, а не берётся первая подходящая (AC-10).
  await openOrderCard(driver1.page, orderId)

  // ШАГ 4 — тот же заказ доступен и второму водителю.
  //
  // Список ему открывается ЗДЕСЬ, а не на шаге 16, и остаётся открытым до конца
  // сценария. Причина замерена: пока страница открыта, приложение опрашивает
  // список, и карточка сама исчезает, когда заказ занят, и возвращается, когда
  // освобождается. Свежая же загрузка страницы каждый раз заново играет в гонку
  // старта опроса (дефект приложения, см. e2e/README.md) — на шаге 16, в конце
  // длинного сценария, это давало падения.
  //
  // Заодно это и проверка AC-2: один и тот же заказ виден обоим водителям.
  await expectOrderInDriverList(driver2.page, orderId)

  // ШАГИ 4-6 — водитель 1 формирует предложение через интерфейс: форма
  // открылась, цена отображается, предложение отправлено. Endpoint предложения
  // из теста не вызывается.
  await makeOffer(driver1, OFFER_PRICE.driver1)

  // Предложение реально дошло до бэкенда — и с ценой именно этого водителя.
  await expectBackendState(
    orderId, driver1, DRIVER_STATE.Considering, 'водитель 1 стал кандидатом со своим предложением')
  await expect
    .poll(() => backendOfferPrice(orderId, driver1), {
      message: 'backend сохранил цену предложения водителя 1',
      timeout: 90_000,
    })
    .toBe(OFFER_PRICE.driver1)

  // Предложение исполнителя НЕ назначает — этим А.1.3/А.1.4 отличаются от А.1.1.
  const withOffer = await readOrder(passenger, orderId)
  expect(performersOf(withOffer), 'предложение само по себе исполнителя не назначает').toEqual([])
  expect(Number(withOffer.b_state), 'заказ по-прежнему ждёт выбора пассажира')
    .toBe(ORDER_STATE.Processing)

  // ШАГ 7 — пассажир открывает карточку заказа и видит предложение ИМЕННО этого
  // водителя: сверяется сырое значение цены из разметки, а не отформатированная
  // подпись с валютой из конфигурации бэкенда.
  await openPassengerVotingOrder(passengerPage, orderId)
  await expectVotingCandidates(passengerPage, [driver1.session.userId])
  await expectCandidateOfferPrice(
    passengerPage, driver1.session.userId, OFFER_PRICE.driver1,
    'пассажир видит предложение водителя 1 с его ценой')

  // ШАГ 8 — пассажир выбирает этого водителя кликом. Подменять это действие
  // вызовом endpoint нельзя (AC-11).
  await chooseVotingCandidate(passengerPage, driver1.session.userId)

  // ШАГ 9 — независимая проверка: выбранный водитель соответствует тому, кого
  // выбрал пассажир, и исполнитель ровно один.
  await expectBackendState(
    orderId, driver1, DRIVER_STATE.Performer, 'после выбора пассажира водитель 1 стал исполнителем')
  const assigned = await readOrder(passenger, orderId)
  expect(performersOf(assigned), 'исполнитель ровно один, и это выбранный пассажиром водитель')
    .toEqual([driver1.session.userId])
  expect(Number(assigned.b_state), 'заказ перешёл в состояние с назначенным исполнителем')
    .toBe(ORDER_STATE.Approved)
  expect(
    driverStateOf(assigned, driver2.session.userId),
    'второй водитель в заказе не участвует и исполнителем не стал',
  ).toBeUndefined()

  // Пассажир видит ИМЕННО того водителя, которого назначил бэкенд. Сверяется
  // идентификатор, а не имя: имя не уникально.
  await expectPassengerDriverState(
    passengerPage, DRIVER_STATE.Performer, 'пассажир видит назначенного водителя')
  expect(
    await passengerDriverId(passengerPage),
    'пассажиру показан тот же водитель, что назначен на бэкенде',
  ).toBe(driver1.session.userId)

  // ШАГ 10 — водитель получает состояние выбранного предложения, и ему доступно
  // действие отказа.
  //
  // Приложение сообщает водителю о принятом предложении модальным окном, и пока
  // оно открыто, оверлей перехватывает клики. Тест подтверждает окно кликом, как
  // это делает водитель. Окно показывается ТОЛЬКО для заказа, который приложение
  // считает предложением (pages/Driver/index.tsx, driver-offer-realtime-watch), —
  // то есть это ещё и независимое подтверждение режима заказа.
  await confirmActionResult(
    driver1.page, 'success', 'водитель 1 уведомлён, что его предложение приняли')

  // Карточка перерисовалась в ветку назначенного исполнителя: формы предложения
  // больше нет, зато появилось действие отказа. К списку заказов не возвращаемся
  // намеренно — см. шапку файла.
  expect(
    await isOfferFormVisible(driver1.page),
    'после назначения формы предложения у водителя больше нет',
  ).toBe(false)
  expect(
    await isOrderCancelAvailable(driver1.page),
    'водителю-исполнителю доступно действие отказа от заказа',
  ).toBe(true)

  // ШАГ 11 — водитель отказывается ЧЕРЕЗ ИНТЕРФЕЙС: действие и подтверждение в
  // окне. Endpoint отмены из теста не вызывается (AC-05, AC-11).
  await declineAssignedOrder(driver1.page)

  // ШАГ 12 (AC-06) — независимая проверка: отказавшийся водитель больше не
  // исполнитель. Замерено, что бэкенд переводит его именно в Canceled и снимает
  // исполнителя с заказа.
  await expectBackendState(
    orderId, driver1, DRIVER_STATE.Canceled, 'бэкенд снял участие отказавшегося водителя')

  const declined = await readOrder(passenger, orderId)
  expect(performersOf(declined), 'после отказа у заказа нет исполнителя').toEqual([])
  expect(
    performersOf(declined),
    'отказавшийся водитель не остался исполнителем',
  ).not.toContain(driver1.session.userId)

  // ШАГ 13 (AC-07) — заказ НЕ уехал в поездку. Проверяются оба уровня: и
  // состояние заказа, и состояние водителя, потому что по одному полю случаи
  // «отказался водитель» и «отменил пассажир» не различить.
  expect(Number(declined.b_state), 'заказ не отменён — он вернулся в поиск исполнителя')
    .toBe(ORDER_STATE.Processing)
  expect(
    Number(declined.b_state),
    'заказ не ушёл в терминальное состояние отмены',
  ).not.toBe(ORDER_STATE.Canceled)
  expect(
    orderDriverStates(declined).filter(item => item.state >= DRIVER_STATE.Performer),
    'в заказе нет ни одного водителя в состоянии Performer или дальше — поездка не началась',
  ).toEqual([])
  expect(await isOrderActiveFor(passenger, orderId), 'заказ остался активным у пассажира').toBe(true)

  // Предложение отказавшегося СОХРАНЯЕТСЯ — это замеренный контракт, а не
  // недочёт. Проверяется явно, чтобы обратное поведение не прошло молча.
  expect(
    offerPriceOf(declined, driver1.session.userId),
    'предложение отказавшегося водителя остаётся в записи участия',
  ).toBe(OFFER_PRICE.driver1)

  // ШАГ 14 (AC-08) — пассажир не видит поездку с отказавшимся водителем.
  //
  // Проверяется отсутствие панели ИМЕННО этого водителя, а не панели вообще:
  // панель с другим водителем была бы корректна, а с отказавшимся — нарушение.
  //
  // Утверждения о локаторах, а не чтение атрибутов: в этот момент панель как раз
  // исчезает, и раздельные «есть ли элемент» + «прочитать атрибут» гоняются
  // между собой — `passengerDriverId` на исчезающей панели виснет до таймаута
  // (наступало в прогоне полной сюиты). Локаторное утверждение Playwright
  // перепроверяет сам.
  await expect(
    passengerDriverPanelFor(passengerPage, driver1.session.userId),
    'пассажир больше не видит отказавшегося водителя исполнителем',
  ).toHaveCount(0, { timeout: 90_000 })
  await expect(
    passengerDriverPanelInTrip(passengerPage),
    'интерфейс пассажира не показывает начавшуюся поездку ни с одним водителем',
  ).toHaveCount(0, { timeout: 90_000 })

  // ШАГ 15 (AC-09) — persistence: после перезагрузки состояние не
  // восстанавливается из старого frontend state.
  //
  // Перезагрузка — это `goto` внутри `expectOrderVisibleToPassenger`. Отдельным
  // вызовом её не дублируем: приложение тянет конфигурацию с сервера при каждой
  // загрузке (src/config.ts), и лишняя загрузка — лишний риск на ровном месте.
  await expectOrderVisibleToPassenger(passengerPage, orderId)
  await expect(
    passengerDriverPanelFor(passengerPage, driver1.session.userId),
    'после перезагрузки отказавшийся водитель не вернулся исполнителем',
  ).toHaveCount(0, { timeout: 90_000 })

  const afterReload = await readOrder(passenger, orderId)
  expect(Number(afterReload.b_state), 'после перезагрузки заказ по-прежнему в поиске')
    .toBe(ORDER_STATE.Processing)
  expect(performersOf(afterReload), 'после перезагрузки исполнителя по-прежнему нет').toEqual([])
  expect(
    driverStateOf(afterReload, driver1.session.userId),
    'отказавшийся водитель остался в состоянии отказа',
  ).toBe(DRIVER_STATE.Canceled)

  // ШАГ 16 — заказ действительно вернулся в фазу поиска, и это проверяется
  // ПОВЕДЕНИЕМ, а не совпадением числа: второй водитель отправляет своё
  // предложение через интерфейс, и пассажир его получает. Если бы заказ остался
  // занятым отказавшимся водителем, этот шаг был бы невозможен.
  //
  // Карточка ждётся в УЖЕ ОТКРЫТОМ списке второго водителя (открыт на шаге 4),
  // без повторной загрузки страницы: заказ возвращается в список сам, опросом
  // приложения. Замерено, что backend держит его доступным устойчиво — проверен
  // интервал до 4 минут после отказа.
  const driver2Card = orderCard(driver2.page, orderId)
  await expect(driver2Card, 'заказ вернулся в список второго водителя')
    .toBeVisible({ timeout: 120_000 })
  await driver2Card.click()
  await makeOffer(driver2, OFFER_PRICE.driver2)
  await expectBackendState(
    orderId, driver2, DRIVER_STATE.Considering,
    'после отказа заказ снова принимает предложения — второй водитель стал кандидатом')
  await expect
    .poll(() => backendOfferPrice(orderId, driver2), {
      message: 'backend сохранил цену предложения второго водителя',
      timeout: 90_000,
    })
    .toBe(OFFER_PRICE.driver2)

  await openPassengerVotingOrder(passengerPage, orderId)
  await expectCandidateOfferPrice(
    passengerPage, driver2.session.userId, OFFER_PRICE.driver2,
    'пассажир видит предложение второго водителя — поиск исполнителя продолжился')

  // ФИНАЛЬНАЯ ПРОВЕРКА (AC-06, AC-07, AC-12) — отказавшийся водитель не вернулся
  // в игру, исполнителя по-прежнему нет, поездка не началась.
  const final = await readOrder(passenger, orderId)
  expect(
    driverStateOf(final, driver1.session.userId),
    'отказавшийся водитель так и остался в состоянии отказа',
  ).toBe(DRIVER_STATE.Canceled)
  expect(performersOf(final), 'нового исполнителя без выбора пассажира не появилось').toEqual([])
  expect(
    orderDriverStates(final).filter(item => item.state >= DRIVER_STATE.Performer),
    'поездка так и не началась ни с одним водителем',
  ).toEqual([])
  expect(Number(final.b_state), 'заказ остался в фазе поиска исполнителя')
    .toBe(ORDER_STATE.Processing)
})
