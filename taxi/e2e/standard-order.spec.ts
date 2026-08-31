/**
 * TEST-E2E-002 — А.1.1, стандартный вызов. Живой backend.
 *
 * Сквозной сценарий: пассажир получает заказ → водитель видит его в списке,
 * берёт, выезжает и начинает поездку → пассажир видит смену состояния.
 *
 * Что здесь настоящее: frontend, Taxi API, состояние заказа, переходы FSM и
 * ОБЕ роли — у пассажира и у водителя свои браузерные контексты со своими
 * сессиями. Ни один endpoint сценария не подменяется; единственный мок — тайлы
 * карты, они к проверяемому сценарию отношения не имеют.
 *
 * Через API делается только подготовка предусловия (водитель на линии, заказ
 * создан) и НЕЗАВИСИМАЯ от интерфейса проверка состояния заказа. Все действия
 * сценария выполняются кликами в браузере.
 */

import { Browser, BrowserContext, Page, devices, expect, test } from '@playwright/test'
import { appUrl, driverAccount, passengerAccount } from './fixtures/accounts'
import { stubMapTiles } from './fixtures/appShell'
import {
  cancelDriverActiveOrders,
  cancelOrder,
  cancelPassengerActiveOrders,
  createStandardOrder,
  driverStateOf,
  DRIVER_STATE,
  getDriverCar,
  goOnline,
  ICar,
  IOrderSnapshot,
  ISession,
  login,
  readOrder,
} from './fixtures/taxiApi'
import {
  DESTINATION,
  DRIVER_STORAGE,
  PICKUP,
  clickPrimaryAction,
  expectUiDriverState,
  isBoardingFormVisible,
  openOrderCard,
  switchToDriverMap,
  takeOrderButton,
} from './fixtures/driverUi'
import {
  PASSENGER_STORAGE,
  expectOrderVisibleToPassenger,
  expectPassengerDriverState,
  selectPassengerOrder,
} from './fixtures/passengerUi'

// Сценарий длиннее, чем у теста посадки: он проходит весь путь от создания
// заказа до начала поездки, и каждое ожидание — по факту, а не по таймеру.
test.describe.configure({ timeout: 8 * 60 * 1000 })

const LABEL = 'A11'

let driver: ISession
let passenger: ISession
let car: ICar
let passengerContext: BrowserContext
let driverContext: BrowserContext
let passengerPage: Page
let driverPage: Page
const createdOrders: string[] = []

const reason = (error: unknown) => (error as Error)?.message ?? String(error)

/**
 * Отдельная сессия пользователя. Пассажир и водитель — два разных контекста с
 * разными storageState: одной сессией двух пользователей не изображаем.
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

  // trace/video/screenshot из playwright.config.ts действуют и на контексты,
  // открытые вручную, — включать их здесь не нужно.
  return context
}

test.beforeAll(async({ browser }) => {
  driver = await login(driverAccount(), 'водитель')
  passenger = await login(passengerAccount(), 'пассажир')
  car = await getDriverCar(driver)
  await goOnline(driver, car, PICKUP)

  // Прогон начинается с чистого списка. Заказ, оставшийся от прерванного
  // прогона, у пассажира не просто лишний: истёкшее ожидание голосового заказа
  // открывает модальное окно поверх страницы и сбрасывает выбранный заказ.
  const swept = await cancelPassengerActiveOrders(passenger)
  if (swept)
    console.log(`E2E sweep: перед прогоном отменено заказов пассажира — ${swept}`)

  passengerContext = await openSession(browser, PASSENGER_STORAGE)
  driverContext = await openSession(browser, DRIVER_STORAGE)
  passengerPage = await passengerContext.newPage()
  driverPage = await driverContext.newPage()
})

test.afterEach(async({}, testInfo) => {
  const failed = testInfo.status !== testInfo.expectedStatus

  // При падении нужно, чем разбираться на бэкенде. Печатаются только
  // идентификаторы и состояние заказа — ни токена, ни пароля, ни cookie.
  if (failed) {
    for (const orderId of createdOrders) {
      const state = await backendState(orderId).catch(() => undefined)
      const diagnostics = `orderId=${orderId} driverId=${driver?.userId} ` +
        `carId=${car?.c_id} c_state=${state ?? 'unknown'}`
      console.error(`E2E FAILURE DIAGNOSTICS: ${diagnostics}`)
      testInfo.annotations.push({ type: 'backend', description: diagnostics })
    }
  }

  // Каждый прогон убирает за собой, аккаунты не зависают. Если отменить не
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
  await passengerContext?.close()
  await driverContext?.close()

  // Подмести то, что осталось от прерванных прогонов: следующий прогон не
  // должен начинаться с водителем, занятым чужим заказом.
  if (!passenger || !driver)
    return
  try {
    const cancelled = await cancelDriverActiveOrders(passenger, driver.userId)
    if (cancelled)
      console.log(`E2E sweep: отменено зависших заказов — ${cancelled}`)
  } catch (error) {
    console.error(`E2E SWEEP FAILED: ${reason(error)}`)
  }
})

/** Состояние нашего водителя в заказе на бэкенде — независимая от UI проверка. */
async function backendState(orderId: string): Promise<number | undefined> {
  const order = await readOrder(driver, orderId)
  return driverStateOf(order, driver.userId)
}

async function expectBackendState(orderId: string, state: number, message: string): Promise<void> {
  await expect.poll(() => backendState(orderId), { message, timeout: 90_000 }).toBe(state)
}

