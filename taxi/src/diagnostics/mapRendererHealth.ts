import { recordRuntimeHealth, trackRuntimeResource } from './runtimeHealth'

interface Renderer {
  on(type: string, listener: (event: any) => void): unknown
  off(type: string, listener: (event: any) => void): unknown
}

/** Hooks own only listeners; the Leaflet adapter remains responsible for renderer disposal. */
export function observeMapRenderer(renderer: Renderer, onContextLost: () => void) {
  const release = trackRuntimeResource('map-renderer')
  let disposed = false
  let lossTimer: ReturnType<typeof setTimeout> | undefined
  let errorReported = false
  const onLost = () => {
    if (disposed || lossTimer !== undefined) return
    recordRuntimeHealth('map.webgl_context_lost')
    // Unwind the renderer's event dispatch before replacing its layer.
    lossTimer = setTimeout(() => { lossTimer = undefined; if (!disposed) onContextLost() }, 0)
  }
  const onError = (event: any) => {
    if (disposed || errorReported) return
    errorReported = true
    // Log the first renderer error per instance, without source URLs or tile coordinates.
    recordRuntimeHealth('map.renderer_error', { name: event?.error?.name || 'MapError' })
  }
  renderer.on('webglcontextlost', onLost)
  renderer.on('error', onError)
  return () => {
    if (disposed) return
    disposed = true
    if (lossTimer !== undefined) clearTimeout(lossTimer)
    renderer.off('webglcontextlost', onLost)
    renderer.off('error', onError)
    release()
  }
}
