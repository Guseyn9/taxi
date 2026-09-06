/**
 * TEST-E2E-003 — А.1.2, голосование. Живой backend.
 *
 * Сквозной сценарий: пассажир получает голосовой заказ → ДВА водителя видят
 * один и тот же заказ и откликаются на него кликами → пассажир выбирает
 * исполнителя кликом → выбранный водитель довозит заказ до начала поездки →
 * пассажир видит смену состояний.
 *
 * Что здесь настоящее: frontend, Taxi API, состояние заказа, переходы FSM и все
 * ТРИ роли — у пассажира и у каждого водителя свой браузерный контекст со своей
 * сессией. Ни один endpoint сценария не подменяется; единственный мок — тайлы
 * карты.
 *
 * Через API делается только подготовка предусловия (водители на линии, заказ
 * создан) и НЕЗАВИСИМАЯ от интерфейса проверка состояния заказа. Все действия
 * сценария — клики в браузере: и отклик водителя, и выбор исполнителя
 * пассажиром.
 *
 * ОБЪЁМ ТЕСТА — то же осознанное решение, что и в А.1.1: создание заказа здесь
 * является fixture/предусловием и покрытием пассажирской формы создания заказа
 * НЕ считается. Обоснование — e2e/README.md.
 *
 * ДВА ОТЛИЧИЯ ОТ А.1.1, которые стоит знать заранее:
 *
 * 1. Заказ создаётся БЕЗ метки [DRV:<id>]. Метка — механизм изоляции самого
 *    приложения: в режиме внешнего эмулятора водитель видит только свои
 *    помеченные заказы (state/orders/selectors.ts). Голосованию нужно ровно
 *    обратное — один заказ, доступный обоим водителям. Уборка от этого не
 *    страдает: она работает по метке [E2E <label>], которая остаётся.
 *
 * 2. Заказ создаётся с b_max_waiting = 900. Пассажирский интерфейс доверяет
 *    этому полю только в окне 0 < x ≤ 900 и иначе считает ожидание равным 180 с,
 *    после чего САМ отменяет голосовой заказ (VotingForm.tsx). Сценарий из
 *    одиннадцати шагов в 180 с не укладывается, а 900 — обычное значение поля
 *    заказа, не мок и не подмена состояния.
 */

import { Browser, BrowserContext, Page, devices, expect, test } from '@playwright/test'
import { appUrl, driver2Account, driverAccount, passengerAccount } from './fixtures/accounts'
import { stubMapTiles } from './fixtures/appShell'
import {
  boardingCodeOf,
  cancelOrder,
  cancelTestOrders,
  createVotingOrder,
  driverStateOf,
  DRIVER_STATE,
  getDriverCar,
  goOnline,
  isOrderActiveFor,
  ICar,
  IOrderSnapshot,
  ISession,
  ISweepResult,
  login,
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
  openBoardingForm,
  openDriverMap,
  openOrderCard,
  submitBoardingCode,
  takeOrderButton,
} from './fixtures/driverUi'
import {
  PASSENGER_STORAGE,
  chooseVotingCandidate,
  expectOrderVisibleToPassenger,
  expectPassengerDriverState,
  expectVotingCandidates,
  openPassengerVotingOrder,
  passengerDriverId,
} from './fixtures/passengerUi'

// Сценарий длиннее, чем А.1.1: три роли, три загрузки приложения и голосование
// между ними. Каждое ожидание — по факту, а не по таймеру.
test.describe.configure({ timeout: 12 * 60 * 1000 })

const LABEL = 'A12'

/**
 * Состояние заказа целиком (b_state, types/types.ts → EBookingStates).
 * Голосованию мало состояния водителя: ТЗ требует проверять именно то, в каком
 * состоянии находится заказ до и после выбора исполнителя.
 */
const ORDER_STATE = { Processing: 1, Approved: 2 } as const

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