/**
 * Первое состояние, в котором водитель появился в заказе. Именно оно отличает
 * стандартный вызов от двух остальных типов: голосование и предложение
 * заводят водителя кандидатом (Considering), и исполнителем его делает
 * пассажир, а стандартный вызов назначает исполнителя сразу.
 */
async function firstDriverState(orderId: string): Promise<number> {
  let seen: number | undefined
  await expect
    .poll(async() => {
      seen = await backendState(orderId)
      return seen !== undefined
    }, { message: 'водитель появился в заказе', timeout: 90_000, intervals: [200, 500, 1_000] })
    .toBe(true)
  return seen as number
}

/** Есть ли в заказе услуга «голосование» (EServices.Voting = 5). */
function votingServiceOf(order: IOrderSnapshot): boolean {
  const services = order.b_services
  const list = Array.isArray(services) ?
    services :
    typeof services === 'string' ? services.split(/[^0-9]+/) : []
  return list.some(item => String(item).trim() === '5')
}

test('А.1.1 — стандартный вызов: от создания заказа до начала поездки', async() => {
  // ШАГ 1. Предусловие: у пассажира есть стандартный заказ.
  const orderId = await createStandardOrder(passenger, {
    pickup: PICKUP,
    destination: DESTINATION,
    driverId: driver.userId,
    carClassId: car.cc_id,
    label: LABEL,
  })
  createdOrders.push(orderId)

  // ПРОВЕРКА 1 — заказ действительно создан: бэкенд отдаёт его по номеру.
  const created = await readOrder(passenger, orderId)
  expect(created.b_id, 'заказ создан и читается с бэкенда').toBe(orderId)

  // ПРОВЕРКА 2 — тип заказа А.1.1. Голосование помечается b_voting и услугой 5,
  // предложение — b_cars_count=0 (src/tools/driverOffer.ts). У стандартного
  // вызова нет ни одного из этих признаков.
  expect(String(created.b_voting ?? '0'), 'заказ не голосовой').toBe('0')
  expect(votingServiceOf(created), 'у заказа нет услуги «голосование»').toBe(false)
  expect(String(created.b_cars_count ?? ''), 'заказ не «предложение»').not.toBe('0')

  // ШАГ 2. Пассажир видит свой заказ в приложении. Выбрать его пока нельзя:
  // до появления исполнителя плашка стандартного заказа неактивна.
  await expectOrderVisibleToPassenger(passengerPage, orderId)

  // ШАГ 3. Водитель видит этот заказ в своём списке.
  // ПРОВЕРКА 3 — доступен именно этот заказ: карточка найдена по его номеру.
  await openOrderCard(driverPage, orderId)

  // ШАГ 4. ПРОВЕРКА 4 — водитель принимает заказ кликом в интерфейсе.
  const take = takeOrderButton(driverPage)
  await expect(take, 'в карточке заказа есть кнопка принятия').toBeVisible({ timeout: 60_000 })
  await expect(take).toBeEnabled({ timeout: 60_000 })
  await take.click()

  // ПРОВЕРКА 2 (вторая опора) — стандартный вызов назначает исполнителя сразу,
  // без стадии кандидата. У голосования и предложения здесь был бы Considering.
  expect(
    await firstDriverState(orderId),
    'стандартный вызов делает водителя исполнителем сразу, без стадии кандидата',
  ).toBe(DRIVER_STATE.Performer)

  // ПРОВЕРКА 5 — заказ назначен именно этому водителю и только ему.
  const assigned = await readOrder(driver, orderId)
  const performers = (assigned.drivers ?? [])
    .filter(item => Number(item.c_state) >= DRIVER_STATE.Performer)
    .map(item => String(item.u_id))
  expect(performers, 'исполнитель заказа — ровно один, и это наш водитель').toEqual([driver.userId])

  // ПРОВЕРКА 8 (промежуточная) — пассажир открывает заказ и видит водителя.
  await selectPassengerOrder(passengerPage, orderId)
  await expectPassengerDriverState(
    passengerPage, DRIVER_STATE.Performer, 'пассажир видит назначенного водителя')

  // ШАГ 5. ПРОВЕРКА 6 — переход Performer → Arrived кликом «Поехал».
  await switchToDriverMap(driverPage)
  await expectUiDriverState(driverPage, DRIVER_STATE.Performer, 'карта показывает принятый заказ')
  await clickPrimaryAction(driverPage)
  await expectBackendState(orderId, DRIVER_STATE.Arrived, 'бэкенд перевёл заказ в Arrived')
  await expectUiDriverState(driverPage, DRIVER_STATE.Arrived, 'карта показывает прибытие')
  await expectPassengerDriverState(
    passengerPage, DRIVER_STATE.Arrived, 'пассажир видит, что водитель в пути')

  // ШАГ 6. ПРОВЕРКА 7 — поездка началась.
  await clickPrimaryAction(driverPage)
  await expectBackendState(orderId, DRIVER_STATE.Started, 'бэкенд перевёл заказ в Started')
  await expectUiDriverState(driverPage, DRIVER_STATE.Started, 'карта показывает начатую поездку')

  // У стандартного вызова кода посадки нет — он только у голосового заказа
  // (pages/Driver/Map.tsx). Форма подтверждения не должна была появиться.
  expect(
    await isBoardingFormVisible(driverPage),
    'у стандартного вызова формы кода посадки нет',
  ).toBe(false)

  // ПРОВЕРКА 8 — пассажир видит начало поездки.
  await expectPassengerDriverState(
    passengerPage, DRIVER_STATE.Started, 'пассажир видит, что поездка началась')
})
