/**
 * TEST-E2E-009 — сквозной Standard-заказ: создание пассажиром через UI и обработка
 * водителем через UI. Живой backend.
 *
 * Одна цепочка на ОДНОМ `b_id`, полученном из ответа настоящего `POST /drive`:
 *
 *   форма пассажира → заказ на backend → карточка ЭТОГО заказа у водителя →
 *   «Взять заказ» → назначение на backend → панель водителя у пассажира →
 *   «Поехал» (Arrived) → «Приехал» (Started) → адресная отмена →
 *   независимое подтверждение, что заказ отменён и больше не активен
 *
 * TEST-E2E-002 создаёт заказ через API, TEST-E2E-008 проходит форму, но без
 * водителя. Здесь они связаны одним заказом.
 *
 * Что здесь запрещено и нигде не используется: create*Order, POST /drive из теста,
 * назначение водителя и переходы FSM из теста, Redux, localStorage,
 * page.evaluate() для бизнес-действий, route.fulfill() для бизнес-endpoint,
 * nth()/first(), waitForTimeout(). Единственный мок — тайлы карты. API нужен для
 * входа, подготовки водителя (на линии), НЕЗАВИСИМОГО чтения заказа и очистки.
 *
 * Состояние, которое показывает интерфейс, не считается доказательством: карта
 * водителя ставит оптимистичное `data-driver-state` в момент клика
 * (pages/Driver/Map.tsx), поэтому каждый переход сначала подтверждается на
 * backend, и только потом сверяются оба интерфейса.
 *
 * Контракт и допущения — e2e/TEST-E2E-009-recon.md.
 */

import { Browser, BrowserContext, Page, devices, expect, test } from '@playwright/test'
import { appUrl, driverAccount, passengerAccount, passengerPhone } from './fixtures/accounts'
import { stubMapTiles } from './fixtures/appShell'
import {
  DRIVER_STORAGE,
  IOrderActionWatch,
  PICKUP,
  DESTINATION,
  driverMapAction,
  expectDriverMapState,
  expectOrderInDriverList,
  isBoardingFormVisible,
  orderCard,
  switchToDriverMap,
  takeOrderButton,
  watchOrderActions,
} from './fixtures/driverUi'
import {
  IOrderCreationWatch,
  PASSENGER_ORDER_POINTS,
  PASSENGER_STORAGE,
  expandPassengerOrderForm,
  expectPassengerDriverPanel,
  expectPassengerLocationClass,
  expectPassengerOrderCreated,
  fillPassengerOrderPoints,
  fillPassengerPhone,
  openPassengerOrderForm,
  passengerDriverPanelOfOrder,
  submitPassengerOrder,
  watchOrderCreationRequest,
} from './fixtures/passengerUi'
import {
  BackendError,
  DRIVER_STATE,
  ICar,
  IOrderSnapshot,
  ISession,
  cancelOrder,
  driverStateOf,
  getDriverCar,
  goOnline,
  listActiveOrders,
  login,
  orderDriverStates,
  readOrder,
} from './fixtures/taxiApi'

// Сценарий проходит весь путь до начала поездки; каждое ожидание — по условию.
test.describe.configure({ timeout: 8 * 60 * 1000 })

/** `b_state` заказа (types/types.ts → EBookingStates). */
const ORDER_STATE = { Processing: 1, Approved: 2, Canceled: 3 } as const

/** Геокодер отдаёт координаты дома, а не фикстуры: разброс замерен ~30 м (README, 008). */
const POINT_TOLERANCE_M = 150
/** Радиус, в котором приложение считает водителя «у точки посадки» (tools/driverPosition.ts). */
const PICKUP_ARRIVAL_RADIUS_M = 100
/** Сколько раз подряд пытаемся отменить свой заказ, прежде чем сообщить о сбое очистки. */
const CLEANUP_ATTEMPTS = 5

