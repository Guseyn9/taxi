import { useMemo } from 'react'
import { usePlatformRuntime } from '../../usePlatformRuntime'
import type { SurfaceId } from '../../types'
import { useRegisteredSurface } from '../useRegisteredSurface'
import { DRIVER_HUD_SURFACE_ID, DRIVER_LIST_SURFACE_ID } from '../standard'
import { selectDriverPresentation } from './DriverPresentation'

function useDriverSurface(surfaceId: SurfaceId) {
  const runtimeState = usePlatformRuntime()
  useRegisteredSurface(surfaceId)
  return useMemo(
    () => selectDriverPresentation(runtimeState.snapshot),
    [runtimeState.snapshot],
  )
}

export function useDriverHudSurface() {
  return useDriverSurface(DRIVER_HUD_SURFACE_ID)
}

export function useDriverListSurface() {
  return useDriverSurface(DRIVER_LIST_SURFACE_ID)
}
