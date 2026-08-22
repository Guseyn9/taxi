import type { Surface } from './Surface'
import type { SurfaceId, SurfaceUnmount } from './types'

/** Explicit registry of the surfaces available to a Platform Interface. */
export class SurfaceRegistry {
  private readonly surfaces = new Map<SurfaceId, Surface>()

  register(surface: Surface): SurfaceUnmount {
    if (this.surfaces.has(surface.id))
      throw new Error(`Surface already registered: ${surface.id}`)

    this.surfaces.set(surface.id, surface)
    let unregistered = false

    return () => {
      if (unregistered)
        return
      unregistered = true

      if (this.surfaces.get(surface.id) === surface)
        this.surfaces.delete(surface.id)
    }
  }

  has(id: SurfaceId): boolean {
    return this.surfaces.has(id)
  }

  get<TSurface extends Surface = Surface>(id: SurfaceId): TSurface | undefined {
    return this.surfaces.get(id) as TSurface | undefined
  }

  require<TSurface extends Surface = Surface>(id: SurfaceId): TSurface {
    const surface = this.get<TSurface>(id)
    if (!surface)
      throw new Error(`Surface is not registered: ${id}`)
    return surface
  }

  list(): readonly Surface[] {
    return Array.from(this.surfaces.values())
  }
}