let driver: ISession
let passenger: ISession
let car: ICar
let passengerContext: BrowserContext
let driverContext: BrowserContext
let passengerPage: Page
let driverPage: Page
let creationWatch: IOrderCreationWatch | undefined
let actionWatch: IOrderActionWatch | undefined

/** Что известно о сценарии — для диагностики при падении. */
const state: {
  stage: string
  orderId?: string
  creationHttp?: number
  activeBefore: string[]
  readNetworkFailures: number
  startedAt: number
} = { stage: 'подготовка', activeBefore: [], readNetworkFailures: 0, startedAt: Date.now() }

/**
 * Перейти к этапу сценария. Этап попадает и в диагностику падения, и в вывод
 * прогона: по строке `E2E STAGE` видно, до какого этапа дошёл тест и с каким
 * `b_id`. Токенов и паролей в строке нет.
 */
function enterStage(name: string): void {
  state.stage = name
  const seconds = ((Date.now() - state.startedAt) / 1000).toFixed(1)
  console.log(`E2E STAGE [${seconds}s] ${name} | orderId=${state.orderId ?? '-'}`)
}

/** Все `b_id`, созданные ЭТИМ прогоном, включая неожиданные дубли. */
const createdOrders: string[] = []

const reason = (error: unknown) => (error as Error)?.message ?? String(error)

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

const digitsOf = (value: unknown) => String(value ?? '').replace(/\D/g, '')

/** Есть ли в значении услуга «голосование» (EServices.Voting = 5): массив, строка или null. */
function hasVotingService(services: unknown): boolean {
  const list = Array.isArray(services) ?
    services :
    typeof services === 'string' ? services.split(/[^0-9]+/) : []
  return list.some(item => String(item).trim() === '5')
}

/**
 * Независимое чтение заказа с backend. Соединение с живым backend может
 * не установиться — тогда чтение «пока неизвестно» (`undefined`), а не падение с
 * чужой причиной, но число таких сбоев копится и попадает в диагностику, чтобы
 * недоступность backend не выдавалась ни за успех, ни за функциональный дефект.
 * Любая другая ошибка (в том числе ответ backend) пробрасывается как есть.
 */
async function tryReadOrder(orderId: string): Promise<IOrderSnapshot | undefined> {
  try {
    return await readOrder(passenger, orderId)
  } catch (error) {
    if (error instanceof BackendError && /нет соединения/.test(error.message)) {
      state.readNetworkFailures += 1
      return undefined
    }
    throw error
  }
}

async function driverStateOnBackend(orderId: string): Promise<number | undefined> {
  const order = await tryReadOrder(orderId)
  return order ? driverStateOf(order, driver.userId) : undefined
}

/** Дождаться состояния НАШЕГО водителя на backend — независимо от интерфейса. */
async function expectBackendDriverState(orderId: string, expected: number, message: string): Promise<void> {
  await expect
    .poll(() => driverStateOnBackend(orderId), { message, timeout: 90_000, intervals: [500, 1_000, 2_000] })
    .toBe(expected)
}

/**
 * Тело ответа наблюдатель читает асинхронно: перед проверкой итога запросов
 * дожидаемся, пока у каждого есть ответ. Это ожидание события, а не пауза.
 */
async function expectActionsAnswered(orderId: string, action: string): Promise<void> {
  await expect
    .poll(
      () => actionWatch!.of(orderId, action).every(item => item.status !== undefined || item.httpStatus !== undefined),
      { message: `у запросов ${action} есть ответы: ${actionWatch!.describe(orderId)}`, timeout: 15_000 },
    )
    .toBe(true)
}

/** Исполнители заказа — водители в `Performer` и дальше. `Considering`/`Canceled` исполнителями не считаются. */
function executorsOf(order: IOrderSnapshot): string[] {
  return orderDriverStates(order)
    .filter(item => item.state >= DRIVER_STATE.Performer)
    .map(item => item.userId)
}

