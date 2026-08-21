import type { SurfaceId, SurfaceKind, SurfaceUnmount } from './types'

/**
 * Minimal representation boundary managed by Platform Interface.
 *
 * A Surface owns presentation lifecycle only. It does not make domain decisions
 * and does not know how Platform Core stores or changes business state.
 */
export interface Surface {
  readonly id: SurfaceId
  readonly kind: SurfaceKind

  isMounted(): boolean
  mount(): SurfaceUnmount
}
