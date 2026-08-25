import { EBookingDriverState } from '../../../types/types'
import { confirmDriverBoarding } from '../../../tools/driverBoarding'
import {
  isDriverOrderBoarded,
  resolveEffectiveDriverState,
} from '../../../tools/driverOrderState'
import { backendGateway } from '../LegacyBackendGateway'
import { DriverMapGateway } from '../DriverMapGateway'
import { subscribeDriverBoardingConfirmed } from '../DriverBoardingProjection'

jest.mock('../LegacyBackendGateway', () => ({
  backendGateway: {
    arrivedVotingOrder: jest.fn().mockResolvedValue({ status: 'ok' }),
    confirmVotingCode: jest.fn().mockResolvedValue({ status: 'ok' }),
    makeRoutePoints: jest.fn(),
    reverseGeocode: jest.fn(),
    setOrderState: jest.fn().mockResolvedValue({ status: 'ok' }),
  },
}))

const ORDER_ID = '1509-2'

function createRuntime() {
  const handlers = []
  const listeners = []
  const runtimeListeners = []
  let snapshot = null
  return {
    registerHandler: handler => {
      handlers.push(handler)
      return () => handlers.splice(handlers.indexOf(handler), 1)
    },
    subscribe: listener => {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    },
    subscribeRuntime: listener => {
      runtimeListeners.push(listener)
      return () => runtimeListeners.splice(runtimeListeners.indexOf(listener), 1)
    },
    getSnapshot: () => snapshot,
    setSnapshot: nextSnapshot => {
      snapshot = nextSnapshot
      runtimeListeners.slice().forEach(listener => listener({ snapshot }))
    },
    publish: event => listeners.slice().forEach(listener => listener(event)),
    dispatch: async action => {
      for (const handler of handlers.slice())
        await handler(action)
    },
  }
}

const IN_RIDE_SNAPSHOT = {
  state: {
    domainDriver: {
      snapshot: {
        driver: {
          activeOrders: [{ orderId: ORDER_ID, state: 'order_in_ride' }],
        },
      },
    },
  },
}

/**
 * Карта водителя: та же подписка на шлюз, что и в Driver/Map.tsx, и то же
 * правило состояния, по которому она рисует основную кнопку. React здесь не
 * нужен — проверяется цепочка, а не разметка.
 */
function createDriverMap(gateway, { confirmedBoardingOrderIds = [] } = {}) {
  const optimistic = {}
  const refreshed = []
  const unsubscribe = subscribeDriverBoardingConfirmed(gateway, {
    rememberBoardedState: (orderId, state) => { optimistic[String(orderId)] = state },
    refreshOrderState: orderId => refreshed.push(String(orderId)),
  })

  return {
    unsubscribe,
    refreshed,
    /** То, что карта показывает, пока список активных заказов ещё отстаёт. */
    effectiveStateOf: (orderId, backendState) => resolveEffectiveDriverState({
      backendState,
      optimisticState: optimistic[String(orderId)],
      boarded: isDriverOrderBoarded(orderId, { confirmedBoardingOrderIds }),
    }),
  }
}

/** Карточка заказа: единственный command path — шлюз, затем отметки посадки. */
function confirmFromCard(gateway, { confirmedBoardingOrderIds, synced }, code = '1234') {
  return confirmDriverBoarding({
    orderId: ORDER_ID,
    code,
    confirmBoarding: (orderId, boardingCode) => gateway.confirmBoarding(orderId, boardingCode),
    syncOrderState: orderId => synced.push(String(orderId)),
    onBoarded: orderId => confirmedBoardingOrderIds.push(String(orderId)),
  })
}

/**
 * Полная цепочка ТЗ DRIVER-BOARDING-001, в runtime:
 *
 *   confirmBoarding success -> BoardingConfirmed -> подписка карты ->
 *   rememberOptimisticState(Started) -> effectiveState = Started
 */
