import type { Unsubscribe } from '../../interaction-contract'
import type {
  PlatformRuntimeState,
  PlatformInterfaceRuntime,
} from '../PlatformInterfaceRuntime'
import type { Surface } from '../Surface'
import type { SurfaceId, SurfaceKind, SurfaceUnmount } from '../types'
import type { PlatformSnapshot } from '../snapshot'

/** Surface that observes Runtime snapshots without owning business decisions. */
export class SnapshotSurface implements Surface {
  readonly id: SurfaceId
  readonly kind: SurfaceKind

  private readonly runtime: PlatformInterfaceRuntime
  private mountCount = 0
  private runtimeUnsubscribe: Unsubscribe | null = null
  private state: PlatformRuntimeState

  constructor(id: SurfaceId, kind: SurfaceKind, runtime: PlatformInterfaceRuntime) {
    this.id = id
    this.kind = kind
    this.runtime = runtime
    this.state = runtime.getState()
  }

  isMounted(): boolean {
    return this.mountCount > 0
  }

  getRuntimeState(): PlatformRuntimeState {
    return this.state
  }

  getSnapshot(): PlatformSnapshot | null {
    return this.state.snapshot
  }

  getAvailableActions(): readonly string[] {
    return this.state.snapshot?.availableActions ?? []
  }

  selectState<TResult>(selector: (state: Readonly<Record<string, unknown>>) => TResult): TResult | null {
    const snapshot = this.state.snapshot
    return snapshot ? selector(snapshot.state) : null
  }

  mount(): SurfaceUnmount {
    this.mountCount += 1
    if (this.mountCount === 1) {
      this.state = this.runtime.getState()
      this.runtimeUnsubscribe = this.runtime.subscribeRuntime(state => {
        this.state = state
      })
    }

    let unmounted = false
    return () => {
      if (unmounted)
        return
      unmounted = true
      this.mountCount = Math.max(0, this.mountCount - 1)
      if (this.mountCount === 0 && this.runtimeUnsubscribe) {
        this.runtimeUnsubscribe()
        this.runtimeUnsubscribe = null
      }
    }
  }
}
