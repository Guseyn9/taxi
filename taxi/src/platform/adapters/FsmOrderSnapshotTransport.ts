import type { Unsubscribe } from '../interaction-contract'
import {
  DomainApiSnapshotProvider,
  ReconnectingSnapshotTransport,
} from '../platform-interface'
import type {
  DomainSnapshotTransport,
  PlatformSnapshotInput,
  ReconnectOptions,
  RealtimeSocket,
  RealtimeSocketFactory,
  SnapshotRealtimeConnector,
} from '../platform-interface'
import { BackendInteractionError } from './backendError'

export interface FsmOrderSnapshot {
  readonly orderId: number | string
  readonly availableActions?: readonly string[]
  readonly revision?: number
  readonly updatedAt?: string | null
  readonly [key: string]: unknown
}

export interface FsmOrderTransportConfig {
  readonly apiUrl: string
  readonly orderId: number | string
  readonly apiToken?: string
  readonly webSocketUrl?: string
  readonly webSocketTokenQueryParameter?: string
}

export interface FsmOrderTransportDependencies {
  readonly fetch?: typeof fetch
  readonly socketFactory?: RealtimeSocketFactory
  readonly reconnect?: ReconnectOptions
  readonly now?: () => string
}

interface FsmRealtimeMessage {
  readonly type?: string
  readonly snapshot?: FsmOrderSnapshot
}

const browserSocketFactory: RealtimeSocketFactory = url =>
  new WebSocket(url) as unknown as RealtimeSocket

export const FSM_ORDER_ENV = {
  ApiUrl: 'REACT_APP_FSM_API_URL',
  OrderId: 'REACT_APP_FSM_ORDER_ID',
  ApiToken: 'REACT_APP_FSM_API_TOKEN',
  WebSocketUrl: 'REACT_APP_FSM_WS_URL',
  WebSocketTokenQueryParameter: 'REACT_APP_FSM_WS_TOKEN_QUERY_PARAM',
} as const

/** Query + realtime adapter for the existing taxi/order Domain API. */
export class FsmOrderSnapshotTransport implements DomainSnapshotTransport {
  private readonly config: FsmOrderTransportConfig
  private readonly fetchRequest: typeof fetch
  private readonly socketFactory: RealtimeSocketFactory
  private readonly now: () => string
  private readonly transport: ReconnectingSnapshotTransport
  private revision = 0

  constructor(
    config: FsmOrderTransportConfig,
    dependencies: FsmOrderTransportDependencies = {},
  ) {
    this.config = normalizeConfig(config)
    this.fetchRequest = dependencies.fetch ?? fetch.bind(globalThis)
    this.socketFactory = dependencies.socketFactory ?? browserSocketFactory
    this.now = dependencies.now ?? (() => new Date().toISOString())

    const connector: SnapshotRealtimeConnector = {
      connect: (onSnapshot, onDisconnect) =>
        this.connectRealtime(onSnapshot, onDisconnect),
    }
    this.transport = new ReconnectingSnapshotTransport(
      () => this.loadFromQuery(),
      connector,
      dependencies.reconnect,
    )
  }

  loadSnapshot(): Promise<PlatformSnapshotInput> {
    return this.transport.loadSnapshot()
  }

  subscribeSnapshots(listener: (snapshot: PlatformSnapshotInput) => void): Unsubscribe {
    return this.transport.subscribeSnapshots(listener)
  }

  private async loadFromQuery(): Promise<PlatformSnapshotInput> {
    const response = await this.fetchRequest(this.queryUrl(), {
      method: 'GET',
      headers: this.httpHeaders(),
    })
    if (!response.ok) {
      const details = await readResponseDetails(response)
      throw new BackendInteractionError(
        `FSM_QUERY_HTTP_${response.status}`,
        getServerErrorMessage(details, `FSM Query failed with HTTP ${response.status}`),
        details,
      )
    }

    return this.mapSnapshot(await response.json() as FsmOrderSnapshot)
  }

