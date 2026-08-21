import { ReconnectingSnapshotTransport } from '../ReconnectingSnapshotTransport'

describe('ReconnectingSnapshotTransport', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('reconnects with backoff and resets it after a delivered snapshot', () => {
    const disconnects = []
    const snapshots = []
    const stops = []
    const connector = {
      connect: jest.fn((onSnapshot, onDisconnect) => {
        snapshots.push(onSnapshot)
        disconnects.push(onDisconnect)
        const stop = jest.fn()
        stops.push(stop)
        return stop
      }),
    }
    const transport = new ReconnectingSnapshotTransport(
      jest.fn(),
      connector,
      { initialDelayMs: 100, maxDelayMs: 400 },
    )
    const listener = jest.fn()
    const unsubscribe = transport.subscribeSnapshots(listener)

    expect(connector.connect).toHaveBeenCalledTimes(1)
    disconnects[0]()
    jest.advanceTimersByTime(99)
    expect(connector.connect).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    expect(connector.connect).toHaveBeenCalledTimes(2)

    snapshots[1]({ revision: 2, state: {}, availableActions: [] })
    disconnects[1]()
    jest.advanceTimersByTime(100)
    expect(connector.connect).toHaveBeenCalledTimes(3)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }))

    unsubscribe()
    expect(stops[2]).toHaveBeenCalledTimes(1)
  })

  it('cancels a scheduled reconnect on unsubscribe', () => {
    let disconnect
    const connector = {
      connect: jest.fn((_onSnapshot, onDisconnect) => {
        disconnect = onDisconnect
        return jest.fn()
      }),
    }
    const transport = new ReconnectingSnapshotTransport(
      jest.fn(),
      connector,
      { initialDelayMs: 100 },
    )
    const unsubscribe = transport.subscribeSnapshots(jest.fn())
    disconnect()

    unsubscribe()
    jest.advanceTimersByTime(1000)

    expect(connector.connect).toHaveBeenCalledTimes(1)
  })
})