/** Второго активного исполнителя нет: исполнитель один, это наш водитель, остальные не в игре. */
function expectSingleExecutor(order: IOrderSnapshot, message: string): void {
  expect(executorsOf(order), `${message}: исполнитель один — наш водитель`).toEqual([driver.userId])
  const others = orderDriverStates(order)
    .filter(item => item.userId !== driver.userId && item.state !== DRIVER_STATE.Canceled)
    .map(item => `${item.userId}:c_state=${item.state}`)
  expect(others, `${message}: других водителей в игре нет`).toEqual([])
}

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

test.beforeAll(async() => {
  driver = await login(driverAccount(), 'водитель')
  passenger = await login(passengerAccount(), 'пассажир')
  car = await getDriverCar(driver)
  await goOnline(driver, car, PICKUP)

  // Уборка по меткам здесь не вызывается: заказ из формы меток не несёт, а чужие
  // заказы пассажира тест не трогает. Список «до» нужен только для диагностики.
  state.activeBefore = Object.keys(await listActiveOrders(passenger))
})

test.beforeEach(async({ browser }) => {
  state.stage = 'подготовка'
  state.startedAt = Date.now()
  state.orderId = undefined
  state.creationHttp = undefined
  state.readNetworkFailures = 0
  creationWatch = undefined
  actionWatch = undefined
  createdOrders.length = 0

  passengerContext = await openSession(browser, PASSENGER_STORAGE)
  driverContext = await openSession(browser, DRIVER_STORAGE)
  passengerPage = await passengerContext.newPage()
  driverPage = await driverContext.newPage()
  actionWatch = watchOrderActions(driverPage)
})

/** Что видят оба интерфейса сейчас — для диагностики. Читает атрибуты, ничего не меняет. */
async function describeUi(orderId: string | undefined): Promise<string> {
  const read = async(page: Page | undefined, selector: string, attribute: string) => {
    if (!page || page.isClosed())
      return 'страница закрыта'
    return await page.locator(selector).getAttribute(attribute, { timeout: 2_000 }).catch(() => 'нет') ?? 'нет'
  }
  const driverSelector = orderId ?
    `[data-testid="driver-map-primary-action"][data-order-id="${orderId}"]` :
    '[data-testid="driver-map-primary-action"]'
  const panelSelector = orderId ?
    `[data-testid="passenger-driver-panel"][data-order-id="${orderId}"]` :
    '[data-testid="passenger-driver-panel"]'
  return `UI водителя: data-driver-state=${await read(driverPage, driverSelector, 'data-driver-state')}; ` +
    `UI пассажира: data-driver-state=${await read(passengerPage, panelSelector, 'data-driver-state')}, ` +
    `data-driver-id=${await read(passengerPage, panelSelector, 'data-driver-id')}`
}

/**
 * Отменить ровно свой заказ и убедиться независимым чтением, что он отменён и не
 * активен. Повторяется только сама очистка (до CLEANUP_ATTEMPTS раз): ошибки
 * проверок сценария это не скрывает — они уже зафиксированы тестом. Признаки
 * «заказ закрыт» — `b_state = Canceled(3)` и отсутствие в `listActiveOrders`.
 */
async function cleanUpOrder(orderId: string): Promise<{ confirmed: boolean; detail: string }> {
  let lastError = ''
  for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS; attempt += 1) {
    const current = await tryReadOrder(orderId).catch(() => undefined)
    if (current && Number(current.b_state) === ORDER_STATE.Canceled)
      break
    try {
      await cancelOrder(passenger, orderId)
    } catch (error) {
      lastError = reason(error)
    }
  }

  const finalOrder = await tryReadOrder(orderId).catch(error => {
    lastError = reason(error)
    return undefined
  })
  const activeIds = await listActiveOrders(passenger)
    .then(list => Object.keys(list))
    .catch(error => {
      lastError = reason(error)
      return undefined
    })

  const cancelled = finalOrder !== undefined && Number(finalOrder.b_state) === ORDER_STATE.Canceled
  const inactive = activeIds !== undefined && !activeIds.includes(orderId)
  const detail = `orderId=${orderId} b_state=${finalOrder?.b_state ?? 'не прочитан'} ` +
    `в listActiveOrders=${activeIds === undefined ? 'не прочитан' : activeIds.includes(orderId)}` +
    (lastError ? ` последняя ошибка очистки: ${lastError}` : '')
  return { confirmed: cancelled && inactive, detail }
}