  private connectRealtime(
    onSnapshot: (snapshot: PlatformSnapshotInput) => void,
    onDisconnect: (error?: unknown) => void,
  ): Unsubscribe {
    let socket: RealtimeSocket
    let stopped = false
    let disconnectReported = false

    const reportDisconnect = (error?: unknown) => {
      if (stopped || disconnectReported)
        return
      disconnectReported = true
      onDisconnect(error)
    }

    try {
      socket = this.socketFactory(this.realtimeUrl())
    } catch (error) {
      reportDisconnect(error)
      return () => undefined
    }

    socket.onmessage = event => {
      try {
        const message = parseRealtimeMessage(event.data)
        if (message.type === 'ping')
          return
        if (
          (message.type === 'snapshot' || message.type === 'entity.updated') &&
          message.snapshot
        ) {
          onSnapshot(this.mapSnapshot(message.snapshot))
          return
        }
        throw new BackendInteractionError(
          'FSM_REALTIME_PROTOCOL_ERROR',
          `Unsupported FSM realtime message: ${String(message.type || 'unknown')}`,
          message,
        )
      } catch (error) {
        reportDisconnect(error)
      }
    }
    socket.onerror = error => reportDisconnect(error)
    socket.onclose = event => reportDisconnect(event)

    return () => {
      if (stopped)
        return
      stopped = true
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.onopen = null
      socket.close()
    }
  }

  private mapSnapshot(snapshot: FsmOrderSnapshot): PlatformSnapshotInput {
    this.revision = Math.max(
      this.revision + 1,
      Number.isFinite(snapshot.revision) ? Number(snapshot.revision) : 0,
    )
    return {
      revision: this.revision,
      state: {
        domainOrder: {
          service: 'taxi',
          entityType: 'order',
          entityId: snapshot.orderId,
          snapshot,
        },
      },
      availableActions: snapshot.availableActions ?? [],
      updatedAt: snapshot.updatedAt ?? this.now(),
    }
  }

  private queryUrl(): string {
    const entityId = encodeURIComponent(this.config.orderId)
    return `${trimTrailingSlash(this.config.apiUrl)}/api/realtime/snapshot/taxi/order/${entityId}`
  }

  private realtimeUrl(): string {
    const baseUrl = trimTrailingSlash(
      this.config.webSocketUrl ?? toWebSocketUrl(this.config.apiUrl),
    )
    const url = new URL(
      `${baseUrl}/api/realtime/ws/taxi/order/${encodeURIComponent(this.config.orderId)}`,
    )
    if (this.config.apiToken && this.config.webSocketTokenQueryParameter)
      url.searchParams.set(this.config.webSocketTokenQueryParameter, this.config.apiToken)
    return url.toString()
  }

  private httpHeaders(): HeadersInit {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.config.apiToken)
      headers.Authorization = `Bearer ${this.config.apiToken}`
    return headers
  }
}

export function createConfiguredFsmOrderSnapshotProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const apiUrl = env[FSM_ORDER_ENV.ApiUrl]?.trim()
  const orderId = env[FSM_ORDER_ENV.OrderId]?.trim()
  if (!apiUrl || !orderId)
    return null

  return new DomainApiSnapshotProvider(new FsmOrderSnapshotTransport({
    apiUrl,
    orderId,
    apiToken: env[FSM_ORDER_ENV.ApiToken]?.trim() || undefined,
    webSocketUrl: env[FSM_ORDER_ENV.WebSocketUrl]?.trim() || undefined,
    webSocketTokenQueryParameter:
      env[FSM_ORDER_ENV.WebSocketTokenQueryParameter]?.trim() || undefined,
  }))
}

function normalizeConfig(config: FsmOrderTransportConfig): FsmOrderTransportConfig {
  const apiUrl = config.apiUrl.trim()
  const orderId = String(config.orderId).trim()
  if (!apiUrl)
    throw new Error('FSM API URL is required')
  if (!orderId)
    throw new Error('FSM orderId is required')
  return { ...config, apiUrl, orderId }
}

function parseRealtimeMessage(data: unknown): FsmRealtimeMessage {
  if (typeof data === 'string')
    return JSON.parse(data) as FsmRealtimeMessage
  if (data && typeof data === 'object')
    return data as FsmRealtimeMessage
  throw new BackendInteractionError(
    'FSM_REALTIME_PROTOCOL_ERROR',
    'FSM realtime message must be JSON',
    data,
  )
}

async function readResponseDetails(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    try {
      return await response.text()
    } catch {
      return null
    }
  }
}

function getServerErrorMessage(details: unknown, fallback: string): string {
  if (details && typeof details === 'object' && 'detail' in details)
    return String((details as { readonly detail?: unknown }).detail || fallback)
  return fallback
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function toWebSocketUrl(value: string): string {
  const url = new URL(value)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
