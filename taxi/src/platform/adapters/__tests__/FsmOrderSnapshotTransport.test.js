import {
  createConfiguredFsmOrderSnapshotProvider,
  FsmOrderSnapshotTransport,
} from '../FsmOrderSnapshotTransport'
import {
  createPlatformInterfaceComposition,
  DomainApiSnapshotProvider,
} from '../../platform-interface'

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
    readyState: 0,
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
    send: jest.fn(),
    close: jest.fn(),
  }
}

const SERVER_SNAPSHOT = {
  orderId: 42,
  state: 'order_vote_waiting_candidates',
  mode: 'VOTE',
  availableActions: ['order_select_candidate', 'order_cancel_by_client'],
}

describe('FsmOrderSnapshotTransport', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('loads and maps an authenticated Query API snapshot', async() => {
    const fetchRequest = jest.fn().mockResolvedValue(createResponse(SERVER_SNAPSHOT))
    const transport = new FsmOrderSnapshotTransport({
      apiUrl: 'https://fsm.example.test/',
      orderId: 42,
      apiToken: 'driver-secret',
    }, {
      fetch: fetchRequest,
      now: () => '2026-08-08T12:00:00.000Z',
    })

    await expect(transport.loadSnapshot()).resolves.toEqual(expect.objectContaining({
      revision: 1,
      availableActions: SERVER_SNAPSHOT.availableActions,
      updatedAt: '2026-08-08T12:00:00.000Z',
      state: {
        domainOrder: expect.objectContaining({
          service: 'taxi',
          entityType: 'order',
          entityId: 42,
          snapshot: SERVER_SNAPSHOT,
        }),
      },
    }))
    expect(fetchRequest).toHaveBeenCalledWith(
      'https://fsm.example.test/api/realtime/snapshot/taxi/order/42',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer driver-secret' }),
      }),
    )
  })

  it('delivers initial and updated snapshots and ignores ping', () => {
    const sockets = []
    const socketFactory = jest.fn(url => {
      const socket = createSocket()
      socket.url = url
      sockets.push(socket)
      return socket
    })
    const transport = new FsmOrderSnapshotTransport({
      apiUrl: 'https://fsm.example.test',
      orderId: 42,
      apiToken: 'driver-secret',
      webSocketTokenQueryParameter: 'access_token',
    }, { socketFactory })
    const listener = jest.fn()
    const stop = transport.subscribeSnapshots(listener)

    expect(sockets[0].url).toBe(
      'wss://fsm.example.test/api/realtime/ws/taxi/order/42?access_token=driver-secret',
    )
    sockets[0].onmessage({
      data: JSON.stringify({ type: 'snapshot', snapshot: SERVER_SNAPSHOT }),
    })
    sockets[0].onmessage({ data: JSON.stringify({ type: 'ping' }) })
    sockets[0].onmessage({
      data: JSON.stringify({
        type: 'entity.updated',
        event: { eventId: 10 },
        snapshot: { ...SERVER_SNAPSHOT, state: 'order_vote_driver_assigned' },
      }),
    })

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[0][0].revision).toBe(1)
    expect(listener.mock.calls[1][0]).toEqual(expect.objectContaining({
      revision: 2,
      state: {
        domainOrder: expect.objectContaining({
          snapshot: expect.objectContaining({ state: 'order_vote_driver_assigned' }),
        }),
      },
    }))

    stop()
    expect(sockets[0].close).toHaveBeenCalledTimes(1)
  })

  it('reconnects after a break and accepts the recovery snapshot', () => {
    const sockets = []
    const socketFactory = jest.fn(() => {
      const socket = createSocket()
      sockets.push(socket)
      return socket
    })
    const transport = new FsmOrderSnapshotTransport({
      apiUrl: 'http://fsm.example.test',
      orderId: 42,
    }, {
      socketFactory,
      reconnect: { initialDelayMs: 100, maxDelayMs: 100 },
    })
    const listener = jest.fn()
    const stop = transport.subscribeSnapshots(listener)

    sockets[0].onclose({ code: 1006 })
    jest.advanceTimersByTime(99)
    expect(socketFactory).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    expect(socketFactory).toHaveBeenCalledTimes(2)

    sockets[1].onmessage({
      data: JSON.stringify({ type: 'snapshot', snapshot: SERVER_SNAPSHOT }),
    })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }))

    stop()
    expect(sockets[1].close).toHaveBeenCalledTimes(1)
  })

  it('normalizes Query API errors', async() => {
    const fetchRequest = jest.fn().mockResolvedValue(createResponse({ detail: 'Forbidden' }, 403))
    const transport = new FsmOrderSnapshotTransport({
      apiUrl: 'https://fsm.example.test',
      orderId: 42,
    }, { fetch: fetchRequest })

    await expect(transport.loadSnapshot()).rejects.toEqual(expect.objectContaining({
      code: 'FSM_QUERY_HTTP_403',
      message: 'Forbidden',
    }))
  })

  it('creates a server provider only when URL and orderId are configured', () => {
    expect(createConfiguredFsmOrderSnapshotProvider({})).toBeNull()
    expect(createConfiguredFsmOrderSnapshotProvider({
      REACT_APP_FSM_API_URL: 'https://fsm.example.test',
      REACT_APP_FSM_ORDER_ID: '42',
    })).not.toBeNull()
  })

  it('delivers Query and Realtime through PI Runtime and stops with its Surface', async() => {
    const fetchRequest = jest.fn().mockResolvedValue(createResponse(SERVER_SNAPSHOT))
    const socket = createSocket()
    const transport = new FsmOrderSnapshotTransport({
      apiUrl: 'https://fsm.example.test',
      orderId: 42,
    }, {
      fetch: fetchRequest,
      socketFactory: jest.fn(() => socket),
    })
    const composition = createPlatformInterfaceComposition({
      snapshotProvider: new DomainApiSnapshotProvider(transport),
      logger: { log: jest.fn(), error: jest.fn() },
    })

    const unmount = composition.runtime.mountSurface(composition.hudSurface.id)
    await composition.runtime.start()

    expect(composition.runtime.getState()).toEqual(expect.objectContaining({
      status: 'ready',
      snapshot: expect.objectContaining({
        revision: 1,
        availableActions: SERVER_SNAPSHOT.availableActions,
      }),
    }))

    socket.onmessage({
      data: JSON.stringify({
        type: 'entity.updated',
        snapshot: { ...SERVER_SNAPSHOT, state: 'order_vote_driver_assigned' },
      }),
    })
    expect(composition.runtime.getSnapshot().state.domainOrder.snapshot.state)
      .toBe('order_vote_driver_assigned')

    unmount()
    expect(composition.runtime.getState().status).toBe('stopped')
    expect(socket.close).toHaveBeenCalledTimes(1)
  })
})
