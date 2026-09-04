import { backendGateway } from '../LegacyBackendGateway'
import {
  DRIVER_MAP_EVENTS,
  DriverMapGateway,
} from '../DriverMapGateway'

jest.mock('../LegacyBackendGateway', () => ({
  backendGateway: {
    arrivedVotingOrder: jest.fn().mockResolvedValue({ status: 'ok' }),
    cancelDrive: jest.fn().mockResolvedValue({ status: 'ok' }),
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

describe('DriverMapGateway', () => {
  beforeEach(() => jest.clearAllMocks())

  it('executes lifecycle mutations behind the contract and publishes success', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    const unmount = gateway.mount()
    gateway.subscribe(listener)

    await gateway.arrive('42', true)

    expect(backendGateway.setOrderState).toHaveBeenCalledWith('42', 4)
    expect(backendGateway.arrivedVotingOrder).toHaveBeenCalledWith('42')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Arrived,
      payload: { orderId: '42' },
    }))
    unmount()
  })

  it('normalizes backend rejection and publishes a failure event', async() => {
    backendGateway.setOrderState.mockResolvedValueOnce({
      status: 'error',
      message: 'wrong state',
    })
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await expect(gateway.start('42')).rejects.toEqual(expect.objectContaining({
      code: 'BACKEND_RESPONSE_ERROR',
      message: 'wrong state',
    }))

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Failed,
      payload: expect.objectContaining({
        actionType: 'driver.order.start',
        orderId: '42',
        code: 'BACKEND_RESPONSE_ERROR',
        message: 'wrong state',
      }),
    }))
  })

  it('confirms voting boarding and starts the order through one action', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await gateway.confirmBoarding('42', '1234')

    expect(backendGateway.confirmVotingCode).toHaveBeenCalledWith('42', '1234')
    expect(backendGateway.setOrderState).toHaveBeenCalledWith('42', 5, '1234')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.BoardingConfirmed,
      payload: { orderId: '42' },
    }))
  })

  it('routes presentation and application requests through events', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await gateway.openCard('42')
    await gateway.requestAreas([[1, 2], [3, 4]])

    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      DRIVER_MAP_EVENTS.CardOpened,
      DRIVER_MAP_EVENTS.AreasRequested,
    ])
  })

  it('routes driver cancellation through the legacy PI boundary', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await gateway.cancel('42', 'Vehicle issue')

    expect(backendGateway.cancelDrive).toHaveBeenCalledWith('42', 'Vehicle issue')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Cancelled,
      payload: { orderId: '42' },
    }))
  })

  it('sends driver cancellation through Command API when it is configured', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 104,
      status: 'PENDING',
      intent: 'cancel_requested',
    }) }
    const completionWaiter = {
      captureBaseline: jest.fn().mockReturnValue({ state: 'order_in_ride' }),
      wait: jest.fn().mockResolvedValue({ status: 'COMPLETED', instanceId: 104 }),
      fail: jest.fn(),
      cancelAll: jest.fn(),
    }
    const gateway = new DriverMapGateway(runtime, commandTransport, 60000, completionWaiter)
    gateway.mount()

    await gateway.cancel('42', 'Vehicle issue')

    expect(commandTransport.send).toHaveBeenCalledWith(
      '42',
      'cancel_requested',
      { reason: 'Vehicle issue' },
      expect.objectContaining({ source: 'driver.interface' }),
    )
    expect(completionWaiter.wait).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'driver.order.cancel',
      orderId: '42',
      instanceId: 104,
    }))
    expect(backendGateway.cancelDrive).not.toHaveBeenCalled()
  })

  it('publishes command accepted without claiming an asynchronous transition completed', async() => {
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

    let completed = false
    const completion = gateway.confirmBoarding('42', '1234')
      .then(() => { completed = true })
    for (let index = 0; index < 4; index += 1)
      await Promise.resolve()

    expect(commandTransport.send).toHaveBeenCalledWith(
      '42',
      'driver.order.confirm_boarding',
      { boardingCode: '1234' },
      expect.objectContaining({
        source: 'driver.interface',
        correlationId: expect.any(String),
      }),
    )
    expect(backendGateway.confirmVotingCode).not.toHaveBeenCalled()
    expect(backendGateway.setOrderState).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.CommandAccepted,
      payload: {
        actionType: 'driver.order.confirm_boarding',
        orderId: '42',
        instanceId: 100,
        status: 'PENDING',
        intent: 'ride_started',
        duplicate: false,
      },
    }))
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.BoardingConfirmed,
    }))
    expect(completed).toBe(false)

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
    expect(completed).toBe(true)
  })

  it('passes the accepted instanceId to the replaceable completion waiter', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 150,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const completionWaiter = {
      captureBaseline: jest.fn().mockReturnValue({ state: 'order_driver_arrived' }),
      wait: jest.fn().mockResolvedValue({ status: 'COMPLETED', instanceId: 150 }),
      fail: jest.fn(),
      cancelAll: jest.fn(),
    }
    const gateway = new DriverMapGateway(
      runtime,
      commandTransport,
      60000,
      completionWaiter,
    )
    gateway.mount()

    await gateway.start('42')

    expect(completionWaiter.captureBaseline).toHaveBeenCalledWith('42')
    expect(completionWaiter.wait).toHaveBeenCalledWith({
      actionType: 'driver.order.start',
      orderId: '42',
      instanceId: 150,
      baseline: { state: 'order_driver_arrived' },
    })
  })

  it('keeps finish pending until the completed state is visible in Snapshot', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 101,
      status: 'PENDING',
      intent: 'ride_finished',
    }) }
    const gateway = new DriverMapGateway(runtime, commandTransport)
    gateway.mount()

    let completed = false
    const completion = gateway.finish('42').then(() => { completed = true })
    for (let index = 0; index < 4; index += 1)
      await Promise.resolve()

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
    await Promise.resolve()
    expect(completed).toBe(false)

    runtime.setSnapshot({
      state: {
        domainDriver: {
          snapshot: {
            driver: {
              historyOrders: [{ orderId: 42, state: 'order_completed' }],
            },
          },
        },
      },
    })
    await completion
    expect(completed).toBe(true)
  })

  it('does not complete a new command from a target state that existed before acceptance', async() => {
    const runtime = createRuntime()
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
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 102,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const gateway = new DriverMapGateway(runtime, commandTransport, 0)
    gateway.mount()

    let completed = false
    void gateway.start('42').then(() => { completed = true })
    for (let index = 0; index < 4; index += 1)
      await Promise.resolve()

    expect(completed).toBe(false)
  })

  it('does not treat an accepted duplicate as proof that its transition completed', async() => {
    const runtime = createRuntime()
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
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: true,
      instanceId: 103,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const gateway = new DriverMapGateway(runtime, commandTransport, 0)
    gateway.mount()

    let completed = false
    void gateway.start('42').then(() => { completed = true })
    for (let index = 0; index < 4; index += 1)
      await Promise.resolve()

    expect(completed).toBe(false)
  })
})
