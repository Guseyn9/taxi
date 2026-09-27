/**
 * TEST-E2E-006 — А.1.5, отмена заказа пассажиром. Живой backend.
 *
 * НЕГАТИВНАЯ ветка заказа-предложения, зеркальная A.1.4 по сценарию и НЕ
 * зеркальная по backend-контракту: водитель предложил свои условия → пассажир
 * выбрал его → **пассажир отменяет уже назначенный заказ**. В A.1.4 инициатор
 * отказа — водитель; здесь тот же класс события инициирует пассажир, и, как
 * показала разведка (e2e/README.md, TEST-E2E-006), тот же `set_cancel_state`
 * даёт другой результат в зависимости от инициатора.
 *
 * Что здесь настоящее: frontend, Taxi API, состояние заказа, переходы FSM и обе
 * роли — у пассажира и у водителя свой браузерный контекст со своей сессией. Ни
 * один endpoint сценария не подменяется; единственный мок — тайлы карты.
 *
 * Второй водитель НЕ используется: разведка показала, что после пассажирской
 * отмены заказ уходит в терминальное `Canceled` и НЕ возвращается в поиск (в
 * отличие от A.1.4) — второй водитель здесь ничего не доказал бы, только
 * усложнил сценарий.
 *
 * ═══ КОНТРАКТ ОТМЕНЫ ЗАМЕРЕН ДО НАПИСАНИЯ ТЕСТА ═══════════════════════════════
 *
 * Измерено на живом gruzvill (e2e/README.md, TEST-E2E-006; 2 чистых
 * воспроизводимых прогона основной кнопки + 1 контрастный прогон альтернативной):
 *
 *   пассажир нажимает основную кнопку "Cancel" (НЕ инлайн "Отменить" у аватара
 *   водителя — та лишь снимает кандидата (`releaseCandidate`), и backend её
 *   отклоняет для уже назначенного Performer: `wrong booking state`)
 *           ↓
 *   b_state заказа:     Approved(2) → Canceled(3)           ← ТЕРМИНАЛЬНО
 *   performer заказа:   [driver]    → [driver] — НЕ МЕНЯЕТСЯ
 *   c_state водителя:   Performer(3) → Performer(3) — НЕ МЕНЯЕТСЯ
 *   заказ активен:      true        → false
 *   возврат в поиск:    ОТСУТСТВУЕТ (в отличие от A.1.4)
 *
 * Отсюда главная особенность этого теста, зеркальная A.1.4:
 *
 * 1. **Инвариант строится на паре `b_state` + `active`, а не на `performer`/
 *    `c_state`.** В A.1.4 отказ снимает исполнителя (`performer: none`,
 *    `c_state → Canceled`) — это и было главным сигналом. Здесь НАОБОРОТ:
 *    `performer` и `c_state` водителя ОСТАЮТСЯ такими же, как у назначенного
 *    исполнителя. Это НЕ ошибка измерения и НЕ значит, что заказ активен —
 *    реальный признак завершения заказа — `active=false` и терминальный
 *    `b_state`, а запись участия водителя на этот переход backend просто не
 *    реагирует.
 *
 * 2. **Тем не менее водитель не может продолжить заказ.** Несмотря на то что его
 *    `c_state` формально остался `Performer(3)`, экран карты после отмены не
 *    показывает НИКАКОГО основного действия («Приехал» и т.п.) — приложение
 *    решает это не сбросом записи участия, а тем, что отменённый заказ просто не
 *    приходит водителю как активный/текущий.
 *
 * 3. **Водитель проактивно уведомляется об отмене.** Обнаружено прогоном (не
 *    входило в разведку по коду): та же инфраструктура, что показывает окно
 *    «предложение принято» (`components/modals/MessageModal.tsx`,
 *    `pages/Driver/index.tsx` → `notifyClientCancelled`), поднимает окно со
 *    статусом `warning` и текстом «Клиент отменил заказ». Пока оно открыто,
 *    оверлей перехватывает клики — тест подтверждает его так же, как и офферное
 *    окно, прежде чем проверять экран карты.
 */

