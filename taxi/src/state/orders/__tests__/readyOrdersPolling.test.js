/**
 * Опрос списка готовых заказов водителя.
 *
 * `watchReadyOrdersSaga` отправляет GET_READY_ORDERS_REQUEST и ждёт
 * GET_READY_ORDERS_SUCCESS или GET_READY_ORDERS_FAIL, и только потом ставит
 * следующий цикл. Если `getReadyOrdersSaga` выходит, не отправив ни того, ни
 * другого, watcher не просыпается больше никогда: список заказов у водителя
 * перестаёт обновляться до перезагрузки страницы.
 *
 * Здесь работают настоящие `concurrency` / `whileWatching` и настоящие саги
 * заказов — дефект живёт именно в их взаимодействии. Замоканы только границы:
 * API, селекторы и локализация (слой API тянет за собой корневую сагу через
 * циклический импорт, см. refreshOrder.test.js).
 */

jest.mock('../../../API', () => ({
  getOrders: jest.fn(),
  driveCar: jest.fn(),
  getOrder: jest.fn(),
}))
jest.mock('../../../localization', () => ({
  t: key => key,
  TRANSLATION: new Proxy({}, { get: (_target, prop) => String(prop) }),
}))
jest.mock('../selectors', () => ({
  moduleSelector: state => state.orders,
  activeOrders: () => null,
  readyOrders: () => null,
  historyOrders: () => null,
  MAX_DRIVER_VISIBLE_ORDER_DISTANCE_KM: 0,
}))
jest.mock('../../user/selectors', () => ({
  user: state => state.user,
  tokens: () => ({ token: 'token', u_hash: 'hash' }),
}))
// Именно этот селектор решает, в какую ветку пойдёт цикл: `null` — машин нет,
// `undefined` — машины ещё не загружены, объект — основная машина водителя.
jest.mock('../../cars/selectors', () => ({ userPrimaryCar: state => state.primaryCar }))
jest.mock('../../geolocation/selectors', () => ({ geoposition: () => undefined }))

const POLL_INTERVAL_MS = 3000

const CAR = { c_id: 'car-1', cc_id: '50' }
const ORDER = { b_id: 'order-1', b_state: '1', drivers: [] }

const ok = orders => ({ code: '200', status: 'success', data: { booking: orders } })
// Так API.getOrders отдаёт «у водителя нет машины в рейсе» (src/API/order.ts).
const usedCarNotFound = () => ({
  code: '404',
  message: 'used car not found',
  data: { detail: 'used_car_not_found' },
})
// Так API.driveCar отдаёт «машина уже в рейсе» (src/API/car.ts): код остаётся
// 404, хотя для приложения это не ошибка.
const alreadyDriven = () => ({
  code: '404',
  message: 'car is already driven by this user',
  data: { detail: 'not_modified' },
})
const driveOk = () => ({ code: '200', status: 'success', data: {} })

const realSetImmediate = jest.requireActual('timers').setImmediate

/** Дать отработать всем промисам и сагам, которые они разбудили. */
async function settle() {
  for (let i = 0; i < 5; i += 1)
    await new Promise(resolve => realSetImmediate(resolve))
}

/** Дождаться, пока watcher отсчитает паузу и запустит следующий цикл. */
async function nextCycle() {
  jest.advanceTimersByTime(POLL_INTERVAL_MS)
  await settle()
}

const tasks = []

function mockApi() {
  return require('../../../API')
}

/**
 * Запустить настоящие саги заказов на минимальном store и включить опрос так
 * же, как это делает страница водителя.
 */
function startPolling({ primaryCar }) {
  const { runSaga, stdChannel } = require('redux-saga')
  const { EUserRoles } = require('../../../types/types')
  const { ActionTypes } = require('../constants')
  const { ActionTypes: CarsActionTypes } = require('../../cars/constants')
  const { ActionTypes: ModalsActionTypes } = require('../../modals/constants')
  const ordersReducer = require('../reducer').default
  const { saga } = require('../sagas')

  const channel = stdChannel()
  const actions = []
  let state = {
    user: { u_id: 'driver-1', u_role: EUserRoles.Driver },
    primaryCar,
    orders: ordersReducer(undefined, { type: '@@test/INIT' }),
  }

  const dispatch = action => {
    // drivePrimaryCarSaga берёт машину в рейс через thunk (cars/actionCreators).
    if (typeof action === 'function')
      return action(dispatch, () => state)
    actions.push(action)
    state = { ...state, orders: ordersReducer(state.orders, action) }
    channel.put(action)
    return action
  }

  tasks.push(runSaga({ channel, dispatch, getState: () => state }, saga))
  dispatch({ type: ActionTypes.WATCH_READY_ORDERS })

  const count = type => actions.filter(action => action.type === type).length

  return {
    T: ActionTypes,
    getState: () => state,
    setPrimaryCar: car => { state = { ...state, primaryCar: car } },
    ofType: type => actions.filter(action => action.type === type),
    requests: () => count(ActionTypes.GET_READY_ORDERS_REQUEST),
    successes: () => count(ActionTypes.GET_READY_ORDERS_SUCCESS),
    fails: () => count(ActionTypes.GET_READY_ORDERS_FAIL),
    carsRequests: () => count(CarsActionTypes.GET_USER_CARS_REQUEST),
    messageModals: () => count(ModalsActionTypes.SET_MESSAGE_MODAL),
  }
}

