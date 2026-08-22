import type { Unsubscribe } from '../../interaction-contract'

const OPEN_SOCKET_STATE = 1

export interface RealtimeSocket {
  readonly readyState: number
  onopen: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
  onmessage: ((event: { readonly data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  send(data: string): void
  close(): void
}

export type RealtimeSocketFactory = (url: string) => RealtimeSocket

export interface RealtimeConnectionHandlers {
  readonly onOpen?: () => void
  readonly onMessage: (data: unknown) => void
  readonly onError?: (error: unknown) => void
}

export interface ReconnectingWebSocketOptions {
  readonly initialDelayMs?: number
  readonly maxDelayMs?: number
}

const browserSocketFactory: RealtimeSocketFactory = url =>
  new WebSocket(url) as unknown as RealtimeSocket

/** Transport-only WebSocket lifecycle with bounded exponential reconnect. */
export class ReconnectingWebSocketClient {
  private readonly socketFactory: RealtimeSocketFactory
  private readonly initialDelayMs: number
  private readonly maxDelayMs: number
  private socket: RealtimeSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectionRevision = 0
  private attempt = 0

  constructor(
    socketFactory: RealtimeSocketFactory = browserSocketFactory,
    options: ReconnectingWebSocketOptions = {},
  ) {
    this.socketFactory = socketFactory
    this.initialDelayMs = Math.max(0, options.initialDelayMs ?? 1000)
    this.maxDelayMs = Math.max(this.initialDelayMs, options.maxDelayMs ?? 30000)
  }

  connect(url: string, handlers: RealtimeConnectionHandlers): Unsubscribe {
    this.disconnect()
    const revision = ++this.connectionRevision
    this.attempt = 0

    const open = () => {
      if (revision !== this.connectionRevision)
        return

      this.reconnectTimer = null
      let socket: RealtimeSocket
      try {
        socket = this.socketFactory(url)
      } catch (error) {
        handlers.onError?.(error)
        scheduleReconnect()
        return
      }

      this.socket = socket
      socket.onopen = () => {
        if (this.socket !== socket || revision !== this.connectionRevision)
          return
        this.attempt = 0
        handlers.onOpen?.()
      }
      socket.onmessage = event => {
        if (this.socket === socket && revision === this.connectionRevision)
          handlers.onMessage(event.data)
      }
      socket.onerror = error => {
        if (this.socket !== socket || revision !== this.connectionRevision)
          return
        handlers.onError?.(error)
        this.detachSocket(socket, true)
        scheduleReconnect()
      }
      socket.onclose = () => {
        if (this.socket !== socket || revision !== this.connectionRevision)
          return
        this.detachSocket(socket)
        scheduleReconnect()
      }
    }

    const scheduleReconnect = () => {
      if (revision !== this.connectionRevision || this.reconnectTimer)
        return
      const delay = Math.min(this.maxDelayMs, this.initialDelayMs * (2 ** this.attempt))
      this.attempt += 1
      this.reconnectTimer = setTimeout(open, delay)
    }

    open()

    return () => {
      if (revision === this.connectionRevision)
        this.disconnect()
    }
  }

  send(data: string): boolean {
    if (!this.socket || this.socket.readyState !== OPEN_SOCKET_STATE)
      return false
    this.socket.send(data)
    return true
  }

  disconnect(): void {
    this.connectionRevision += 1
    if (this.reconnectTimer)
      clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.socket)
      this.detachSocket(this.socket, true)
  }

  private detachSocket(socket: RealtimeSocket, close = false): void {
    socket.onopen = null
    socket.onclose = null
    socket.onmessage = null
    socket.onerror = null
    if (this.socket === socket)
      this.socket = null
    if (close)
      socket.close()
  }
}
