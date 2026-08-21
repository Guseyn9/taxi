import { useSyncExternalStore } from 'react'
import { platformInterface } from './compositionRoot'
import type { PlatformInterfaceRuntime } from './PlatformInterfaceRuntime'

/** Read-only React projection of PI Runtime state. */
export function usePlatformRuntime(runtime: PlatformInterfaceRuntime = platformInterface.runtime) {
  return useSyncExternalStore(
    listener => runtime.subscribeRuntime(listener),
    () => runtime.getState(),
    () => runtime.getState(),
  )
}
