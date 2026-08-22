import type { NavigationRegistry } from './navigation'
import { PLATFORM_ROUTES } from './navigation'
import type { SurfaceRegistry } from './SurfaceRegistry'
import { DRIVER_MAP_SURFACE_ID } from './surfaces/map'
import { PASSENGER_SIMPLE_SURFACE_ID } from './surfaces/passenger'
import {
  DRIVER_HUD_SURFACE_ID,
  DRIVER_LIST_SURFACE_ID,
  SHARED_CHAT_SURFACE_ID,
} from './surfaces/standard'

const REQUIRED_SURFACES = [
  DRIVER_MAP_SURFACE_ID,
  PASSENGER_SIMPLE_SURFACE_ID,
  DRIVER_HUD_SURFACE_ID,
  DRIVER_LIST_SURFACE_ID,
  SHARED_CHAT_SURFACE_ID,
]

export function validatePlatformInterfaceComposition(
  surfaceRegistry: SurfaceRegistry,
  navigationRegistry: NavigationRegistry,
): void {
  REQUIRED_SURFACES.forEach(id => surfaceRegistry.require(id))
  Object.values(PLATFORM_ROUTES).forEach(id => navigationRegistry.require(id))
}