import { Browser, BrowserContext, Page, devices, expect, test } from '@playwright/test'
import { appUrl, driverAccount, passengerAccount } from './fixtures/accounts'
import { stubMapTiles } from './fixtures/appShell'
import {
  DRIVER_STATE,
  ISession,
  ICar,
  ISweepResult,
  cancelOrder,
  cancelTestOrders,
  createOfferOrder,
  customerPriceOf,
  driverStateOf,
  getDriverCar,
  goOnline,
  isOfferOrderSnapshot,
  isOrderActiveFor,
  login,
  offerPriceOf,
  orderDriverStates,
  performersOf,
  readOrder,
} from './fixtures/taxiApi'
import {
  DESTINATION,
  DRIVER_LIST_PAGE,
  DRIVER_STORAGE,
  PICKUP,
  STATE_NAMES,
  confirmActionResult,
  isOfferFormVisible,
  offerPriceInput,
  offerSendButton,
  openOfferForm,
  openOrderCard,
  orderCard,
  uiDriverState,
} from './fixtures/driverUi'
import {
  PASSENGER_PAGE,
  PASSENGER_STORAGE,
  cancelAssignedOrder,
  chooseVotingCandidate,
  expectCandidateOfferPrice,
  expectOrderVisibleToPassenger,
  expectPassengerDriverState,
  expectVotingCandidates,
  miniOrderCard,
  openPassengerVotingOrder,
  passengerDriverId,
  passengerDriverPanelFor,
} from './fixtures/passengerUi'
import { expectAppBooted } from './fixtures/appShell'

test.describe.configure({ timeout: 8 * 60 * 1000 })

const LABEL = 'A15'

/** Состояние заказа целиком (b_state, types/types.ts → EBookingStates). */
const ORDER_STATE = { Processing: 1, Approved: 2, Canceled: 3 } as const

/** Цена предложения — отличается от цены заказчика (150), чтобы не спутать значения. */
const OFFER_PRICE = 733

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

  reportSweep('перед прогоном', await cancelTestOrders(passenger))

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
        `исполнители: ${order ? performersOf(order).map(id => `u${id}`).join(',') || 'нет' : 'unknown'} | ` +
        `водитель=u${driver?.session?.userId} (car ${driver?.car?.c_id}) | ` +
        `участники заказа: ${participants}`
      console.error(`E2E FAILURE DIAGNOSTICS: ${diagnostics}`)
      testInfo.annotations.push({ type: 'backend', description: diagnostics })
    }
  }

  // Уборка. Успешный прогон сам переводит заказ в терминальное Canceled(3) —
  // повторная попытка отмены такого заказа закономерно отбивается backend'ом
  // («wrong booking state»), это не сбой уборки, а подтверждение результата.
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
    reportSweep('после прогона', await cancelTestOrders(passenger))
  } catch (error) {
    console.error(`E2E SWEEP FAILED: ${reason(error)}`)
  }
})

/** Состояние конкретного водителя в заказе — независимая от UI проверка. */
async function backendDriverState(orderId: string): Promise<number | undefined> {
  const order = await readOrder(passenger, orderId)
  return driverStateOf(order, driver.session.userId)
}

async function backendOrderState(orderId: string): Promise<number> {
  const order = await readOrder(passenger, orderId)
  return Number(order.b_state)
}

/** Водитель формирует и подтверждает своё предложение — целиком через интерфейс. */
async function makeOffer(price: number): Promise<void> {
  await openOfferForm(driver.page)

  const input = offerPriceInput(driver.page)
  await input.fill(String(price))
  await expect(input, 'введённая цена отображается в форме').toHaveValue(String(price))

  await offerSendButton(driver.page).click()
  await expect
    .poll(() => isOfferFormVisible(driver.page), {
      message: 'приложение приняло предложение и закрыло форму',
      timeout: 90_000,
    })
    .toBe(false)
}