/**
 * Что сделала уборка. Пропущенные заказы обязаны попасть в лог: уборка трогает
 * только заказы с тестовыми метками, и всё остальное на учётке остаётся —
 * если из-за него потом упадёт сценарий, причина должна быть видна сразу.
 */
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

  // Голосование не воспроизводится одним водителем: смысл A.1.2 в том, что один
  // заказ одновременно доступен нескольким. Одна и та же учётка в обеих
  // переменных — это не два водителя, и тест на ней ничего не докажет.
  expect(
    driver2.session.userId,
    'второй водитель — отдельная учётка: E2E_DRIVER2_* должен указывать не на того же пользователя',
  ).not.toBe(driver1.session.userId)

  // Прогон начинается без тестового мусора. Заказ, оставшийся от прерванного
  // прогона, у пассажира не просто лишний: истёкшее ожидание голосового заказа
  // открывает модальное окно поверх страницы и сбрасывает выбранный заказ.
  reportSweep('перед прогоном', await cancelTestOrders(passenger))

  passengerContext = await openSession(browser, PASSENGER_STORAGE)
  passengerPage = await passengerContext.newPage()
})

test.afterEach(async({}, testInfo) => {
  const failed = testInfo.status !== testInfo.expectedStatus

  // При падении нужно, чем разбираться на бэкенде: на каком переходе нарушился
  // контракт и в каком состоянии остался каждый участник. Печатаются только
  // идентификаторы и состояния — ни токена, ни пароля, ни cookie.
  if (failed) {
    for (const orderId of createdOrders) {
      const order = await readOrder(passenger, orderId).catch(() => undefined)
      const active = await isOrderActiveFor(passenger, orderId).catch(() => undefined)
      const participants = order ?
        orderDriverStates(order).map(item => `u${item.userId}=${stateName(item.state)}`).join(', ') :
        'заказ не прочитан'
      const diagnostics = `orderId=${orderId} b_state=${order?.b_state ?? 'unknown'} ` +
        `b_voting=${order?.b_voting ?? 'unknown'} ` +
        `b_confirm_state=${order?.b_confirm_state ?? 'unknown'} ` +
        `в списке активных пассажира: ${active ?? 'unknown'} | ` +
        `driver1=u${driver1?.session?.userId} (car ${driver1?.car?.c_id}), ` +
        `driver2=u${driver2?.session?.userId} (car ${driver2?.car?.c_id}) | ` +
        `участники заказа: ${participants}`
      console.error(`E2E FAILURE DIAGNOSTICS: ${diagnostics}`)
      testInfo.annotations.push({ type: 'backend', description: diagnostics })
    }
  }

  // Каждый прогон убирает за собой. Если отменить не вышло — заказ остаётся
  // живым на бэкенде, поэтому его номер обязан попасть в лог: по нему заказ
  // можно найти и удалить руками.
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

  // Подмести тестовые заказы, оставшиеся от прерванных прогонов: следующий
  // прогон не должен начинаться с водителем, занятым таким заказом. Участие
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

/** Есть ли в заказе услуга «голосование» (EServices.Voting = 5). */
function votingServiceOf(order: IOrderSnapshot): boolean {
  const services = order.b_services
  const list = Array.isArray(services) ?
    services :
    typeof services === 'string' ? services.split(/[^0-9]+/) : []
  return list.some(item => String(item).trim() === '5')
}

/** Отклик водителя на голосование — клик в интерфейсе и подтверждение приложения. */
async function respondToVoting(role: IRole, orderId: string): Promise<void> {
  const take = takeOrderButton(role.page)
  await expect(take, `${role.title}: в карточке заказа есть кнопка отклика`)
    .toBeVisible({ timeout: 60_000 })
  await expect(take, `${role.title}: кнопка отклика доступна`).toBeEnabled({ timeout: 60_000 })
  await take.click()

  // Результат действия водителя — то самое окно, которым приложение
  // подтверждает участие в голосовании (CardModal.tsx, DRIVER_VOTING_READY_SENT).
  await confirmActionResult(role.page, 'success', `${role.title}: приложение подтвердило отклик`)
}

test('А.1.2 — голосование: от создания заказа до начала поездки', async() => {
  // ШАГ 1. Предусловие: у пассажира есть голосовой заказ, общий для обоих
  // водителей и с ожиданием из доверенного окна.
  const orderId = await createVotingOrder(passenger, {
    pickup: PICKUP,
    destination: DESTINATION,
    carClassId: driver1.car.cc_id,
    label: LABEL,
    maxWaitingSeconds: 900,
  })
  createdOrders.push(orderId)

  // ПРОВЕРКА 1 (AC-1) — заказ создан и однозначно опознаётся как голосовой.
  const created = await readOrder(passenger, orderId)
  expect(created.b_id, 'заказ создан и читается с бэкенда').toBe(orderId)
  expect(String(created.b_voting ?? '0'), 'заказ голосовой: b_voting = 1').toBe('1')
  expect(votingServiceOf(created), 'у заказа есть услуга «голосование» (сервис 5)').toBe(true)
  expect(Number(created.b_state), 'заказ активен и ждёт водителей').toBe(ORDER_STATE.Processing)
  expect(orderDriverStates(created), 'у только что созданного заказа исполнителя нет').toEqual([])

  // ШАГ 2 (AC-13) — пассажир видит свой заказ в приложении.
  await expectOrderVisibleToPassenger(passengerPage, orderId)

  // ШАГ 3 и ШАГ 4 (AC-2) — ОДИН И ТОТ ЖЕ заказ доступен обоим водителям.
  // Карточка ищется по номеру заказа, так что это именно созданный заказ.
  await openOrderCard(driver1.page, orderId)
  await openOrderCard(driver2.page, orderId)

  // ШАГ 5 (AC-3, первая половина) — до откликов исполнителя нет и заказ всё ещё
  // ждёт водителей. Проверяется конкретное состояние, а не отсутствие ошибки.
  const beforeVoting = await readOrder(passenger, orderId)
  expect(Number(beforeVoting.b_state), 'до голосования заказ в состоянии поиска водителя')
    .toBe(ORDER_STATE.Processing)
  expect(performersOf(beforeVoting), 'до голосования исполнителя нет').toEqual([])

  // ШАГ 6 (AC-4) — оба водителя участвуют в голосовании кликами в интерфейсе.
  // Endpoint голосования из теста не вызывается: кнопку нажимает браузер.
  await respondToVoting(driver1, orderId)
  await expectBackendState(
    orderId, driver1, DRIVER_STATE.Considering, 'водитель 1 стал кандидатом')

  await respondToVoting(driver2, orderId)
  await expectBackendState(
    orderId, driver2, DRIVER_STATE.Considering, 'водитель 2 стал кандидатом')

  // ШАГ 5 (AC-3, главное) — кандидат исполнителем не становится. Голосование
  // тем и отличается от стандартного вызова: там клик «Взять заказ» делает
  // водителя Performer сразу, здесь — только кандидатом, пока не выбрал пассажир.
  const duringVoting = await readOrder(passenger, orderId)
  expect(
    performersOf(duringVoting),
    'появление кандидатов само по себе исполнителя не назначает',
  ).toEqual([])
  expect(Number(duringVoting.b_state), 'заказ по-прежнему в состоянии голосования')
    .toBe(ORDER_STATE.Processing)
  expect(
    orderDriverStates(duringVoting)
      .map(item => item.userId)
      .sort(),
    'в голосовании участвуют оба водителя',
  ).toEqual([driver1.session.userId, driver2.session.userId].sort())

  // ШАГ 7 (AC-5) — исполнителя назначает пассажир, кликом «Выбрать» в своём
  // списке откликов. Это и есть завершение голосования по текущему контракту:
  // таймерного автовыбора у приложения нет (API/order.ts, chooseCandidate).
  await openPassengerVotingOrder(passengerPage, orderId)
  await expectVotingCandidates(passengerPage, [driver1.session.userId, driver2.session.userId])
  await chooseVotingCandidate(passengerPage, driver1.session.userId)

  await expectBackendState(
    orderId, driver1, DRIVER_STATE.Performer, 'после выбора пассажира водитель 1 стал исполнителем')

  // ШАГ 8 (AC-6, AC-7) — ровно один исполнитель, и это участник голосования.
  const assigned = await readOrder(passenger, orderId)
  expect(performersOf(assigned), 'исполнитель ровно один, и это выбранный водитель')
    .toEqual([driver1.session.userId])
  expect(Number(assigned.b_state), 'заказ перешёл в состояние с назначенным исполнителем')
    .toBe(ORDER_STATE.Approved)

  // Проигравший кандидат исполнителем не стал. `drivers` — это записи участия, а
  // не список исполнителей: отказавшийся остаётся в заказе записью, поэтому
  // проверяется не отсутствие записи, а её состояние. Оба допустимых значения —
  // те, которыми приложение описывает водителя вне поездки: он либо остался
  // кандидатом, либо снят с заказа (types/types.ts, EBookingDriverState).
  const loserState = driverStateOf(assigned, driver2.session.userId)
  expect(
    loserState,
    `второй водитель после голосования не исполнитель, а ${stateName(loserState)}`,
  ).not.toBe(DRIVER_STATE.Performer)
  expect(
    ([DRIVER_STATE.Considering, DRIVER_STATE.Canceled] as number[]).includes(Number(loserState)),
    `второй водитель в корректном состоянии после голосования: ${stateName(loserState)}`,
  ).toBe(true)

  // ШАГ 9 (AC-8) — пассажир видит ИМЕННО того водителя, которого назначил
  // бэкенд. Сверяется идентификатор, а не имя: имя не уникально.
  await expectPassengerDriverState(
    passengerPage, DRIVER_STATE.Performer, 'пассажир видит назначенного водителя')
  expect(
    await passengerDriverId(passengerPage),
    'пассажиру показан тот же водитель, что назначен на бэкенде',
  ).toBe(driver1.session.userId)

  // ШАГ 10 (AC-9, AC-11) — выбранный водитель выезжает: backend, водительский и
  // пассажирский интерфейсы согласованы на Arrived.
  //
  // Карта открывается переходом, а не переключением вкладки. У голосования путь
  // водителя другой, чем у стандартного вызова: после отклика приложение само
  // уводит его с карточки заказа (CardModal.tsx), исполнителем он становится
  // позже и чужим действием — выбором пассажира. Тем же переходом открывает
  // карту голосового заказа TEST-E2E-001.
  await openDriverMap(driver1.page)
  await expectUiDriverState(
    driver1.page, DRIVER_STATE.Performer, 'карта водителя показывает принятый заказ')
  await clickPrimaryAction(driver1.page)
  await expectBackendState(orderId, driver1, DRIVER_STATE.Arrived, 'бэкенд перевёл заказ в Arrived')
  await expectUiDriverState(driver1.page, DRIVER_STATE.Arrived, 'карта показывает прибытие')
  await expectPassengerDriverState(
    passengerPage, DRIVER_STATE.Arrived, 'пассажир видит, что водитель прибыл')

  // ШАГ 11 (AC-10, AC-11) — начало поездки. У голосового заказа переход
  // Arrived → Started проходит через код посадки: это часть его контракта, а не
  // обход (TEST-E2E-001, pages/Driver/Map.tsx). Код настоящий, водительский.
  await openBoardingForm(driver1.page)
  await submitBoardingCode(driver1.page, boardingCodeOf(driver1.car))
  await expectBackendState(orderId, driver1, DRIVER_STATE.Started, 'бэкенд перевёл заказ в Started')
  await expectUiDriverState(driver1.page, DRIVER_STATE.Started, 'карта показывает начатую поездку')
  await expectPassengerDriverState(
    passengerPage, DRIVER_STATE.Started, 'пассажир видит, что поездка началась')

  // Голосование не должно «дозагореться» задним числом: в поездке ровно один
  // водитель, и это выбранный. Проигравший в неё не попал ни на одном шаге.
  const started = await readOrder(passenger, orderId)
  const inTrip = orderDriverStates(started)
    .filter(item => item.state >= DRIVER_STATE.Performer)
    .map(item => item.userId)
  expect(inTrip, 'поездку выполняет ровно один водитель — выбранный пассажиром')
    .toEqual([driver1.session.userId])
  expect(
    driverStateOf(started, driver1.session.userId),
    'выбранный водитель находится именно в Started',
  ).toBe(DRIVER_STATE.Started)
})
