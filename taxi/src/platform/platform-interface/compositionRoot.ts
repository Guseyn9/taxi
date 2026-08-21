import { AppInteractionContract } from '../map-channel/AppInteractionContract'
import { MapChannel } from '../map-channel/MapChannel'
import { PlatformInterfaceRuntime } from './PlatformInterfaceRuntime'
import type { PlatformRuntimeLogger } from './PlatformInterfaceRuntime'
import { NavigationRegistry, NavigationRuntime, registerPlatformRoutes } from './navigation'
import { EmptySnapshotProvider, SwitchableSnapshotProvider } from './SnapshotProvider'
import type { PlatformSnapshotProvider } from './SnapshotProvider'
import { SurfaceRegistry } from './SurfaceRegistry'
import { MapSurface } from './surfaces/map/MapSurface'
import { PassengerSurface } from './surfaces/passenger/PassengerSurface'
import { createStandardSurfaces } from './surfaces/standard'
import { validatePlatformInterfaceComposition } from './validateComposition'

export interface PlatformInterfaceCompositionOptions {
  readonly snapshotProvider?: PlatformSnapshotProvider
  readonly logger?: PlatformRuntimeLogger
}

/** PI composition root. Domain data enters only through SnapshotProvider. */
export function createPlatformInterfaceComposition(
  options: PlatformInterfaceCompositionOptions = {},
) {
  const applicationContract = new AppInteractionContract(options.logger)
  const surfaceRegistry = new SurfaceRegistry()
  const navigationRegistry = new NavigationRegistry()
  registerPlatformRoutes(navigationRegistry)
  const navigationRuntime = new NavigationRuntime(navigationRegistry)
  const snapshotProvider = new SwitchableSnapshotProvider(
    options.snapshotProvider ?? new EmptySnapshotProvider(),
  )
  const runtime = new PlatformInterfaceRuntime(
    applicationContract,
    snapshotProvider,
    surfaceRegistry,
    options.logger,
  )
  const mapChannel = new MapChannel(runtime, undefined, undefined, options.logger)
  const mapSurface = new MapSurface(runtime, mapChannel)
  const passengerSurface = new PassengerSurface(runtime)
  const { hudSurface, listSurface, chatSurface } = createStandardSurfaces(runtime)

  surfaceRegistry.register(mapSurface)
  surfaceRegistry.register(passengerSurface)
  surfaceRegistry.register(hudSurface)
  surfaceRegistry.register(listSurface)
  surfaceRegistry.register(chatSurface)
  validatePlatformInterfaceComposition(surfaceRegistry, navigationRegistry)

  return {
    applicationContract,
    contract: runtime,
    mapChannel,
    mapSurface,
    passengerSurface,
    hudSurface,
    listSurface,
    chatSurface,
    navigationRegistry,
    navigationRuntime,
    runtime,
    snapshotProvider,
    surfaceRegistry,
  }
}

/** Module-level composition root shared by the mounted Web application. */
export const platformInterface = createPlatformInterfaceComposition()
