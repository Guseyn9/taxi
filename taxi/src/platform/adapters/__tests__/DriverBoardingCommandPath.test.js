import fs from 'fs'
import path from 'path'

import { backendGateway } from '../LegacyBackendGateway'
import {
  DRIVER_MAP_EVENTS,
  DriverMapGateway,
} from '../DriverMapGateway'

jest.mock('../LegacyBackendGateway', () => ({
  backendGateway: {
    arrivedVotingOrder: jest.fn().mockResolvedValue({ status: 'ok' }),
    confirmVotingCode: jest.fn().mockResolvedValue({ status: 'ok' }),
    makeRoutePoints: jest.fn(),
    reverseGeocode: jest.fn(),
    setOrderState: jest.fn().mockResolvedValue({ status: 'ok' }),
  },
}))

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

const boardingEvents = listener => listener.mock.calls
  .map(([event]) => event.type)
  .filter(type => type === DRIVER_MAP_EVENTS.BoardingConfirmed)

/**
 * §14 ТЗ: у посадки один command path — CardModal/страница заказа → шлюз →
 * бэкенд. Прежний прямой вызов API.confirmVotingCode вернуться не должен, как и
 * второй, параллельный шлюзу, перевод заказа в Started.
 */
describe('Driver boarding command path', () => {

  const CALLERS = [
    'src/components/modals/CardModal.tsx',
    'src/pages/Order/index.tsx',
  ]

  it.each(CALLERS)('%s подтверждает посадку только через шлюз', relativePath => {
    const source = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')

    expect(source).toMatch(/driverMapGateway\.confirmBoarding\(/)
    expect(source.match(/driverMapGateway\.confirmBoarding\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/API\.confirmVotingCode/)
    expect(source).not.toMatch(/backendGateway\.confirmVotingCode/)
    expect(source).not.toMatch(/\.setState\(\s*orderId/)
    expect(source).not.toMatch(/setOrderState\(/)
  })

  // Сама цепочка «BoardingConfirmed → состояние = Started» проверяется в runtime
  // (DriverBoardingProjection.test.js). Здесь сторожится только то, что карта эту
  // цепочку действительно подключает и кормит отметкой подтверждённой посадки:
  // рендерить Driver/Map.tsx в тесте нечем.
  it('карта водителя подключает подписку на подтверждённую посадку', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/Driver/Map.tsx'),
      'utf8',
    )

    expect(source).toMatch(/subscribeDriverBoardingConfirmed\(driverMapGateway/)
    expect(source).toMatch(/confirmedBoardingOrderIds:\s*startedVotingOrderIds/)
  })

})

/**
 * Событие успеха — тот сигнал, по которому карта водителя приводит своё
 * состояние к результату бэкенда. Оно должно приходить в обоих режимах и не
 * приходить при ошибке.
 */
describe('DriverMapGateway boarding completion event', () => {

  beforeEach(() => jest.clearAllMocks())

  it('legacy fallback: публикует BoardingConfirmed после успеха бэкенда', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await gateway.confirmBoarding('42', '1234')

    expect(backendGateway.confirmVotingCode).toHaveBeenCalledTimes(1)
    expect(backendGateway.setOrderState).toHaveBeenCalledWith('42', 5, '1234')
    expect(boardingEvents(listener)).toEqual([DRIVER_MAP_EVENTS.BoardingConfirmed])
  })

  it('Command API: публикует BoardingConfirmed только после терминального результата', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 100,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const gateway = new DriverMapGateway(runtime, commandTransport)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    const completion = gateway.confirmBoarding('42', '1234')
    for (let index = 0; index < 4; index += 1)
      await Promise.resolve()

    expect(boardingEvents(listener)).toEqual([])

    runtime.setSnapshot({
      state: {
        domainDriver: {
          snapshot: {
            driver: {
              activeOrders: [{ orderId: 42, state: 'order_in_ride' }],
            },
          },
        },
      },
    })
    await completion

    expect(boardingEvents(listener)).toEqual([DRIVER_MAP_EVENTS.BoardingConfirmed])
  })

  it('неверный код: события успеха нет, заказ в Started не переводится', async() => {
    backendGateway.confirmVotingCode.mockResolvedValueOnce({
      status: 'error',
      message: 'wrong code',
    })
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await expect(gateway.confirmBoarding('42', '4321')).rejects.toEqual(expect.objectContaining({
      code: 'BACKEND_RESPONSE_ERROR',
    }))

    expect(backendGateway.setOrderState).not.toHaveBeenCalled()
    expect(boardingEvents(listener)).toEqual([])
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Failed,
    }))
  })

})
