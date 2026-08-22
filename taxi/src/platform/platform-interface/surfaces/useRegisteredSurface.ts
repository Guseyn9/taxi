import { useEffect } from 'react'
import { platformInterface } from '../compositionRoot'
import type { SurfaceId } from '../types'

export function useRegisteredSurface(surfaceId: SurfaceId, enabled = true): void {
  useEffect(() => {
    if (!enabled)
      return undefined
    return platformInterface.runtime.mountSurface(surfaceId)
  }, [surfaceId, enabled])
}