beforeEach(() => {
  jest.resetModules()
  jest.useFakeTimers()
  window.localStorage.clear()
  // Штатный переключатель внешнего эмулятора (tools/emulatorMode.ts): без него
  // список водителя принудительно пуст и до веток с машиной сага не доходит.
  window.localStorage.setItem(
    require('../../../tools/emulatorMode').EXTERNAL_EMULATOR_FLAG_KEY, '1')
})

afterEach(() => {
  while (tasks.length)
    tasks.pop().cancel()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('опрос готовых заказов: штатный путь не сломан', () => {

  it('машина есть: запрос, SUCCESS, список в store и следующий цикл (AC-5)', async() => {
    const API = mockApi()
    API.getOrders.mockResolvedValue(ok([ORDER]))

    const polling = startPolling({ primaryCar: CAR })
    await settle()

    expect(API.getOrders).toHaveBeenCalledTimes(1)
    expect(polling.successes()).toBe(1)
    expect(polling.fails()).toBe(0)
    expect(polling.ofType(polling.T.GET_READY_ORDERS_SUCCESS)[0].payload.map(order => order.b_id))
      .toEqual([ORDER.b_id])
    expect(polling.getState().orders.readyOrders.toArray()).toEqual([ORDER.b_id])

    await nextCycle()

    expect(polling.requests()).toBe(2)
    expect(API.getOrders).toHaveBeenCalledTimes(2)
  })

  it('ответ API не 200: цикл завершается FAIL, опрос продолжается (AC-6)', async() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const API = mockApi()
    API.getOrders.mockResolvedValue({ code: '500', message: 'server error' })

    const polling = startPolling({ primaryCar: CAR })
    await settle()

    expect(polling.fails()).toBe(1)
    expect(polling.successes()).toBe(0)
    expect(polling.getState().orders.readyOrders).toBeNull()

    await nextCycle()

    expect(API.getOrders).toHaveBeenCalledTimes(2)
    expect(polling.fails()).toBe(2)
  })

  it('запрос отклонён (сеть): тот же путь FAIL, опрос продолжается (AC-6)', async() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const API = mockApi()
    API.getOrders.mockRejectedValue(new Error('Network Error'))

    const polling = startPolling({ primaryCar: CAR })
    await settle()

    expect(polling.fails()).toBe(1)

    await nextCycle()

    expect(API.getOrders).toHaveBeenCalledTimes(2)
    expect(polling.fails()).toBe(2)
  })

})

describe('опрос готовых заказов: у водителя нет машины (userPrimaryCar === null)', () => {

  it('цикл завершается FAIL, запрос к API не уходит, список не трогается (AC-1, AC-2)', async() => {
    const API = mockApi()

    const polling = startPolling({ primaryCar: null })
    await settle()

    expect(polling.requests()).toBe(1)
    expect(polling.fails()).toBe(1)
    expect(polling.ofType(polling.T.GET_READY_ORDERS_FAIL)[0].payload)
      .toEqual({ detail: 'primary_car_missing' })
    expect(API.getOrders).not.toHaveBeenCalled()
    // FAIL редьюсер не обрабатывает — список остаётся ровно тем, чем был.
    expect(polling.getState().orders.readyOrders).toBeNull()
  })

  it('watcher не блокируется: каждый следующий цикл запускается (AC-3)', async() => {
    mockApi()

    const polling = startPolling({ primaryCar: null })
    await settle()
    await nextCycle()
    await nextCycle()

    expect(polling.requests()).toBe(3)
    expect(polling.fails()).toBe(3)
  })

  it('машина появилась: следующий цикл идёт в API и обрабатывает результат (AC-4)', async() => {
    const API = mockApi()
    API.getOrders.mockResolvedValue(ok([ORDER]))

    const polling = startPolling({ primaryCar: null })
    await settle()

    expect(API.getOrders).not.toHaveBeenCalled()

    polling.setPrimaryCar(CAR)
    await nextCycle()

    expect(API.getOrders).toHaveBeenCalledTimes(1)
    expect(polling.successes()).toBe(1)
    expect(polling.getState().orders.readyOrders.toArray()).toEqual([ORDER.b_id])

    await nextCycle()

    expect(API.getOrders).toHaveBeenCalledTimes(2)
  })

})

