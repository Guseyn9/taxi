import type { PlatformInterfaceRuntime } from '../PlatformInterfaceRuntime'
import { SURFACE_KINDS } from '../types'
import { SnapshotSurface } from './SnapshotSurface'

export const DRIVER_HUD_SURFACE_ID = 'driver.hud'
export const DRIVER_LIST_SURFACE_ID = 'driver.list'
export const SHARED_CHAT_SURFACE_ID = 'shared.chat'

export function createStandardSurfaces(runtime: PlatformInterfaceRuntime) {
  return {
    hudSurface: new SnapshotSurface(DRIVER_HUD_SURFACE_ID, SURFACE_KINDS.Hud, runtime),
    listSurface: new SnapshotSurface(DRIVER_LIST_SURFACE_ID, SURFACE_KINDS.List, runtime),
    chatSurface: new SnapshotSurface(SHARED_CHAT_SURFACE_ID, SURFACE_KINDS.Chat, runtime),
  }
}
