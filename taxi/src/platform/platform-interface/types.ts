/** Stable identifiers used by the Platform Interface surface registry. */
export type SurfaceId = string

/** Surface kinds defined by docs/SURFACE_MODEL.md. */
export const SURFACE_KINDS = {
  Map: 'map',
  Hud: 'hud',
  List: 'list',
  Simple: 'simple',
  Chat: 'chat',
} as const

export type SurfaceKind = typeof SURFACE_KINDS[keyof typeof SURFACE_KINDS]

/** Idempotent lifecycle cleanup returned when a surface is mounted. */
export type SurfaceUnmount = () => void
