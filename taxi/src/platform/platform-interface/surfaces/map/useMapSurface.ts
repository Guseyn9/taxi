import { useEffect, useRef } from 'react'
import { platformInterface } from '../../compositionRoot'
import { DRIVER_HUD_SURFACE_ID } from '../standard'
import type { MapSurfaceBindings } from './MapSurface'

/** React adapter for the registered Map Surface. */
export function useMapSurface(bindings: MapSurfaceBindings) {
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  platformInterface.mapSurface.setBindings({
    get mockEnabled() {
      return bindingsRef.current.mockEnabled
    },
    setOrderCardModal(payload) {
      return bindingsRef.current.setOrderCardModal(payload)
    },
  })

  useEffect(() => {
    const unmountMap = platformInterface.runtime.mountSurface(platformInterface.mapSurface.id)
    const unmountHud = platformInterface.runtime.mountSurface(DRIVER_HUD_SURFACE_ID)
    return () => {
      unmountHud()
      unmountMap()
    }
  }, [])

  return platformInterface.mapSurface.channel
}
