/**
 * TEST-E2E-008 — создание заказа через UI пассажира. Живой backend.
 *
 * Доказывает полный путь, который раньше не покрывал ни один E2E (TEST-E2E-002…006
 * создают заказ через API как предусловие):
 *
 *   форма пассажира → клик по кнопке режима → реальный POST /drive →
 *   backend создаёт заказ → независимое чтение заказа → заказ в UI пассажира
 *
 * Три независимых сценария — 008-A Standard, 008-B Voting, 008-C Offer. Каждый
 * создаёт СВОЙ заказ, и все проверки сценария относятся к одному `b_id`: тому,
 * что пришёл в ответе на настоящий создающий запрос браузера.
 *
 * Что здесь запрещено и нигде не используется: createStandardOrder /
 * createVotingOrder / createOfferOrder, POST /drive из теста, Redux,
 * localStorage, page.evaluate() для бизнес-состояния, route.fulfill() для /drive,
 * nth()/first() для бизнес-элементов. Единственный мок — тайлы карты. API здесь
 * нужен только для входа, независимого чтения заказа и уборки.
 *
 * Контракт (что именно уходит в запрос и сохраняется в backend, почему Offer
 * идёт на межгородское назначение, почему кнопка режима и есть «создать») —
 * в e2e/README.md, раздел TEST-E2E-008.
 */

import { Browser, BrowserContext, Page, devices, expect, test } from '@playwright/test'
import { appUrl, passengerAccount, passengerPhone } from './fixtures/accounts'
import { stubMapTiles } from './fixtures/appShell'
import { DESTINATION, PICKUP } from './fixtures/driverUi'
import {
  IOrderCreation,
  IOrderCreationWatch,
  IPassengerOrderPoint,
  PASSENGER_ORDER_POINTS,
  PASSENGER_STORAGE,
  TPassengerOrderMode,
  expandPassengerOrderForm,
  pressPassengerOrderModeAgain,
  slowPassengerNetwork,
  expectPassengerLocationClass,
  expectPassengerOrderCreated,
  fillPassengerOrderPoints,
  fillPassengerPhone,
  openPassengerOrderForm,
  setPassengerOfferPrice,
  submitPassengerOrder,
  watchOrderCreationRequest,
} from './fixtures/passengerUi'
import {
  INTERCITY_LOCATION_CLASS,
  IOrderSnapshot,
  ISession,
  ISweepResult,
  cancelOrder,
  cancelTestOrders,
  customerPriceOf,
  isOfferOrderSnapshot,
  listActiveOrders,
  login,
  readOrder,
} from './fixtures/taxiApi'

/** Цена заказчика в Offer — обычное значение для текущей конфигурации. */
const OFFER_PRICE = 150

/** Геокодер отдаёт координаты дома, а не фикстуры: разброс замерен ~30 м. */
const POINT_TOLERANCE_M = 150
/** Межгородское назначение (Таганрог, Петровская 10): замерено 47.2069, 38.9426. */
const INTERCITY_DESTINATION = { latitude: 47.2069, longitude: 38.9426 }
const INTERCITY_TOLERANCE_M = 1000

/**
 * Защита от двойного создания (AC-12). Первый запрос растягивается замедлением
 * сети браузера — запрос и ответ настоящие, просто идут дольше, — а за это время
 * пассажир нажимает кнопку режима ещё несколько раз.
 */
const DOUBLE_PRESS_LATENCY_MS = 2_000
const REPEATED_PRESSES = 3
/** Заказы одного сценария создаются в пределах этого окна; всё, что старше, — чужое. */
const SAME_SCENARIO_WINDOW_MS = 60_000

let passenger: ISession
let context: BrowserContext
let page: Page
let watch: IOrderCreationWatch | undefined

/** Что известно о сценарии — для диагностики при падении и для cleanup. */
const state: { scenario: string; orderId?: string; httpStatus?: number } = { scenario: '' }
const createdOrders: string[] = []

const reason = (error: unknown) => (error as Error)?.message ?? String(error)

function reportSweep(when: string, result: ISweepResult): void {
  if (result.cancelled)
    console.log(`E2E sweep (${when}): отменено тестовых заказов — ${result.cancelled}`)
  if (result.skipped.length)
    console.warn(
      `E2E sweep (${when}): не тронуто заказов — ${result.skipped.length} ` +
      `(${result.skipped.join(', ')}). Уборка отменяет только заказы с тестовыми метками.`)
}

