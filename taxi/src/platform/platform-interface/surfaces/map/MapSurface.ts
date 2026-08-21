import type { InteractionEvent } from '../../../interaction-contract'
import { MapChannel } from '../../../map-channel/MapChannel'
import { registerMapApplicationHandler } from '../../../map-channel/MapApplicationHandler'
import type {
  IApplicationContract,
  IOrderSelectedPayload,
} from '../../../map-channel/map-channel-protocol'
import { DRIVER_ORDER_SELECTED_EVENT } from '../../../map-channel/map-channel-protocol'
import type { Surface } from '../../Surface'
import { SURFACE_KINDS } from '../../types'
import type { SurfaceUnmount } from '../../types'

export const DRIVER_MAP_SURFACE_ID = 'driver.map'

/** UI bindings supplied by the Web Driver channel. */
export interface MapSurfaceBindings {
  readonly mockEnabled: boolean
  readonly setOrderCardModal: (payload: { isOpen: true, orderId: string }) => unknown
}

/**
 * Surface adapter over the existing Map Channel.
 *
 * It owns presentation lifecycle and the Event -> UI reaction. The existing
 * Channel, Mapper, Application Handler and Interaction Contract stay unchanged.
 */
export class MapSurface implements Surface {
  readonly id = DRIVER_MAP_SURFACE_ID
  readonly kind = SURFACE_KINDS.Map
  readonly channel: MapChannel

  private readonly contract: IApplicationContract
  private bindings: MapSurfaceBindings | null = null
  private mountCount = 0
  private stopHandler: SurfaceUnmount | null = null
  private stopEvents: SurfaceUnmount | null = null

  constructor(contract: IApplicationContract, channel: MapChannel) {
    this.contract = contract
    this.channel = channel
  }

  setBindings(bindings: MapSurfaceBindings): void {
    this.bindings = bindings
  }

  isMounted(): boolean {
    return this.mountCount > 0
  }

  mount(): SurfaceUnmount {
    if (!this.bindings)
      throw new Error('MapSurface bindings must be configured before mount')

    this.mountCount += 1
    if (this.mountCount === 1) {
      this.stopHandler = registerMapApplicationHandler(this.contract)
      this.stopEvents = this.channel.subscribe(event => this.handleEvent(event))
    }

    let unmounted = false
    return () => {
      if (unmounted)
        return
      unmounted = true

      this.mountCount = Math.max(0, this.mountCount - 1)
      if (this.mountCount === 0)
        this.stop()
    }
  }

  private handleEvent(event: InteractionEvent): void {
    if (event.type !== DRIVER_ORDER_SELECTED_EVENT || !this.bindings)
      return

    if (this.bindings.mockEnabled)
      return

    const { orderId } = event.payload as IOrderSelectedPayload
    this.bindings.setOrderCardModal({ isOpen: true, orderId })
  }

  private stop(): void {
    if (this.stopHandler)
      this.stopHandler()
    if (this.stopEvents)
      this.stopEvents()

    this.stopHandler = null
    this.stopEvents = null
  }
}
