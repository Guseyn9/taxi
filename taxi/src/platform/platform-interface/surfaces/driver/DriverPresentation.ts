import type { IOrder, IUser } from '../../../../types/types'
import type { PlatformSnapshot } from '../../snapshot'

export interface DriverPresentation {
  readonly available: boolean
  readonly user: IUser | null
  readonly activeOrders: readonly IOrder[]
  readonly readyOrders: readonly IOrder[]
  readonly historyOrders: readonly IOrder[]
  readonly availableActions: readonly string[]
}

const EMPTY_DRIVER_PRESENTATION: DriverPresentation = Object.freeze({
  available: false,
  user: null,
  activeOrders: Object.freeze([]),
  readyOrders: Object.freeze([]),
  historyOrders: Object.freeze([]),
  availableActions: Object.freeze([]),
})

export function selectDriverPresentation(snapshot: PlatformSnapshot | null): DriverPresentation {
  const driver = snapshot?.state.driver as {
    readonly user?: IUser | null
    readonly activeOrders?: readonly IOrder[]
    readonly readyOrders?: readonly IOrder[]
    readonly historyOrders?: readonly IOrder[]
  } | undefined

  if (!driver)
    return EMPTY_DRIVER_PRESENTATION

  return Object.freeze({
    available: true,
    user: driver.user ?? null,
    activeOrders: driver.activeOrders ?? Object.freeze([]),
    readyOrders: driver.readyOrders ?? Object.freeze([]),
    historyOrders: driver.historyOrders ?? Object.freeze([]),
    availableActions: snapshot?.availableActions ?? Object.freeze([]),
  })
}