/** Отдельная сессия пассажира: свежий браузерный контекст на каждый сценарий. */
async function openPassengerSession(browser: Browser): Promise<BrowserContext> {
  const session = await browser.newContext({
    ...devices['Desktop Chrome'],
    storageState: PASSENGER_STORAGE,
    baseURL: appUrl(),
    locale: 'ru-RU',
    permissions: ['geolocation'],
    geolocation: PICKUP,
  })
  session.setDefaultTimeout(30_000)
  session.setDefaultNavigationTimeout(60_000)
  await stubMapTiles(session)
  return session
}

test.beforeAll(async() => {
  passenger = await login(passengerAccount(), 'пассажир')
  // Уборка трогает только заказы с тестовыми метками. Заказ, созданный через
  // форму, метки не несёт, поэтому после каждого сценария он отменяется по своему
  // b_id (afterEach), а не уборкой по метке.
  reportSweep('перед прогоном', await cancelTestOrders(passenger))
})

test.beforeEach(async({ browser }, testInfo) => {
  state.scenario = testInfo.title
  state.orderId = undefined
  state.httpStatus = undefined
  watch = undefined
  context = await openPassengerSession(browser)
  page = await context.newPage()
})

test.afterEach(async({}, testInfo) => {
  const failed = testInfo.status !== testInfo.expectedStatus

  // При падении нужно, чем разбираться. Только идентификаторы и поля заказа — ни
  // токена, ни пароля, ни cookie, ни auth_hash.
  if (failed) {
    let backend = 'заказ не создан'
    if (state.orderId) {
      const order = await readOrder(passenger, state.orderId).catch(() => undefined)
      backend = order ?
        `b_state=${order.b_state} b_voting=${order.b_voting ?? 'нет'} ` +
        `b_location_class=${order.b_location_class} customer_price=${customerPriceOf(order) ?? 'нет'}` :
        'заказ не читается с backend'
    }
    const diagnostics = `scenario="${state.scenario}" orderId=${state.orderId ?? 'not-created'} ` +
      `passengerId=${passenger?.userId} endpoint=POST /drive httpStatus=${state.httpStatus ?? 'нет ответа'} ` +
      `${backend} | создающие запросы: ${watch?.describe() ?? 'наблюдение не ставилось'}`
    console.error(`E2E FAILURE DIAGNOSTICS: ${diagnostics}`)
    testInfo.annotations.push({ type: 'backend', description: diagnostics })
  }

  // Если из-за дефекта создалось несколько заказов, уборка должна убрать каждый,
  // а не только первый: ждём ответы на все отправленные создающие запросы.
  if (watch) {
    await expect.poll(() => watch!.settled(), { timeout: 15_000 }).toBe(true).catch(() => undefined)
    for (const orderId of watch.orderIds())
      if (!createdOrders.includes(orderId))
        createdOrders.push(orderId)
  }
  watch?.dispose()

  // Каждый сценарий убирает ровно СВОЙ заказ (все, что создал он сам). Чужие и немеченые заказы пассажира
  // не трогаем. Не вышло — заказ остался живым, его номер обязан попасть в лог.
  while (createdOrders.length) {
    const orderId = createdOrders.pop() as string
    try {
      await cancelOrder(passenger, orderId)
    } catch (error) {
      console.error(
        `E2E CLEANUP FAILED: orderId=${orderId} — заказ остался на backend, ` +
        `отмените его вручную. Причина: ${reason(error)}`)
      testInfo.annotations.push({ type: 'cleanup-failed', description: `orderId=${orderId}` })
    }
  }

  await context?.close()
})

test.afterAll(async() => {
  if (!passenger)
    return
  try {
    reportSweep('после прогона', await cancelTestOrders(passenger))
  } catch (error) {
    console.error(`E2E SWEEP FAILED: ${reason(error)}`)
  }
})

// ───────────────────────────── общая механика ──────────────────────────────

/** Расстояние между двумя точками, метры. */
function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (value: number) => value * Math.PI / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(h))
}

const coordinate = (latitude: unknown, longitude: unknown) =>
  ({ latitude: Number(latitude), longitude: Number(longitude) })