test('А.1.5 — отмена заказа пассажиром: заказ не уезжает в поездку и не возвращается в поиск', async() => {
  // ШАГ 1-3. Предусловие: заказ режима «Предложение», проверенный контракт (те же
  // признаки, что и в TEST-E2E-004/005).
  const orderId = await createOfferOrder(passenger, {
    pickup: PICKUP,
    destination: DESTINATION,
    carClassId: driver.car.cc_id,
    label: LABEL,
    maxWaitingSeconds: 900,
  })
  createdOrders.push(orderId)

  const created = await readOrder(passenger, orderId)
  expect(created.b_id, 'заказ создан и читается с бэкенда').toBe(orderId)
  expect(isOfferOrderSnapshot(created), 'заказ опознаётся приложением как «Предложение»').toBe(true)
  expect(customerPriceOf(created), 'у заказа есть цена заказчика').toBe(150)
  expect(Number(created.b_state), 'заказ активен и ждёт водителей').toBe(ORDER_STATE.Processing)
  expect(orderDriverStates(created), 'у только что созданного заказа участников нет').toEqual([])

  // ШАГ 4 — пассажир открывает заказ через UI.
  await expectOrderVisibleToPassenger(passengerPage, orderId)

  // ШАГ 5-6 — водитель открывает список заказов через UI и «принимает» заказ
  // через предложение (тот же путь, что и в A.1.4 — офферный заказ становится
  // Performer только после выбора пассажира).
  await openOrderCard(driver.page, orderId)
  await makeOffer(OFFER_PRICE)

  await expect
    .poll(() => backendDriverState(orderId), { message: 'водитель стал кандидатом со своим предложением', timeout: 90_000 })
    .toBe(DRIVER_STATE.Considering)
  await expect
    .poll(async() => offerPriceOf(await readOrder(passenger, orderId), driver.session.userId), {
      message: 'backend сохранил цену предложения водителя',
      timeout: 90_000,
    })
    .toBe(OFFER_PRICE)

  await openPassengerVotingOrder(passengerPage, orderId)
  await expectVotingCandidates(passengerPage, [driver.session.userId])
  await expectCandidateOfferPrice(
    passengerPage, driver.session.userId, OFFER_PRICE, 'пассажир видит предложение водителя с его ценой')
  await chooseVotingCandidate(passengerPage, driver.session.userId)

  // ШАГ 7 (AC-02) — независимо проверить backend: выбран именно этот водитель,
  // водитель — Performer, заказ — Approved.
  await expect
    .poll(() => backendDriverState(orderId), { message: 'водитель стал исполнителем', timeout: 90_000 })
    .toBe(DRIVER_STATE.Performer)
  const assigned = await readOrder(passenger, orderId)
  expect(performersOf(assigned), 'исполнитель ровно один, и это выбранный пассажиром водитель')
    .toEqual([driver.session.userId])
  expect(Number(assigned.b_state), 'заказ перешёл в состояние с назначенным исполнителем')
    .toBe(ORDER_STATE.Approved)

  await expectPassengerDriverState(passengerPage, DRIVER_STATE.Performer, 'пассажир видит назначенного водителя')
  expect(await passengerDriverId(passengerPage), 'пассажиру показан тот же водитель, что назначен на бэкенде')
    .toBe(driver.session.userId)

  // Водитель подтверждает уведомление «предложение принято» — иначе модальное
  // окно перехватывает клики и мешает наблюдать реальный экран карты дальше.
  await confirmActionResult(driver.page, 'success', 'водитель уведомлён, что его предложение приняли')

  // ДО ОТМЕНЫ (AC-01/AC-02, «До отмены» из ТЗ): заказ существует, активен, ровно
  // один Performer — именно выбранный водитель.
  const beforeCancel = await readOrder(passenger, orderId)
  expect(Number(beforeCancel.b_state), 'до отмены заказ в состоянии Approved').toBe(ORDER_STATE.Approved)
  expect(performersOf(beforeCancel), 'до отмены исполнитель ровно один').toEqual([driver.session.userId])
  expect(await isOrderActiveFor(passenger, orderId), 'до отмены заказ активен').toBe(true)

  // ШАГ 8 (AC-03) — пассажир отменяет заказ ЧЕРЕЗ ИНТЕРФЕЙС: основная кнопка
  // "Cancel", затем подтверждение в модалке причины. Endpoint отмены из теста не
  // вызывается — ни `set_cancel_state`, ни что-либо ещё.
  await cancelAssignedOrder(passengerPage)

  // ШАГ 9 (AC-04, AC-05) — независимая backend-проверка фактического перехода.
  //
  // Инвариант строится на паре `b_state` + `active`, А НЕ на `performer`/
  // `c_state`: контракт этого теста — зеркальный A.1.4. Замерено, что
  // `performer` и `c_state` водителя НЕ обнуляются (см. шапку файла и
  // e2e/README.md). Поэтому здесь явно проверяется и то, что они СОХРАНИЛИСЬ —
  // чтобы обратное поведение (например, ошибочный сброс исполнителя) не прошло
  // молча как «более правильное».
  await expect
    .poll(() => backendOrderState(orderId), {
      message: 'бэкенд перевёл заказ в терминальное Canceled после отмены пассажиром',
      timeout: 90_000,
    })
    .toBe(ORDER_STATE.Canceled)

  const cancelled = await readOrder(passenger, orderId)
  expect(
    performersOf(cancelled),
    'запись участия водителя НЕ сбрасывается — она остаётся Performer (замеренный, а не предполагаемый контракт)',
  ).toEqual([driver.session.userId])
  expect(
    driverStateOf(cancelled, driver.session.userId),
    'c_state водителя остаётся Performer(3) — отмена пассажира на это поле не влияет',
  ).toBe(DRIVER_STATE.Performer)
  expect(
    await isOrderActiveFor(passenger, orderId),
    'заказ перестал быть активным — это и есть реальный признак завершения, а не performer/c_state',
  ).toBe(false)

  // ШАГ 10 (AC-06) — UI пассажира: панель назначенного водителя исчезла.
  // Проверка через локатор, а не через текст сообщения.
  await expect(
    passengerDriverPanelFor(passengerPage, driver.session.userId),
    'пассажир больше не видит отменённого водителя исполнителем',
  ).toHaveCount(0, { timeout: 90_000 })

  // ШАГ 11 (AC-07) — UI водителя.
  //
  // Замерено прогоном: приложение проактивно уведомляет водителя об отмене той
  // же инфраструктурой, что и «предложение принято»
  // (components/modals/MessageModal.tsx, pages/Driver/index.tsx →
  // notifyClientCancelled), статусом `warning` и текстом «Клиент отменил заказ».
  // Подтверждаем его так же, как и офферное окно, — иначе оверлей перехватывает
  // клики по вкладкам.
  await confirmActionResult(driver.page, 'warning', 'водитель уведомлён, что пассажир отменил заказ')

  // Несмотря на то что его c_state формально остался Performer, экран карты не
  // предлагает НИКАКОГО действия по этому заказу — приложение не приводит
  // водителя в состояние, продолжающее отменённую поездку.
  await driver.page.getByTestId('driver-tab-map').click()
  await expect
    .poll(() => uiDriverState(driver.page), {
      message: 'у водителя нет основного действия по отменённому заказу',
      timeout: 90_000,
    })
    .toBeUndefined()

  // ШАГ 12-13 (AC-08) — persistence: reload пассажира, состояние соответствует
  // backend, а не восстановленному локальному состоянию. Замеренный контракт —
  // заказ пропадает из списка целиком (b_state терминален), а не остаётся в
  // другом активном виде, как в A.1.4.
  await passengerPage.goto(PASSENGER_PAGE)
  await expectAppBooted(passengerPage)
  await expect(
    miniOrderCard(passengerPage, orderId),
    'после reload отменённый заказ пропал из списка активных заказов пассажира',
  ).toHaveCount(0, { timeout: 90_000 })

  const afterReload = await readOrder(passenger, orderId)
  expect(Number(afterReload.b_state), 'после reload заказ по-прежнему Canceled').toBe(ORDER_STATE.Canceled)
  expect(await isOrderActiveFor(passenger, orderId), 'после reload заказ по-прежнему неактивен').toBe(false)

  // ШАГ 14 (AC-09, замена — возврата в поиск нет) — разведка показала, что в
  // отличие от A.1.4 заказ НЕ возвращается в поиск: он остаётся терминальным и
  // больше не предлагается тому же водителю. Второй водитель для этого не нужен:
  // достаточно убедиться, что заказ пропал и из списка ТОГО ЖЕ водителя.
  await driver.page.goto(DRIVER_LIST_PAGE)
  await expectAppBooted(driver.page)
  await expect(
    orderCard(driver.page, orderId),
    'отменённый заказ не предлагается водителю повторно — возврата в поиск нет',
  ).toHaveCount(0, { timeout: 30_000 })
})
