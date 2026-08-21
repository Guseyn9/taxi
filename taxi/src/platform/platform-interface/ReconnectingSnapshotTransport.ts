import type { Unsubscribe } from '../interaction-contract'
import type {
  DomainSnapshotTransport,
} from './SnapshotProvider'
import type { PlatformSnapshotInput } from './snapshot'

export interface SnapshotRealtimeConnector {
  connect(
    onSnapshot: (snapshot: PlatformSnapshotInput) => void,
    onDisconnect: (error?: unknown) => void,
  ): Unsubscribe
}

export interface ReconnectOptions {
  readonly initialDelayMs?: number
  readonly maxDelayMs?: number
}

/** Query + realtime transport with deterministic exponential reconnect. */
export class ReconnectingSnapshotTransport implements DomainSnapshotTransport {
  private readonly loader: () => Promise<PlatformSnapshotInput>
  private readonly connector: SnapshotRealtimeConnector
  private readonly initialDelayMs: number
  private readonly maxDelayMs: number

  constructor(
    loader: () => Promise<PlatformSnapshotInput>,
    connector: SnapshotRealtimeConnector,
    options: ReconnectOptions = {},
  ) {
    this.loader = loader
    this.connector = connector
    this.initialDelayMs = Math.max(0, options.initialDelayMs ?? 1000)
    this.maxDelayMs = Math.max(this.initialDelayMs, options.maxDelayMs ?? 30000)
  }

  loadSnapshot(): Promise<PlatformSnapshotInput> {
    return this.loader()
  }

  subscribeSnapshots(listener: (snapshot: PlatformSnapshotInput) => void): Unsubscribe {
    let stopped = false
    let attempt = 0
    let connectionStop: Unsubscribe | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const clearConnection = () => {
      if (connectionStop)
        connectionStop()
      connectionStop = null
    }

    const connect = () => {
      if (stopped)
        return

      reconnectTimer = null
      clearConnection()
      try {
        connectionStop = this.connector.connect(
          snapshot => {
            attempt = 0
            listener(snapshot)
          },
          () => scheduleReconnect(),
        )
      } catch {
        scheduleReconnect()
      }
    }

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer)
        return

      clearConnection()
      const delay = Math.min(
        this.maxDelayMs,
        this.initialDelayMs * (2 ** attempt),
      )
      attempt += 1
      reconnectTimer = setTimeout(connect, delay)
    }

    connect()

    return () => {
      if (stopped)
        return
      stopped = true
      clearConnection()
      if (reconnectTimer)
        clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }
}
