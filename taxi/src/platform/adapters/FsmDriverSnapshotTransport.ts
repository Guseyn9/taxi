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
import {
  EBookingDriverState,
  EBookingStates,
  IOrder,
  IUser,
} from '../../types/types'
import { BackendInteractionError } from './backendError'

export interface FsmDriverOrderCard {
  readonly orderId: number | string
  readonly coreOrderId?: number | string | null
  readonly state: string
  readonly mode?: string | null
  readonly bState?: number | null
  readonly description?: string | null
  readonly price?: unknown
  readonly availableActions?: readonly string[]
}

export interface FsmDriverSnapshot {
  readonly driverUserId: number | string
  readonly driver: {
    readonly user?: Readonly<Record<string, unknown>> | null
    readonly readyOrders?: readonly FsmDriverOrderCard[]
    readonly activeOrders?: readonly FsmDriverOrderCard[]
    readonly historyOrders?: readonly FsmDriverOrderCard[]
    readonly currentTrip?: FsmDriverOrderCard | null
  }
  readonly availableActions?: readonly string[]
  readonly revision?: number
  readonly updatedAt?: string | null
}

export interface FsmDriverTransportConfig {
  readonly apiUrl: string
  readonly driverUserId: number | string
  readonly apiToken?: string
  readonly webSocketUrl?: string
  readonly webSocketTokenQueryParameter?: string
  readonly recoveryPollIntervalMs?: number
}

export interface FsmDriverTransportDependencies {
  readonly fetch?: typeof fetch
  readonly socketFactory?: RealtimeSocketFactory
  readonly reconnect?: ReconnectOptions
  readonly now?: () => string
}

interface FsmRealtimeMessage {
  readonly type?: string
  readonly snapshot?: FsmDriverSnapshot
}

interface QuerySnapshotContext {
  readonly sequence: number
  readonly realtimeEpoch: number
}

export const FSM_DRIVER_ENV = {
  ApiUrl: 'REACT_APP_FSM_API_URL',
  DriverUserId: 'REACT_APP_FSM_DRIVER_USER_ID',
  ApiToken: 'REACT_APP_FSM_API_TOKEN',
  WebSocketUrl: 'REACT_APP_FSM_WS_URL',
  WebSocketTokenQueryParameter: 'REACT_APP_FSM_WS_TOKEN_QUERY_PARAM',
  RecoveryPollIntervalMs: 'REACT_APP_FSM_DRIVER_POLL_MS',
} as const

const browserSocketFactory: RealtimeSocketFactory = url =>
  new WebSocket(url) as unknown as RealtimeSocket

/** Driver aggregate Query/WS adapter with temporary Query recovery polling. */
export class FsmDriverSnapshotTransport implements DomainSnapshotTransport {
  private readonly config: FsmDriverTransportConfig
  private readonly fetchRequest: typeof fetch
  private readonly socketFactory: RealtimeSocketFactory
  private readonly now: () => string
  private readonly realtimeTransport: ReconnectingSnapshotTransport
  private localRevision = 0
  private realtimeEpoch = 0
  private querySequence = 0
  private lastAcceptedQuerySequence = 0
  private lastServerRevision: number | null = null
  private lastServerUpdatedAt: number | null = null
  private latestSnapshot: PlatformSnapshotInput | null = null

  constructor(
    config: FsmDriverTransportConfig,
    dependencies: FsmDriverTransportDependencies = {},
  ) {
    this.config = normalizeConfig(config)
    this.fetchRequest = dependencies.fetch ?? fetch.bind(globalThis)
    this.socketFactory = dependencies.socketFactory ?? browserSocketFactory
    this.now = dependencies.now ?? (() => new Date().toISOString())
    const connector: SnapshotRealtimeConnector = {
      connect: (onSnapshot, onDisconnect) =>
        this.connectRealtime(onSnapshot, onDisconnect),
    }
    this.realtimeTransport = new ReconnectingSnapshotTransport(
      () => this.loadFromQuery(),
      connector,
      dependencies.reconnect,
    )
  }