test.afterEach(async({}, testInfo) => {
  const failed = testInfo.status !== testInfo.expectedStatus

  // Дубль приходит позже первого запроса: ждём ответы на ВСЕ отправленные
  // создающие запросы, а потом убираем каждый заказ, а не только первый.
  if (creationWatch) {
    await expect.poll(() => creationWatch!.settled(), { timeout: 15_000 }).toBe(true).catch(() => undefined)
    for (const orderId of creationWatch.orderIds())
      if (!createdOrders.includes(orderId))
        createdOrders.push(orderId)
  }
  if (state.orderId && !createdOrders.includes(state.orderId))
    createdOrders.push(state.orderId)

  // При падении нужно, чем разбираться. Только идентификаторы и состояния — ни
  // токена, ни пароля, ни cookie, ни auth_hash.
  if (failed) {
    let backend = 'заказ не создан'
    if (state.orderId) {
      const order = await tryReadOrder(state.orderId).catch(() => undefined)
      backend = order ?
        `b_state=${order.b_state} drivers=${JSON.stringify(orderDriverStates(order))}` :
        'заказ с backend не прочитан'
    }
    const diagnostics = `этап="${state.stage}" orderId=${state.orderId ?? 'not-created'} ` +
      `driverId=${driver?.userId} passengerId=${passenger?.userId} carId=${car?.c_id} ` +
      `endpoint=POST /drive httpStatus=${state.creationHttp ?? 'нет ответа'} | backend: ${backend} | ` +
      `${await describeUi(state.orderId)} | ` +
      `создающие запросы: ${creationWatch?.describe() ?? 'наблюдение не ставилось'} | ` +
      `действия водителя: ${actionWatch?.describe(state.orderId) ?? 'наблюдение не ставилось'} | ` +
      `создано заказов: [${createdOrders.join(', ')}] | ` +
      `сбоев соединения при чтении backend: ${state.readNetworkFailures}`
    console.error(`E2E FAILURE DIAGNOSTICS: ${diagnostics}`)
    testInfo.annotations.push({ type: 'backend', description: diagnostics })
  }

  creationWatch?.dispose()
  actionWatch?.dispose()

  const problems: string[] = []
  for (const orderId of [...createdOrders].reverse()) {
    const result = await cleanUpOrder(orderId)
    testInfo.annotations.push({ type: 'cleanup', description: `${result.detail} подтверждено=${result.confirmed}` })
    console.log(`E2E CLEANUP ${result.confirmed ? 'OK' : 'UNCONFIRMED'}: ${result.detail}`)
    if (!result.confirmed) {
      console.error(
        `E2E CLEANUP FAILED: orderId=${orderId} — заказ мог остаться на backend, ` +
        `отмените его вручную. ${result.detail}`)
      testInfo.annotations.push({ type: 'cleanup-failed', description: `orderId=${orderId}` })
      problems.push(result.detail)
    }
  }

  await passengerContext?.close()
  await driverContext?.close()

  console.log(
    `E2E RESULT status=${testInfo.status} последний этап="${state.stage}" ` +
    `заказы=[${createdOrders.join(', ')}] очистка=${problems.length ? 'НЕ подтверждена' : 'подтверждена'} ` +
    `сбоев соединения при чтении backend=${state.readNetworkFailures}`)

  // Неподтверждённая очистка — не «мелочь»: это живой заказ с назначенным водителем.
  expect(problems, 'очистка подтверждена независимым чтением: b_state=3 и заказа нет в listActiveOrders').toEqual([])
})