/** Есть ли в значении услуга «голосование» (EServices.Voting = 5): массив, строка или null. */
function hasVotingService(services: unknown): boolean {
  const list = Array.isArray(services) ?
    services :
    typeof services === 'string' ? services.split(/[^0-9]+/) : []
  return list.some(item => String(item).trim() === '5')
}

/** Цена заказчика: backend и форма отдают то число, то массив из одного числа. */
function customerPriceFrom(options: any): number | undefined {
  const raw = Array.isArray(options?.customer_price) ? options.customer_price[0] : options?.customer_price
  const value = Number(raw)
  return raw === undefined || raw === null || raw === '' || !Number.isFinite(value) ? undefined : value
}

const digitsOf = (value: unknown) => String(value ?? '').replace(/\D/g, '')

/**
 * Ввод формы пользователем: точки, раскрытие, телефон. Класс поездки приложение
 * определяет само по маршруту — ждём то, что пассажир ВИДИТ, до клика по режиму.
 */
async function enterOrderForm(destination: IPassengerOrderPoint, locationClass: string): Promise<void> {
  await openPassengerOrderForm(page)
  await fillPassengerOrderPoints(page, PASSENGER_ORDER_POINTS.pickup, destination)
  await expectPassengerLocationClass(page, locationClass)
  await expandPassengerOrderForm(page)
  await fillPassengerPhone(page, passengerPhone())
}

/**
 * Клик по кнопке режима — это и есть создание (в форме нет отдельной кнопки
 * «Создать»). Наблюдение ставится ДО клика. `b_id` берётся из ответа настоящего
 * запроса; запоминается для cleanup.
 */
async function clickCreate(mode: TPassengerOrderMode): Promise<IOrderCreation> {
  watch = watchOrderCreationRequest(page)

  // Первое нажатие и сразу повторные — пока первый запрос ещё обрабатывается.
  // Что именно они пришлись на это время, проверяется: ответа ещё нет.
  const restoreNetwork = await slowPassengerNetwork(page, DOUBLE_PRESS_LATENCY_MS)
  try {
    await submitPassengerOrder(page, mode)
    await pressPassengerOrderModeAgain(page, mode, REPEATED_PRESSES)
    expect(watch.responded(), 'повторные нажатия пришлись на обработку первого запроса').toBe(false)
  } finally {
    await restoreNetwork()
  }

  const created = await watch.waitForCreated()
  state.orderId = created.orderId
  state.httpStatus = created.status
  createdOrders.push(created.orderId)
  return created
}

/** Общие проверки запроса: он настоящий, один, и в нём есть всё, что нужно для заказа. */
function expectCreationRequest(
  created: IOrderCreation,
  destination: { latitude: number; longitude: number },
  destinationTolerance: number,
): void {
  const { payload } = created.request

  expect(watch?.requests.length, 'ушёл ровно один запрос создания заказа').toBe(1)
  expect(created.status, 'HTTP-статус создающего запроса').toBe(200)
  expect(created.body?.status, 'backend принял заказ').toBe('success')

  const start = coordinate(payload.b_start_latitude, payload.b_start_longitude)
  const finish = coordinate(payload.b_destination_latitude, payload.b_destination_longitude)
  expect(Number.isFinite(start.latitude) && Number.isFinite(start.longitude), 'в запросе есть координаты старта').toBe(true)
  expect(Number.isFinite(finish.latitude) && Number.isFinite(finish.longitude), 'в запросе есть координаты назначения').toBe(true)
  expect(distanceMeters(start, PICKUP), 'старт из запроса — это выбранная подсказка PICKUP').toBeLessThan(POINT_TOLERANCE_M)
  expect(distanceMeters(finish, destination), 'назначение из запроса — это выбранная подсказка').toBeLessThan(destinationTolerance)

  expect(digitsOf(payload.b_contact), 'контакт — телефон, введённый в форму').toBe(passengerPhone())
  expect(Number(payload.b_passengers_count), 'число пассажиров валидно').toBeGreaterThanOrEqual(1)
  expect(Number.isInteger(Number(payload.b_passengers_count)), 'число пассажиров целое').toBe(true)
  expect(String(payload.b_car_class ?? ''), 'класс авто указан').not.toBe('')
  expect(payload.b_payment_way, 'способ оплаты указан').toBeDefined()
}