describe('опрос готовых заказов: машина не в рейсе (used_car_not_found)', () => {

  /**
   * Сценарий свежей страницы водителя: getUserCars() и watchReadyOrders()
   * вызываются в соседних эффектах одного монтирования (pages/Driver/index.tsx),
   * поэтому на первом цикле машины ещё не загружены. Ветка `=== null` здесь не
   * срабатывает — сага идёт в API, и зависание наступает в ветке
   * used_car_not_found, где попытка взять машину в рейс ждёт загрузки машин.
   */
  it('машины ещё не загружены: цикл завершается, опрос не ждёт попытку рейса', async() => {
    const API = mockApi()
    API.getOrders.mockResolvedValue(usedCarNotFound())

    const polling = startPolling({ primaryCar: undefined })
    await settle()

    expect(API.getOrders).toHaveBeenCalledTimes(1)
    expect(polling.fails()).toBe(1)
    expect(polling.ofType(polling.T.GET_READY_ORDERS_FAIL)[0].payload)
      .toEqual({ detail: 'used_car_not_found' })
    // Попытка рейса запросила машины и ждёт их — это не должно держать опрос.
    expect(polling.carsRequests()).toBe(1)
    expect(API.driveCar).not.toHaveBeenCalled()

    await nextCycle()

    expect(polling.requests()).toBe(2)
    expect(API.getOrders).toHaveBeenCalledTimes(2)
    // Пока первая попытка не завершилась, вторая не запускается.
    expect(polling.carsRequests()).toBe(1)
  })

  it('рейс не удался («машина уже в рейсе»): одна попытка, одно предупреждение, опрос идёт', async() => {
    const API = mockApi()
    API.getOrders.mockResolvedValue(usedCarNotFound())
    API.driveCar.mockResolvedValue(alreadyDriven())

    const polling = startPolling({ primaryCar: CAR })
    await settle()

    expect(API.driveCar).toHaveBeenCalledTimes(1)
    expect(polling.messageModals()).toBe(1)

    await nextCycle()
    await nextCycle()

    expect(API.getOrders).toHaveBeenCalledTimes(3)
    expect(polling.fails()).toBe(3)
    // Рейс не повторяется на каждом цикле, окно не открывается заново.
    expect(API.driveCar).toHaveBeenCalledTimes(1)
    expect(polling.messageModals()).toBe(1)
  })

  it('рейс удался, а список всё ещё недоступен: один немедленный повтор, без цикла запросов', async() => {
    const API = mockApi()
    // Предохранитель теста, а не часть сценария. Без исправления эта ветка
    // крутит «запрос → рейс → запрос» без задержки, и цикл идёт на одних
    // микротасках: он голодит event loop, и зависает весь файл, а не падает
    // один тест. После 20 вызовов мок перестаёт отвечать — цикл останавливается,
    // и регрессия видна как упавшее утверждение о числе вызовов.
    const LOOP_GUARD = 20
    API.getOrders.mockImplementation(() =>
      API.getOrders.mock.calls.length > LOOP_GUARD ?
        new Promise(() => {}) :
        Promise.resolve(usedCarNotFound()))
    API.driveCar.mockResolvedValue(driveOk())

    startPolling({ primaryCar: CAR })
    await settle()

    // Без продвижения времени: исходный цикл и один повтор после удачного рейса.
    expect(API.driveCar).toHaveBeenCalledTimes(1)
    expect(API.getOrders).toHaveBeenCalledTimes(2)
  })

  it('после успешной выборки автоматическая попытка рейса снова разрешена', async() => {
    const API = mockApi()
    API.getOrders
      .mockResolvedValueOnce(usedCarNotFound())
      .mockResolvedValueOnce(ok([ORDER]))
      .mockResolvedValue(usedCarNotFound())
    API.driveCar.mockResolvedValue(alreadyDriven())

    const polling = startPolling({ primaryCar: CAR })
    await settle()
    expect(API.driveCar).toHaveBeenCalledTimes(1)

    await nextCycle()
    expect(polling.successes()).toBe(1)

    await nextCycle()
    expect(API.getOrders).toHaveBeenCalledTimes(3)
    expect(API.driveCar).toHaveBeenCalledTimes(2)
  })

})
