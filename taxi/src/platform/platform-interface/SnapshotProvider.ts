import type { Unsubscribe } from '../interaction-contract'
import {
  createPlatformSnapshot,
  EMPTY_PLATFORM_SNAPSHOT,
} from './snapshot'
import type {
  PlatformSnapshot,
  PlatformSnapshotInput,
} from './snapshot'

export type PlatformSnapshotListener = (snapshot: PlatformSnapshot) => void

/** Storage/transport-neutral source of authoritative Domain FSM snapshots. */
export interface PlatformSnapshotProvider {
  load(): Promise<PlatformSnapshot>
  subscribe?(listener: PlatformSnapshotListener): Unsubscribe
}

/** Safe default until a Domain API transport is supplied by the application. */
export class EmptySnapshotProvider implements PlatformSnapshotProvider {
  load(): Promise<PlatformSnapshot> {
    return Promise.resolve(EMPTY_PLATFORM_SNAPSHOT)
  }
}

/** Hot-swappable boundary used when server configuration arrives after UI bootstrap. */
export class SwitchableSnapshotProvider implements PlatformSnapshotProvider {
  private provider: PlatformSnapshotProvider
  private readonly listeners: PlatformSnapshotListener[] = []
  private providerUnsubscribe: Unsubscribe | null = null
  private providerRevision = 0

  constructor(provider: PlatformSnapshotProvider = new EmptySnapshotProvider()) {
    this.provider = provider
  }

  load(): Promise<PlatformSnapshot> {
    return this.provider.load()
  }

  subscribe(listener: PlatformSnapshotListener): Unsubscribe {
    this.listeners.push(listener)
    if (this.listeners.length === 1)
      this.connectProvider()

    let unsubscribed = false
    return () => {
      if (unsubscribed)
        return
      unsubscribed = true
      const index = this.listeners.indexOf(listener)
      if (index !== -1)
        this.listeners.splice(index, 1)
      if (this.listeners.length === 0)
        this.disconnectProvider()
    }
  }

  async setProvider(provider: PlatformSnapshotProvider): Promise<PlatformSnapshot> {
    this.providerRevision += 1
    const revision = this.providerRevision
    this.disconnectProvider()
    this.provider = provider
    if (this.listeners.length > 0)
      this.connectProvider()

    const snapshot = await provider.load()
    if (revision === this.providerRevision)
      this.publish(snapshot)
    return snapshot
  }

  private connectProvider(): void {
    if (this.providerUnsubscribe || !this.provider.subscribe)
      return
    this.providerUnsubscribe = this.provider.subscribe(snapshot => this.publish(snapshot))
  }

  private disconnectProvider(): void {
    if (this.providerUnsubscribe)
      this.providerUnsubscribe()
    this.providerUnsubscribe = null
  }

  private publish(snapshot: PlatformSnapshot): void {
    this.listeners.slice().forEach(listener => listener(snapshot))
  }
}

export interface DomainSnapshotTransport {
  loadSnapshot(): Promise<PlatformSnapshotInput>
  subscribeSnapshots?(listener: (snapshot: PlatformSnapshotInput) => void): Unsubscribe
}

/**
 * Adapter boundary for the server Domain FSM API. HTTP, WebSocket or another
 * transport is injected by the application and remains outside PI Runtime.
 */
export class DomainApiSnapshotProvider implements PlatformSnapshotProvider {
  private readonly transport: DomainSnapshotTransport

  constructor(transport: DomainSnapshotTransport) {
    this.transport = transport
  }

  async load(): Promise<PlatformSnapshot> {
    return createPlatformSnapshot(await this.transport.loadSnapshot())
  }

  subscribe(listener: PlatformSnapshotListener): Unsubscribe {
    if (!this.transport.subscribeSnapshots)
      return () => undefined

    return this.transport.subscribeSnapshots(snapshot => {
      listener(createPlatformSnapshot(snapshot))
    })
  }
}