/** Общие проверки заказа на backend: именно тот b_id и те же точки, что ушли из браузера. */
async function readCreatedOrder(created: IOrderCreation): Promise<IOrderSnapshot> {
  const order = await readOrder(passenger, created.orderId)
  const { payload } = created.request

  expect(order.b_id, 'backend отдаёт именно созданный заказ').toBe(created.orderId)
  // Backend округляет координаты до 6 знаков — сверяем с этой точностью.
  // Сверяются ВСЕ четыре координаты: ошибка в любой из них не должна пройти незамеченной.
  const coordinates: Array<[string, unknown, unknown]> = [
    ['широта старта', order.b_start_latitude, payload.b_start_latitude],
    ['долгота старта', order.b_start_longitude, payload.b_start_longitude],
    ['широта назначения', order.b_destination_latitude, payload.b_destination_latitude],
    ['долгота назначения', order.b_destination_longitude, payload.b_destination_longitude],
  ]
  for (const [name, saved, sent] of coordinates) {
    expect(Number.isFinite(Number(saved)), `backend вернул ${name}`).toBe(true)
    expect(Math.abs(Number(saved) - Number(sent)), `${name} сохранена как в запросе`).toBeLessThan(1e-5)
  }
  expect(digitsOf(order.b_contact), 'контакт сохранён как в запросе').toBe(passengerPhone())
  return order
}

/**
 * Один сценарий — один созданный заказ (AC-12). Повторные нажатия не должны ни
 * породить второй создающий запрос, ни второй заказ на backend. Заказ-дубль был бы
 * неотличим от оригинала по содержимому, поэтому ищем в активных заказах
 * пассажира всё, что совпадает адресами и контактом и создано в окне сценария.
 */
async function expectSingleOrder(created: IOrderCreation, order: IOrderSnapshot): Promise<void> {
  expect(watch?.requests.length, 'повторные нажатия не породили второй создающий запрос').toBe(1)

  const createdAt = Date.parse(String(order.b_created))
  expect(Number.isFinite(createdAt), 'у заказа есть время создания').toBe(true)

  const active = Object.values(await listActiveOrders(passenger))
  const sameScenario = active
    .filter(item =>
      item.b_start_address === order.b_start_address &&
      item.b_destination_address === order.b_destination_address &&
      digitsOf(item.b_contact) === digitsOf(order.b_contact) &&
      Math.abs(Date.parse(String(item.b_created)) - createdAt) < SAME_SCENARIO_WINDOW_MS)
    .map(item => String(item.b_id))

  expect(sameScenario, 'на backend один сценарий — один созданный заказ').toEqual([created.orderId])
}

// ─────────────────────────────── сценарии ──────────────────────────────────