  loadSnapshot(): Promise<PlatformSnapshotInput> {
    return this.loadFromQuery()
  }

  subscribeSnapshots(listener: (snapshot: PlatformSnapshotInput) => void): Unsubscribe {
    const stopRealtime = this.realtimeTransport.subscribeSnapshots(listener)
    const pollIntervalMs = this.config.recoveryPollIntervalMs ?? 5000
    let pollTimer: ReturnType<typeof setInterval> | null = null
    if (pollIntervalMs > 0) {
      pollTimer = setInterval(() => {
        void this.loadPollingSnapshot().then(snapshot => {
          if (snapshot)
            listener(snapshot)
        }).catch(() => undefined)
      }, pollIntervalMs)
    }

    return () => {
      stopRealtime()
      if (pollTimer)
        clearInterval(pollTimer)
    }
  }

  private async loadFromQuery(): Promise<PlatformSnapshotInput> {
    const query = this.beginQuery()
    const snapshot = await this.fetchSnapshot()
    const accepted = this.acceptSnapshot(snapshot, query)
    if (accepted)
      return accepted
    if (this.latestSnapshot)
      return this.latestSnapshot
    throw new BackendInteractionError(
      'FSM_DRIVER_STALE_SNAPSHOT',
      'FSM Driver Query returned a stale snapshot',
      snapshot,
    )
  }

  private async loadPollingSnapshot(): Promise<PlatformSnapshotInput | null> {
    const query = this.beginQuery()
    return this.acceptSnapshot(await this.fetchSnapshot(), query)
  }

  private beginQuery(): QuerySnapshotContext {
    return {
      sequence: ++this.querySequence,
      realtimeEpoch: this.realtimeEpoch,
    }
  }

