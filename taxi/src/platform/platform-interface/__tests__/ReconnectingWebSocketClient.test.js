import { ReconnectingWebSocketClient } from '../realtime/ReconnectingWebSocketClient'

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

describe('ReconnectingWebSocketClient', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('delivers messages, reconnects after close and resends the open handshake', () => {
    const sockets = []
    const factory = jest.fn(() => {
      const socket = createSocket()
      sockets.push(socket)
      return socket
    })
    const onOpen = jest.fn()
    const onMessage = jest.fn()
    const client = new ReconnectingWebSocketClient(factory, {
      initialDelayMs: 100,
      maxDelayMs: 400,
    })

    const stop = client.connect('wss://example.test', { onOpen, onMessage })
    sockets[0].readyState = 1
    sockets[0].onopen({})
    sockets[0].onmessage({ data: 'first' })

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith('first')
    expect(client.send('outgoing')).toBe(true)
    expect(sockets[0].send).toHaveBeenCalledWith('outgoing')

    sockets[0].onclose({})
    jest.advanceTimersByTime(99)
    expect(factory).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    expect(factory).toHaveBeenCalledTimes(2)

    sockets[1].readyState = 1
    sockets[1].onopen({})
    expect(onOpen).toHaveBeenCalledTimes(2)

    stop()
    expect(sockets[1].close).toHaveBeenCalledTimes(1)
  })

  it('does not reconnect after the connection is stopped', () => {
    const sockets = []
    const factory = jest.fn(() => {
      const socket = createSocket()
      sockets.push(socket)
      return socket
    })
    const client = new ReconnectingWebSocketClient(factory, { initialDelayMs: 50 })
    const stop = client.connect('wss://example.test', { onMessage: jest.fn() })

    sockets[0].onclose({})
    stop()
    jest.advanceTimersByTime(500)

    expect(factory).toHaveBeenCalledTimes(1)
  })
})
