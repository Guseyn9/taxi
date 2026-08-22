import {
  createConfiguredFsmDriverSnapshotProvider,
  FsmDriverSnapshotTransport,
} from '../FsmDriverSnapshotTransport'

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

function createSocket() {
  return {
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
    close: jest.fn(),
  }
}

const DRIVER_SNAPSHOT = {
  driverUserId: 205,
  driver: {
    user: { userId: 205 },
    readyOrders: [{
      orderId: 10,
      state: 'order_vote_waiting_candidates',
      mode: 'VOTE',
      availableActions: [],
    }],
    activeOrders: [{
      orderId: 11,
      state: 'order_driver_assigned',
      mode: 'DIRECT',
      price: 1200,
      availableActions: ['driver.order.arrive'],
    }],
    historyOrders: [{
      orderId: 12,
      state: 'order_completed',
      mode: 'DIRECT',
      availableActions: [],
    }],
    currentTrip: {
      orderId: 11,
      state: 'order_driver_assigned',
      mode: 'DIRECT',
      availableActions: ['driver.order.arrive'],
    },
  },
  availableActions: ['driver.order.arrive'],
}

describe('FsmDriverSnapshotTransport', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('loads Driver Snapshot and maps it to the current PI projection', async() => {
    const fetchRequest = jest.fn().mockResolvedValue(createResponse(DRIVER_SNAPSHOT))
    const transport = new FsmDriverSnapshotTransport({
      apiUrl: 'https://fsm.example.test/',
      driverUserId: 205,
      apiToken: 'driver-token',
    }, {
      fetch: fetchRequest,
      now: () => '2026-08-14T12:00:00.000Z',
    })

    const snapshot = await transport.loadSnapshot()

    expect(fetchRequest).toHaveBeenCalledWith(
      'https://fsm.example.test/api/realtime/snapshot/taxi/driver/205',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer driver-token' }),
      }),
    )
    expect(snapshot.availableActions).toEqual(['driver.order.arrive'])
    expect(snapshot.state.driver.user).toEqual({ userId: 205, u_id: '205' })
    expect(snapshot.state.driver.activeOrders[0]).toEqual(expect.objectContaining({
      b_id: '11',
      b_state: 2,
      b_price_estimate: 1200,
      drivers: [expect.objectContaining({ u_id: '205', c_state: 3 })],
    }))
    expect(snapshot.state.driver.activeOrders[0]).not.toHaveProperty('u_id')
    expect(snapshot.state.driver.activeOrders[0]).not.toHaveProperty('b_start_datetime')
    expect(snapshot.state.driver.activeOrders[0]).not.toHaveProperty('b_passengers_count')
    expect(snapshot.state.driver.activeOrders[0]).not.toHaveProperty('b_currency')
    expect(snapshot.state.driver.readyOrders[0]).toEqual(expect.objectContaining({
      b_id: '10',
      b_state: 6,
      b_voting: true,
    }))
    expect(snapshot.state.driver.historyOrders[0]).toEqual(expect.objectContaining({
      b_id: '12',
      b_state: 4,
    }))
    expect(snapshot.state.domainDriver.snapshot).toBe(DRIVER_SNAPSHOT)
  })

  it('uses Driver WS and keeps Query recovery polling active', async() => {
    const fetchRequest = jest.fn().mockResolvedValue(createResponse(DRIVER_SNAPSHOT))
    const socket = createSocket()
    const socketFactory = jest.fn(url => {
      socket.url = url
      return socket
    })
    const transport = new FsmDriverSnapshotTransport({
      apiUrl: 'https://fsm.example.test',
      driverUserId: 205,
      apiToken: 'driver-token',
      webSocketTokenQueryParameter: 'access_token',
      recoveryPollIntervalMs: 100,
    }, { fetch: fetchRequest, socketFactory })
    const listener = jest.fn()
    const stop = transport.subscribeSnapshots(listener)

    expect(socket.url).toBe(
      'wss://fsm.example.test/api/realtime/ws/taxi/driver/205?access_token=driver-token',
    )
    socket.onmessage({
      data: JSON.stringify({ type: 'snapshot', snapshot: DRIVER_SNAPSHOT }),
    })
    expect(listener).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(100)
    for (let index = 0; index < 6; index += 1)
      await Promise.resolve()
    expect(fetchRequest).toHaveBeenCalledTimes(1)

    stop()
    expect(socket.close).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(100)
    expect(fetchRequest).toHaveBeenCalledTimes(1)
  })

  it('does not let an older polling revision replace a newer WS snapshot', async() => {
    const fetchRequest = jest.fn().mockResolvedValue(createResponse({
      ...DRIVER_SNAPSHOT,
      revision: 19,
    }))
    const socket = createSocket()
    const transport = new FsmDriverSnapshotTransport({
      apiUrl: 'https://fsm.example.test',
      driverUserId: 205,
      recoveryPollIntervalMs: 100,
    }, {
      fetch: fetchRequest,
      socketFactory: () => socket,
    })
    const listener = jest.fn()
    const stop = transport.subscribeSnapshots(listener)

    socket.onmessage({
      data: JSON.stringify({
        type: 'entity.updated',
        snapshot: { ...DRIVER_SNAPSHOT, revision: 20 },
      }),
    })
    jest.advanceTimersByTime(100)
    for (let index = 0; index < 6; index += 1)
      await Promise.resolve()

    expect(fetchRequest).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toEqual(expect.objectContaining({ revision: 20 }))
    stop()
  })

  it('discards an unversioned Query that started before a WS update', async() => {
    let resolveQuery
    const fetchRequest = jest.fn().mockReturnValue(new Promise(resolve => {
      resolveQuery = resolve
    }))
    const socket = createSocket()
    const transport = new FsmDriverSnapshotTransport({
      apiUrl: 'https://fsm.example.test',
      driverUserId: 205,
      recoveryPollIntervalMs: 0,
    }, {
      fetch: fetchRequest,
      socketFactory: () => socket,
    })
    const listener = jest.fn()
    const stop = transport.subscribeSnapshots(listener)
    const query = transport.loadSnapshot()

    socket.onmessage({
      data: JSON.stringify({
        type: 'snapshot',
        snapshot: {
          ...DRIVER_SNAPSHOT,
          driver: {
            ...DRIVER_SNAPSHOT.driver,
            activeOrders: [{
              ...DRIVER_SNAPSHOT.driver.activeOrders[0],
              state: 'order_driver_arrived',
            }],
          },
        },
      }),
    })
    resolveQuery(createResponse(DRIVER_SNAPSHOT))

    const result = await query
    expect(listener).toHaveBeenCalledTimes(1)
    expect(result.state.domainDriver.snapshot.driver.activeOrders[0].state)
      .toBe('order_driver_arrived')
    stop()
  })

  it('normalizes query errors and requires URL plus driver id', async() => {
    const transport = new FsmDriverSnapshotTransport({
      apiUrl: 'https://fsm.example.test',
      driverUserId: 205,
    }, {
      fetch: jest.fn().mockResolvedValue(createResponse({ detail: 'Forbidden' }, 403)),
    })

    await expect(transport.loadSnapshot()).rejects.toEqual(expect.objectContaining({
      code: 'FSM_DRIVER_QUERY_HTTP_403',
      message: 'Forbidden',
    }))
    expect(createConfiguredFsmDriverSnapshotProvider(null, {})).toBeNull()
    expect(createConfiguredFsmDriverSnapshotProvider(205, {
      REACT_APP_FSM_API_URL: 'https://fsm.example.test',
    })).not.toBeNull()
  })
})