test('TEST-E2E-009 — Standard: форма пассажира → карточка водителя → принятие → Arrived → Started на одном b_id', async() => {
  // ───────────── 1. Пассажир создаёт заказ через настоящую форму ─────────────
  enterStage('1. форма пассажира')
  await test.step('Пассажир заполняет форму: адреса из подсказок, контакт', async() => {
    await openPassengerOrderForm(passengerPage)
    await fillPassengerOrderPoints(passengerPage, PASSENGER_ORDER_POINTS.pickup, PASSENGER_ORDER_POINTS.destination)
    await expectPassengerLocationClass(passengerPage, '1')
    await expandPassengerOrderForm(passengerPage)
    await fillPassengerPhone(passengerPage, passengerPhone())
  })

  enterStage('2. создание заказа (POST /drive)')
  // Наблюдение ставится ДО клика: так виден ровно один запрос и не теряется быстрый ответ.
  creationWatch = watchOrderCreationRequest(passengerPage)
  await submitPassengerOrder(passengerPage, 'order')
  const created = await creationWatch.waitForCreated()
  const orderId = created.orderId
  state.orderId = orderId
  state.creationHttp = created.status
  createdOrders.push(orderId)

  await test.step('Запрос создания: один, настоящий, с корректными данными', async() => {
    const { payload } = created.request
    expect(creationWatch!.requests.length, 'ушёл ровно один запрос создания заказа').toBe(1)
    expect(created.status, 'HTTP-статус создающего запроса').toBe(200)
    expect(created.body?.status, 'backend принял заказ').toBe('success')

    const start = coordinate(payload.b_start_latitude, payload.b_start_longitude)
    const finish = coordinate(payload.b_destination_latitude, payload.b_destination_longitude)
    expect(distanceMeters(start, PICKUP), 'старт из запроса — выбранная подсказка').toBeLessThan(POINT_TOLERANCE_M)
    expect(distanceMeters(finish, DESTINATION), 'назначение из запроса — выбранная подсказка').toBeLessThan(POINT_TOLERANCE_M)
    expect(digitsOf(payload.b_contact), 'контакт — телефон, введённый в форму').toBe(passengerPhone())
    expect(payload.b_voting ?? null, 'Standard: признака голосования в запросе нет').toBeNull()
    expect(hasVotingService(payload.b_services), 'Standard: услуги «голосование» в запросе нет').toBe(false)
  })

  await test.step('Backend: заказ существует, это Standard, исполнителя ещё нет', async() => {
    const order = await readOrder(passenger, orderId)
    const { payload } = created.request
    expect(order.b_id, 'backend отдаёт именно созданный заказ').toBe(orderId)
    expect(Number(order.b_state), 'заказ ждёт водителя').toBe(ORDER_STATE.Processing)
    expect(String(order.b_voting ?? '0'), 'заказ не голосовой').toBe('0')
    expect(hasVotingService(order.b_services), 'у заказа нет услуги «голосование»').toBe(false)
    expect(String(order.b_location_class), 'городская поездка').toBe('1')
    const carsCount = order.b_cars_count === undefined || order.b_cars_count === null || String(order.b_cars_count).trim() === '' ?
      undefined :
      Number(order.b_cars_count)
    expect(
      carsCount === undefined || (Number.isInteger(carsCount) && carsCount > 0),
      `заказ не «предложение»: b_cars_count = ${JSON.stringify(order.b_cars_count)}`,
    ).toBe(true)

    // Сверяются все четыре координаты: backend округляет до 6 знаков.
    const coordinates: Array<[string, unknown, unknown]> = [
      ['широта старта', order.b_start_latitude, payload.b_start_latitude],
      ['долгота старта', order.b_start_longitude, payload.b_start_longitude],
      ['широта назначения', order.b_destination_latitude, payload.b_destination_latitude],
      ['долгота назначения', order.b_destination_longitude, payload.b_destination_longitude],
    ]
    for (const [name, saved, sent] of coordinates)
      expect(Math.abs(Number(saved) - Number(sent)), `${name} сохранена как в запросе`).toBeLessThan(1e-5)
    expect(digitsOf(order.b_contact), 'контакт сохранён как в запросе').toBe(passengerPhone())
    expect(executorsOf(order), 'исполнителя ещё нет').toEqual([])
  })

  enterStage('3. UI пассажира: заказ создан')
  await expectPassengerOrderCreated(passengerPage, orderId)

  // ───────────── 2. Водитель видит именно этот заказ и принимает его ─────────────
  enterStage('4. список водителя: карточка с b_id')
  // Карточка находится по `data-order-id`, а не по адресу, времени или порядку:
  // в списке водителя могут лежать и другие заказы.
  await expectOrderInDriverList(driverPage, orderId)
  await expect(orderCard(driverPage, orderId), 'карточка водителя относится к созданному заказу').toBeVisible()

  enterStage('5. принятие заказа водителем')
  await orderCard(driverPage, orderId).click()
  const take = takeOrderButton(driverPage)
  await expect(take, 'в карточке заказа есть кнопка принятия').toBeVisible({ timeout: 60_000 })
  await expect(take).toBeEnabled({ timeout: 60_000 })
  await take.click()

  await expectBackendDriverState(orderId, DRIVER_STATE.Performer, 'backend назначил нашего водителя исполнителем')

  await test.step('Backend: назначение именно этого водителя, второго исполнителя нет', async() => {
    const order = await readOrder(passenger, orderId)
    expect(order.b_id).toBe(orderId)
    expect(Number(order.b_state), 'заказ принят').toBe(ORDER_STATE.Approved)
    expectSingleExecutor(order, 'после принятия')
    expect(driverStateOf(order, driver.userId), 'наш водитель — Performer').toBe(DRIVER_STATE.Performer)
  })

  await test.step('Запросы принятия: контракт назначения, а не число запросов', async() => {
    // Приложение само может повторить set_performer: первый запрос уходит с
    // b_driver_code, который gruzvill отклоняет, и повторяется без него
    // (API/order.ts, takeOrderRequest). Сколько запросов уйдёт, зависит от
    // реализации и данных машины, поэтому число не фиксируется — ни «два», ни
    // «не больше двух». Фиксируется то, что обязано быть верно при любом их
    // числе: назначение состоялось один раз, после успешного назначения новых
    // запросов принятия не было, а на backend остался один исполнитель (выше).
    await expectActionsAnswered(orderId, 'set_performer')
    const attempts = actionWatch!.of(orderId, 'set_performer')
    const sequence = actionWatch!.describe(orderId)
    test.info().annotations.push({ type: 'set_performer', description: `${attempts.length}: ${sequence}` })
    console.log(`E2E set_performer orderId=${orderId} запросов=${attempts.length}: ${sequence}`)

    expect(attempts.length, `водитель отправил хотя бы один запрос принятия: ${sequence}`).toBeGreaterThanOrEqual(1)
    expect(
      attempts.filter(item => item.status === 'success').length,
      `назначение принято backend ровно один раз: ${sequence}`,
    ).toBe(1)
    expect(
      attempts[attempts.length - 1].status,
      `после успешного назначения повторных запросов принятия нет: ${sequence}`,
    ).toBe('success')
  })

  enterStage('6. UI пассажира: назначенный водитель')
  // Заказ выбирается приложением автоматически сразу после создания
  // (pages/Passenger/index.tsx), поэтому клик selectPassengerOrder не нужен.
  await expectPassengerDriverPanel(
    passengerPage, orderId, { state: DRIVER_STATE.Performer, driverId: driver.userId },
    'пассажир видит назначенного водителя именно этого заказа')

  // ───────────── 3. Arrived → Started ─────────────
  enterStage('7. карта водителя: Performer')
  await switchToDriverMap(driverPage)
  await expectDriverMapState(driverPage, orderId, DRIVER_STATE.Performer, 'карта показывает принятый заказ')

  enterStage('8. «Поехал» → Arrived')
  await test.step('Водитель жмёт основное действие: Performer → Arrived', async() => {
    const action = driverMapAction(driverPage, orderId)
    await expect(action, 'основное действие доступно').toBeEnabled({ timeout: 60_000 })
    await action.click()

    // Сначала backend: оптимистичное состояние карты доказательством не является.
    await expectBackendDriverState(orderId, DRIVER_STATE.Arrived, 'backend перевёл заказ в Arrived')
    const order = await readOrder(passenger, orderId)
    expect(Number(order.b_state), 'заказ не отменён').not.toBe(ORDER_STATE.Canceled)
    expectSingleExecutor(order, 'после Arrived')

    await expectDriverMapState(driverPage, orderId, DRIVER_STATE.Arrived, 'карта показывает Arrived')
    await expectPassengerDriverPanel(
      passengerPage, orderId, { state: DRIVER_STATE.Arrived, driverId: driver.userId },
      'пассажир видит Arrived у своего водителя')

    await expectActionsAnswered(orderId, 'set_arrive_state')
    expect(
      actionWatch!.of(orderId, 'set_arrive_state').map(item => item.status),
      'set_arrive_state: один успешный запрос',
    ).toEqual(['success'])
  })

  enterStage('9. «Приехал» → Started')
  await test.step('Водитель жмёт основное действие: Arrived → Started', async() => {
    // Приложение блокирует «Приехал», пока водитель дальше 100 м от точки посадки
    // (pages/Driver/Map.tsx, requiresPickupArrival). Расстояние идёт в сообщение,
    // чтобы блокировку гейтом можно было отличить от другой причины.
    const order = await readOrder(passenger, orderId)
    const pickupDistance = Math.round(distanceMeters(
      coordinate(order.b_start_latitude, order.b_start_longitude), PICKUP))
    const action = driverMapAction(driverPage, orderId)
    await expect(
      action,
      `«Приехал» доступно: водитель в пределах ${PICKUP_ARRIVAL_RADIUS_M} м от точки посадки (точка заказа в ${pickupDistance} м от PICKUP)`,
    ).toBeEnabled({ timeout: 60_000 })
    await action.click()

    await expectBackendDriverState(orderId, DRIVER_STATE.Started, 'backend перевёл заказ в Started')
    const started = await readOrder(passenger, orderId)
    expect(Number(started.b_state), 'заказ с начатой поездкой подтверждён').toBe(ORDER_STATE.Approved)
    expectSingleExecutor(started, 'после Started')

    await expectDriverMapState(driverPage, orderId, DRIVER_STATE.Started, 'карта показывает Started')
    await expectPassengerDriverPanel(
      passengerPage, orderId, { state: DRIVER_STATE.Started, driverId: driver.userId },
      'пассажир видит, что поездка началась')

    // У Standard кода посадки нет — он только у голосования.
    expect(await isBoardingFormVisible(driverPage), 'у стандартного заказа формы кода посадки нет').toBe(false)
    await expectActionsAnswered(orderId, 'set_start_state')
    expect(
      actionWatch!.of(orderId, 'set_start_state').map(item => item.status),
      'set_start_state: один успешный запрос',
    ).toEqual(['success'])
  })

  // ───────────── 4. Один заказ на весь сценарий ─────────────
  enterStage('10. итог: один заказ на сценарий')
  expect(creationWatch.orderIds(), 'за сценарий создан ровно один заказ').toEqual([orderId])
  await expect(passengerDriverPanelOfOrder(passengerPage, orderId), 'панель пассажира всё ещё у того же заказа').toBeVisible()
  await expect(driverMapAction(driverPage, orderId), 'карта водителя всё ещё у того же заказа').toBeVisible()
  // Очистка и её независимое подтверждение — в afterEach.
})