  private async fetchSnapshot(): Promise<FsmDriverSnapshot> {
    const response = await this.fetchRequest(this.queryUrl(), {
      method: 'GET',
      headers: this.httpHeaders(),
    })
    if (!response.ok) {
      const details = await readResponseDetails(response)
      throw new BackendInteractionError(
        `FSM_DRIVER_QUERY_HTTP_${response.status}`,
        getServerErrorMessage(details, `FSM Driver Query failed with HTTP ${response.status}`),
        details,
      )
    }

    return await response.json() as FsmDriverSnapshot
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
          const snapshot = this.acceptSnapshot(message.snapshot)
          if (snapshot) {
            this.realtimeEpoch += 1
            onSnapshot(snapshot)
          }
          return
        }
        throw new BackendInteractionError(
          'FSM_DRIVER_REALTIME_PROTOCOL_ERROR',
          `Unsupported FSM Driver realtime message: ${String(message.type || 'unknown')}`,
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

  private acceptSnapshot(
    snapshot: FsmDriverSnapshot,
    query?: QuerySnapshotContext,
  ): PlatformSnapshotInput | null {
    const serverRevision = getServerRevision(snapshot)
    const serverUpdatedAt = getServerUpdatedAt(snapshot)

    if (query && query.realtimeEpoch !== this.realtimeEpoch)
      return null
    if (query && query.sequence < this.lastAcceptedQuerySequence)
      return null
    if (
      serverRevision !== null &&
      this.lastServerRevision !== null &&
      serverRevision <= this.lastServerRevision
    )
      return null
    if (
      serverRevision === null &&
      serverUpdatedAt !== null &&
      this.lastServerUpdatedAt !== null &&
      serverUpdatedAt < this.lastServerUpdatedAt
    )
      return null

    if (query)
      this.lastAcceptedQuerySequence = query.sequence
    if (serverRevision !== null)
      this.lastServerRevision = serverRevision
    if (serverUpdatedAt !== null)
      this.lastServerUpdatedAt = serverUpdatedAt

    this.localRevision = Math.max(
      this.localRevision + 1,
      serverRevision ?? 0,
    )
    const mapped = this.mapSnapshot(snapshot, this.localRevision)
    this.latestSnapshot = mapped
    return mapped
  }

  private mapSnapshot(
    snapshot: FsmDriverSnapshot,
    revision: number,
  ): PlatformSnapshotInput {
    const driverUserId = String(snapshot.driverUserId || this.config.driverUserId)
    const readyOrders = mapOrderCards(snapshot.driver.readyOrders, driverUserId)
    const activeOrders = mapOrderCards(snapshot.driver.activeOrders, driverUserId)
    const historyOrders = mapOrderCards(snapshot.driver.historyOrders, driverUserId)

    return {
      revision,
      state: {
        source: 'fsm-driver-api',
        driver: {
          user: mapDriverUser(snapshot.driver.user),
          readyOrders,
          activeOrders,
          historyOrders,
          currentTrip: snapshot.driver.currentTrip ?
            mapOrderCard(snapshot.driver.currentTrip, driverUserId) :
            null,
        },
        domainDriver: {
          service: 'taxi',
          entityType: 'driver',
          entityId: driverUserId,
          snapshot,
        },
      },
      availableActions: snapshot.availableActions ?? [],
      updatedAt: snapshot.updatedAt ?? this.now(),
    }
  }

  private queryUrl(): string {
    const driverUserId = encodeURIComponent(String(this.config.driverUserId))
    return `${trimTrailingSlash(this.config.apiUrl)}/api/realtime/snapshot/taxi/driver/${driverUserId}`
  }

  private realtimeUrl(): string {
    const baseUrl = trimTrailingSlash(
      this.config.webSocketUrl ?? toWebSocketUrl(this.config.apiUrl),
    )
    const url = new URL(
      `${baseUrl}/api/realtime/ws/taxi/driver/${encodeURIComponent(String(this.config.driverUserId))}`,
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

export function createConfiguredFsmDriverSnapshotProvider(
  driverUserId?: number | string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const apiUrl = env[FSM_DRIVER_ENV.ApiUrl]?.trim()
  const resolvedDriverUserId = env[FSM_DRIVER_ENV.DriverUserId]?.trim() ||
    String(driverUserId ?? '').trim()
  if (!apiUrl || !resolvedDriverUserId)
    return null

  return new DomainApiSnapshotProvider(new FsmDriverSnapshotTransport({
    apiUrl,
    driverUserId: resolvedDriverUserId,
    apiToken: env[FSM_DRIVER_ENV.ApiToken]?.trim() || undefined,
    webSocketUrl: env[FSM_DRIVER_ENV.WebSocketUrl]?.trim() || undefined,
    webSocketTokenQueryParameter:
      env[FSM_DRIVER_ENV.WebSocketTokenQueryParameter]?.trim() || undefined,
    recoveryPollIntervalMs: parsePollInterval(
      env[FSM_DRIVER_ENV.RecoveryPollIntervalMs],
    ),
  }))
}

function mapOrderCards(
  cards: readonly FsmDriverOrderCard[] | undefined,
  driverUserId: string,
): readonly IOrder[] {
  return (cards ?? []).map(card => mapOrderCard(card, driverUserId))
}

function mapOrderCard(card: FsmDriverOrderCard, driverUserId: string): IOrder {
  const price = getNumericPrice(card.price)
  return {
    b_id: String(card.orderId),
    b_state: mapBookingState(card),
    b_cars_count: card.mode === 'OFFER' ? 0 : 1,
    b_options: {
      fsmState: card.state,
      fsmMode: card.mode,
      fsmCoreOrderId: card.coreOrderId,
      fsmAvailableActions: card.availableActions ?? [],
      fsmOrderCard: card,
    } as any,
    b_custom_comment: card.description ?? undefined,
    b_price_estimate: price,
    b_voting: card.mode === 'VOTE',
    drivers: [{
      u_id: driverUserId,
      c_state: mapDriverState(card.state),
    } as any],
  } as IOrder
}

function mapDriverUser(
  user: Readonly<Record<string, unknown>> | null | undefined,
): IUser | null {
  if (!user)
    return null
  const userId = user.u_id ?? user.userId
  return {
    ...user,
    ...(userId === undefined || userId === null ? {} : { u_id: String(userId) }),
  } as unknown as IUser
}

function mapBookingState(card: FsmDriverOrderCard): EBookingStates {
  if (typeof card.bState === 'number')
    return card.bState as EBookingStates
  if (card.state === 'order_completed')
    return EBookingStates.Completed
  if ([
    'order_cancelled',
    'order_expired',
    'order_vote_no_show',
    'ride_interrupted',
  ].includes(card.state))
    return EBookingStates.Canceled
  if ([
    'order_vote_waiting_candidates',
    'order_offer_waiting',
  ].includes(card.state))
    return EBookingStates.OfferedToDrivers
  if (card.state === 'order_created')
    return EBookingStates.PendingActivation
  return EBookingStates.Approved
}

function mapDriverState(state: string): EBookingDriverState {
  switch (state) {
    case 'order_vote_waiting_candidates':
    case 'order_offer_waiting':
      return EBookingDriverState.Considering
    case 'order_driver_arrived':
      return EBookingDriverState.Arrived
    case 'order_in_ride':
      return EBookingDriverState.Started
    case 'order_completed':
      return EBookingDriverState.Finished
    case 'order_cancelled':
    case 'order_expired':
    case 'order_vote_no_show':
    case 'ride_interrupted':
      return EBookingDriverState.Canceled
    default:
      return EBookingDriverState.Performer
  }
}

function getNumericPrice(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (value && typeof value === 'object') {
    const price = value as { actual?: unknown, value?: unknown, estimated?: unknown }
    for (const candidate of [price.actual, price.value, price.estimated]) {
      const number = Number(candidate)
      if (Number.isFinite(number))
        return number
    }
  }
  return undefined
}

function normalizeConfig(config: FsmDriverTransportConfig): FsmDriverTransportConfig {
  const apiUrl = config.apiUrl.trim()
  const driverUserId = String(config.driverUserId).trim()
  if (!apiUrl)
    throw new Error('FSM API URL is required')
  if (!driverUserId)
    throw new Error('FSM driverUserId is required')
  return { ...config, apiUrl, driverUserId }
}

function parseRealtimeMessage(data: unknown): FsmRealtimeMessage {
  if (typeof data === 'string')
    return JSON.parse(data) as FsmRealtimeMessage
  if (data && typeof data === 'object')
    return data as FsmRealtimeMessage
  throw new BackendInteractionError(
    'FSM_DRIVER_REALTIME_PROTOCOL_ERROR',
    'FSM Driver realtime message must be JSON',
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
  if (typeof details === 'string' && details.trim())
    return details
  if (details && typeof details === 'object') {
    const value = details as { detail?: unknown, message?: unknown }
    if (typeof value.detail === 'string' && value.detail.trim())
      return value.detail
    if (typeof value.message === 'string' && value.message.trim())
      return value.message
  }
  return fallback
}

function parsePollInterval(value: string | undefined): number | undefined {
  if (!value)
    return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined
}

function getServerRevision(snapshot: FsmDriverSnapshot): number | null {
  if (typeof snapshot.revision === 'number' && Number.isFinite(snapshot.revision))
    return snapshot.revision
  return null
}

function getServerUpdatedAt(snapshot: FsmDriverSnapshot): number | null {
  if (!snapshot.updatedAt)
    return null
  const updatedAt = Date.parse(snapshot.updatedAt)
  return Number.isFinite(updatedAt) ? updatedAt : null
}

function toWebSocketUrl(value: string): string {
  const url = new URL(value)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