describe('Driver boarding: подтверждение кода -> состояние карты', () => {

  beforeEach(() => jest.clearAllMocks())

  it('legacy fallback: после успеха карта немедленно показывает Started', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    gateway.mount()

    const confirmedBoardingOrderIds = []
    const synced = []
    const map = createDriverMap(gateway, { confirmedBoardingOrderIds })

    // До подтверждения водитель стоит у пассажира: кнопка — «Код посадки».
    expect(map.effectiveStateOf(ORDER_ID, EBookingDriverState.Arrived))
      .toBe(EBookingDriverState.Arrived)

    await confirmFromCard(gateway, { confirmedBoardingOrderIds, synced })

    // Бэкенд ещё отдаёт Arrived (список заказов отстаёт), но карта уже в поездке.
    expect(map.effectiveStateOf(ORDER_ID, EBookingDriverState.Arrived))
      .toBe(EBookingDriverState.Started)
    expect(map.refreshed).toEqual([ORDER_ID])
    expect(synced).toEqual([ORDER_ID])

    map.unsubscribe()
  })

  /**
   * Немедленность обеспечивают ДВА независимых механизма — событие шлюза и
   * отметка, которую ставит карточка. Проверяем каждый по отдельности, иначе
   * один прикрывает поломку другого и тест перестаёт что-либо сторожить.
   *
   * Здесь у карты своего списка отметок нет: поднять состояние может только
   * цепочка BoardingConfirmed → rememberOptimisticState(Started).
   */
  it('одного события шлюза достаточно, чтобы карта перешла в Started', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    gateway.mount()

    const map = createDriverMap(gateway, { confirmedBoardingOrderIds: [] })

    await confirmFromCard(gateway, { confirmedBoardingOrderIds: [], synced: [] })

    expect(map.effectiveStateOf(ORDER_ID, EBookingDriverState.Arrived))
      .toBe(EBookingDriverState.Started)
    expect(map.refreshed).toEqual([ORDER_ID])

    map.unsubscribe()
  })

  it('Command API: состояние меняется только после терминального результата', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 100,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const gateway = new DriverMapGateway(runtime, commandTransport)
    gateway.mount()

    const confirmedBoardingOrderIds = []
    const synced = []
    const map = createDriverMap(gateway, { confirmedBoardingOrderIds })

    const completion = confirmFromCard(gateway, { confirmedBoardingOrderIds, synced })
    for (let index = 0; index < 4; index += 1)
      await Promise.resolve()

    // Команда принята, но ещё не выполнена — состояние трогать рано.
    expect(map.effectiveStateOf(ORDER_ID, EBookingDriverState.Arrived))
      .toBe(EBookingDriverState.Arrived)
    expect(map.refreshed).toEqual([])

    runtime.setSnapshot(IN_RIDE_SNAPSHOT)
    await completion

    expect(map.effectiveStateOf(ORDER_ID, EBookingDriverState.Arrived))
      .toBe(EBookingDriverState.Started)
    expect(map.refreshed).toEqual([ORDER_ID])

    map.unsubscribe()
  })

  it('неверный код: события нет, карта остаётся в режиме посадки', async() => {
    backendGateway.confirmVotingCode.mockResolvedValueOnce({
      status: 'error',
      message: 'wrong code',
    })
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    gateway.mount()

    const confirmedBoardingOrderIds = []
    const synced = []
    const map = createDriverMap(gateway, { confirmedBoardingOrderIds })

    await expect(confirmFromCard(gateway, { confirmedBoardingOrderIds, synced }, '4321'))
      .rejects.toEqual(expect.objectContaining({ code: 'BACKEND_RESPONSE_ERROR' }))

    expect(backendGateway.setOrderState).not.toHaveBeenCalled()
    expect(map.effectiveStateOf(ORDER_ID, EBookingDriverState.Arrived))
      .toBe(EBookingDriverState.Arrived)
    expect(map.refreshed).toEqual([])
    expect(synced).toEqual([])
    expect(confirmedBoardingOrderIds).toEqual([])

    map.unsubscribe()
  })

  // Второй механизм в изоляции: события эта карта не получала вовсе.
  it('карта, открытая уже после подтверждения, состояние не теряет', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    gateway.mount()

    const confirmedBoardingOrderIds = []
    const synced = []
    // Карточку открыли из списка: карты в этот момент на экране нет.
    await confirmFromCard(gateway, { confirmedBoardingOrderIds, synced })

    // Карта монтируется после подтверждения и события уже не получит — состояние
    // восстанавливается из отметки, которую поставила карточка.
    const map = createDriverMap(gateway, { confirmedBoardingOrderIds })

    expect(map.effectiveStateOf(ORDER_ID, EBookingDriverState.Arrived))
      .toBe(EBookingDriverState.Started)

    map.unsubscribe()
  })

  it('отписка карты прекращает обновления', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    gateway.mount()

    const confirmedBoardingOrderIds = []
    const synced = []
    const map = createDriverMap(gateway)
    map.unsubscribe()

    await confirmFromCard(gateway, { confirmedBoardingOrderIds, synced })

    expect(map.refreshed).toEqual([])
  })

})