test.describe('TEST-E2E-008 — создание заказа через UI пассажира', () => {
  test('008-A Standard: форма → POST /drive → обычный заказ → заказ в UI', async() => {
    await test.step('UI: ввод формы', () =>
      enterOrderForm(PASSENGER_ORDER_POINTS.destination, '1'))

    const created = await test.step('UI: клик «Order» → настоящий POST /drive', () =>
      clickCreate('order'))

    await test.step('Network: запрос создания Standard', () => {
      expectCreationRequest(created, DESTINATION, POINT_TOLERANCE_M)
      const { payload } = created.request
      // Нет признаков Voting и Offer.
      expect(Boolean(payload.b_voting), 'UI: нажат Order → в запросе нет b_voting').toBe(false)
      expect(hasVotingService(payload.b_services), 'UI: нажат Order → в запросе нет услуги голосования').toBe(false)
      expect(String(payload.b_cars_count ?? ''), 'UI: нажат Order → нет признака Offer b_cars_count=0').not.toBe('0')
      expect(String(payload.b_location_class), 'UI: нажат Order → не межгородский класс поездки').not.toBe(INTERCITY_LOCATION_CLASS)
    })

    const order = await test.step('Backend: независимое чтение заказа', async() => {
      const read = await readCreatedOrder(created)
      expect(String(read.b_voting ?? '0'), 'backend не считает заказ голосовым').not.toBe('1')
      expect(hasVotingService(read.b_services), 'у заказа нет услуги голосования').toBe(false)
      expect(isOfferOrderSnapshot(read), 'backend не считает заказ предложением').toBe(false)
      return read
    })

    await test.step('UI: пассажир видит именно этот заказ', () =>
      expectPassengerOrderCreated(page, order.b_id))

    await test.step('Двойное нажатие: один сценарий — один заказ', () =>
      expectSingleOrder(created, order))
  })

  test('008-B Voting: форма → POST /drive (голосование) → backend подтверждает Voting → заказ в UI', async() => {
    await test.step('UI: ввод формы', () =>
      enterOrderForm(PASSENGER_ORDER_POINTS.destination, '1'))

    const created = await test.step('UI: клик «Vote» → настоящий POST /drive', () =>
      clickCreate('vote'))

    await test.step('Network: запрос создания Voting', () => {
      expectCreationRequest(created, DESTINATION, POINT_TOLERANCE_M)
      const { payload } = created.request
      // Признак голосования в запросе — услуга 5: поля b_voting форма в /drive не
      // шлёт, его выводит backend (README, TEST-E2E-008).
      expect(hasVotingService(payload.b_services), 'UI: нажат Vote → в запросе должна быть услуга голосования (5); режим из UI не совпал с созданным').toBe(true)
      const waiting = Number(payload.b_max_waiting)
      expect(Number.isFinite(waiting) && waiting > 0, 'b_max_waiting — положительное число').toBe(true)
      expect(String(payload.b_cars_count ?? ''), 'нет признака Offer b_cars_count=0').not.toBe('0')
    })

    const order = await test.step('Backend: независимое чтение заказа', async() => {
      const read = await readCreatedOrder(created)
      expect(String(read.b_voting), 'UI: нажат Vote → backend подтверждает голосование: b_voting = 1').toBe('1')
      expect(hasVotingService(read.b_services), 'у заказа есть услуга голосования').toBe(true)
      return read
    })

    await test.step('UI: пассажир видит именно этот заказ', () =>
      expectPassengerOrderCreated(page, order.b_id))

    // Отклик водителей и сам выбор исполнителя — TEST-E2E-003, здесь не проверяются.
    await test.step('Двойное нажатие: один сценарий — один заказ', () =>
      expectSingleOrder(created, order))
  })

  test('008-C Offer: форма → цена → POST /drive → контракт Offer на backend → заказ в UI', async() => {
    await test.step('UI: ввод формы (межгородской маршрут) и цены', async() => {
      // Класс поездки «2» приложение выставляет само только на межгородском
      // маршруте; на городском UI шлёт «1» даже после ручного выбора Intercity
      // (README, TEST-E2E-008). Поэтому Offer идёт на другое назначение.
      await enterOrderForm(PASSENGER_ORDER_POINTS.intercityDestination, INTERCITY_LOCATION_CLASS)
      await setPassengerOfferPrice(page, OFFER_PRICE)
    })

    const created = await test.step('UI: клик «Offer» → настоящий POST /drive', () =>
      clickCreate('offer'))

    await test.step('Network: запрос создания Offer', () => {
      expectCreationRequest(created, INTERCITY_DESTINATION, INTERCITY_TOLERANCE_M)
      const { payload } = created.request
      expect(String(payload.b_location_class), 'UI: нажат Offer → в запросе межгородский класс поездки').toBe(INTERCITY_LOCATION_CLASS)
      expect(customerPriceFrom(payload.b_options), 'UI: нажат Offer → в запросе цена заказчика из UI').toBe(OFFER_PRICE)
      expect(hasVotingService(payload.b_services), 'в запросе нет услуги голосования').toBe(false)
      // b_cars_count=0 исторически признак Offer, но backend его не сохраняет
      // (возвращает "1"), поэтому здесь он не проверяется и инвариантом не служит.
    })

    const order = await test.step('Backend: независимое чтение заказа', async() => {
      const read = await readCreatedOrder(created)
      expect(String(read.b_location_class), 'backend сохранил межгородский класс').toBe(INTERCITY_LOCATION_CLASS)
      expect(customerPriceOf(read), 'backend сохранил цену заказчика из UI').toBe(OFFER_PRICE)
      expect(String(read.b_voting ?? '0'), 'backend не считает заказ голосовым').not.toBe('1')
      expect(isOfferOrderSnapshot(read), 'приложение опознаёт заказ как «Предложение»').toBe(true)
      return read
    })

    await test.step('UI: пассажир видит именно этот заказ', () =>
      expectPassengerOrderCreated(page, order.b_id))

    await test.step('Двойное нажатие: один сценарий — один заказ', () =>
      expectSingleOrder(created, order))
  })
})
