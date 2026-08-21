import type { Revision } from '../interaction-contract'

export type AvailableAction = string

/** Read-only domain view consumed by Platform Interface surfaces. */
export interface PlatformSnapshot {
  readonly revision: Revision
  readonly state: Readonly<Record<string, unknown>>
  readonly availableActions: readonly AvailableAction[]
  readonly updatedAt: string | null
}

export interface PlatformSnapshotInput {
  readonly revision: Revision
  readonly state?: Readonly<Record<string, unknown>>
  readonly availableActions?: readonly AvailableAction[]
  readonly updatedAt?: string | null
}

/**
 * Creates an immutable boundary object. This prevents accidental mutation by a
 * Surface; it is not a security sandbox for nested domain values.
 */
export function createPlatformSnapshot(input: PlatformSnapshotInput): PlatformSnapshot {
  return Object.freeze({
    revision: input.revision,
    state: Object.freeze({ ...(input.state ?? {}) }),
    availableActions: Object.freeze([...(input.availableActions ?? [])]),
    updatedAt: input.updatedAt ?? null,
  })
}

export const EMPTY_PLATFORM_SNAPSHOT = createPlatformSnapshot({
  revision: 0,
  state: {},
  availableActions: [],
  updatedAt: null,
})
