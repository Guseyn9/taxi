import type {
  InteractionAction,
  InteractionContract,
  InteractionEvent,
  InteractionSnapshot,
  Unsubscribe,
} from '../interaction-contract'
import type { SurfaceRegistry } from './SurfaceRegistry'
import type { SurfaceId, SurfaceUnmount } from './types'
import type {
  PlatformSnapshotProvider,
} from './SnapshotProvider'
import type { PlatformSnapshot } from './snapshot'

export const RUNTIME_STATUSES = {
  Idle: 'idle',
  Loading: 'loading',
  Ready: 'ready',
  Error: 'error',
  Stopped: 'stopped',
} as const

export type RuntimeStatus = typeof RUNTIME_STATUSES[keyof typeof RUNTIME_STATUSES]

export interface PlatformRuntimeState {
  readonly status: RuntimeStatus
  readonly snapshot: PlatformSnapshot | null
  readonly error: Error | null
}

export type PlatformRuntimeListener = (state: PlatformRuntimeState) => void

export type PlatformActionHandler = (action: InteractionAction) => Promise<void> | void

export interface PlatformApplicationContract extends InteractionContract {
  publish(event: InteractionEvent): void
  registerHandler(handler: PlatformActionHandler): Unsubscribe
}

export interface PlatformRuntimeLogger {
  log(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

const consolePlatformRuntimeLogger: PlatformRuntimeLogger = {
  log(message: string, ...args: unknown[]): void {
    console.log(`[PlatformInterface] ${message}`, ...args)
  },
  error(message: string, ...args: unknown[]): void {
    console.error(`[PlatformInterface] ${message}`, ...args)
  },
}

function createRuntimeState(
  status: RuntimeStatus,
  snapshot: PlatformSnapshot | null,
  error: Error | null,
): PlatformRuntimeState {
  return Object.freeze({ status, snapshot, error })
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Universal PI Runtime. It owns Surface lifecycle and snapshot delivery while
 * delegating business decisions to Domain FSM and Action handlers.
 */
export class PlatformInterfaceRuntime implements PlatformApplicationContract {
  private readonly applicationContract: PlatformApplicationContract
  private readonly snapshotProvider: PlatformSnapshotProvider
  private readonly surfaceRegistry: SurfaceRegistry
  private readonly logger: PlatformRuntimeLogger
  private readonly listeners: PlatformRuntimeListener[] = []

  private state = createRuntimeState(RUNTIME_STATUSES.Idle, null, null)
  private providerUnsubscribe: Unsubscribe | null = null
  private activeSurfaceCount = 0
  private requestRevision = 0
  private started = false
  private startPromise: Promise<PlatformRuntimeState> | null = null

  constructor(
    applicationContract: PlatformApplicationContract,
    snapshotProvider: PlatformSnapshotProvider,
    surfaceRegistry: SurfaceRegistry,
    logger: PlatformRuntimeLogger = consolePlatformRuntimeLogger,
  ) {
    this.applicationContract = applicationContract
    this.snapshotProvider = snapshotProvider
    this.surfaceRegistry = surfaceRegistry
    this.logger = logger
  }

  getState(): PlatformRuntimeState {
    return this.state
  }

  getSnapshot(): PlatformSnapshot | null {
    return this.state.snapshot
  }

  isActionAvailable(action: string): boolean {
    return this.state.snapshot?.availableActions.includes(action) ?? false
  }

  subscribeRuntime(listener: PlatformRuntimeListener): Unsubscribe {
    this.listeners.push(listener)
    let unsubscribed = false
    return () => {
      if (unsubscribed)
        return
      unsubscribed = true
      const index = this.listeners.indexOf(listener)
      if (index !== -1)
        this.listeners.splice(index, 1)
    }
  }

  async start(): Promise<PlatformRuntimeState> {
    if (this.started)
      return this.startPromise ?? this.state

    this.started = true
    if (this.snapshotProvider.subscribe) {
      this.providerUnsubscribe = this.snapshotProvider.subscribe(snapshot => {
        if (this.started) {
          // A pushed snapshot is newer than an in-flight polling response.
          this.requestRevision += 1
          this.applySnapshot(snapshot)
        }
      })
    }

    const startPromise = this.refresh()
    this.startPromise = startPromise
    void startPromise.finally(() => {
      if (this.startPromise === startPromise)
        this.startPromise = null
    })
    return startPromise
  }

  stop(): void {
    if (this.providerUnsubscribe)
      this.providerUnsubscribe()
    this.providerUnsubscribe = null
    this.started = false
    this.startPromise = null
    this.requestRevision += 1
    this.setState(RUNTIME_STATUSES.Stopped, this.state.snapshot, null)
  }

  async refresh(): Promise<PlatformRuntimeState> {
    const requestRevision = ++this.requestRevision
    this.setState(RUNTIME_STATUSES.Loading, this.state.snapshot, null)

    try {
      const snapshot = await this.snapshotProvider.load()
      if (requestRevision === this.requestRevision)
        this.applySnapshot(snapshot)
    } catch (error) {
      if (requestRevision === this.requestRevision) {
        const runtimeError = toError(error)
        this.logger.error('Platform Interface snapshot refresh failed', runtimeError)
        this.setState(RUNTIME_STATUSES.Error, this.state.snapshot, runtimeError)
      }
    }

    return this.state
  }

  mountSurface(surfaceId: SurfaceId): SurfaceUnmount {
    const surface = this.surfaceRegistry.require(surfaceId)
    const unmountSurface = surface.mount()
    this.activeSurfaceCount += 1

    if (this.activeSurfaceCount === 1)
      void this.start()

    let unmounted = false
    return () => {
      if (unmounted)
        return
      unmounted = true
      unmountSurface()
      this.activeSurfaceCount = Math.max(0, this.activeSurfaceCount - 1)
      if (this.activeSurfaceCount === 0)
        this.stop()
    }
  }

  async dispatch<TPayload>(action: InteractionAction<TPayload>): Promise<void> {
    await this.applicationContract.dispatch(action)
    if (this.started)
      await this.refresh()
  }

  subscribe(listener: (event: InteractionEvent) => void): Unsubscribe {
    return this.applicationContract.subscribe(listener)
  }

  publish(event: InteractionEvent): void {
    this.applicationContract.publish(event)
  }

  registerHandler(handler: PlatformActionHandler): Unsubscribe {
    return this.applicationContract.registerHandler(handler)
  }

  async snapshot(): Promise<InteractionSnapshot> {
    if (!this.state.snapshot)
      await this.refresh()

    const snapshot = this.state.snapshot
    return Object.freeze({
      revision: snapshot?.revision ?? 0,
      state: Object.freeze({
        ...(snapshot?.state ?? {}),
        availableActions: snapshot?.availableActions ?? [],
      }),
    })
  }

  private applySnapshot(snapshot: PlatformSnapshot): void {
    this.setState(RUNTIME_STATUSES.Ready, snapshot, null)
  }

  private setState(
    status: RuntimeStatus,
    snapshot: PlatformSnapshot | null,
    error: Error | null,
  ): void {
    this.state = createRuntimeState(status, snapshot, error)
    this.listeners.slice().forEach(listener => {
      try {
        listener(this.state)
      } catch (error) {
        this.logger.error('Platform Interface runtime listener failed', error)
      }
    })
  }
}
