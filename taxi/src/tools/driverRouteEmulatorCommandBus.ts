/**
 * Tiny window-event command bus for the DriverRouteEmulator test controls.
 *
 * The route-emulator model instance lives inside the driver map component, but
 * the temporary test buttons live in a separate panel (DriverEmulatorPanel).
 * Rather than lift the model into shared state, the panel emits high-level
 * commands here and the map subscribes and calls the model's public API. This
 * mirrors how the rest of the emulator UI already talks across components
 * (window CustomEvents) and keeps the panel dumb — it only asks, it never holds
 * the model. Later these emitters can be replaced by an FSM / event handler
 * calling the same model API directly.
 */

export type TDriverRouteEmulatorCommand =
  | { type: 'replace' }
  | { type: 'append' }
  | { type: 'removeLast' }
  | { type: 'clear' }

const DRIVER_ROUTE_EMULATOR_COMMAND_EVENT = 'driverRouteEmulatorCommand'

export function emitDriverRouteEmulatorCommand(command: TDriverRouteEmulatorCommand) {
  if (typeof window === 'undefined')
    return

  window.dispatchEvent(new CustomEvent(DRIVER_ROUTE_EMULATOR_COMMAND_EVENT, { detail: command }))
}

export function subscribeDriverRouteEmulatorCommand(
  listener: (command: TDriverRouteEmulatorCommand) => void,
) {
  if (typeof window === 'undefined')
    return () => {}

  const handler = (event: Event) => {
    const command = (event as CustomEvent<TDriverRouteEmulatorCommand>).detail
    if (command?.type)
      listener(command)
  }
  window.addEventListener(DRIVER_ROUTE_EMULATOR_COMMAND_EVENT, handler)
  return () => window.removeEventListener(DRIVER_ROUTE_EMULATOR_COMMAND_EVENT, handler)
}

/**
 * Reverse channel (map → panel): a debug notification that the route emulator
 * received an external world event (task 9/10). Purely for developer visibility
 * in DriverEmulatorPanel — no behaviour depends on it.
 */
export interface IDriverRouteEmulatorNotification {
  eventType: string
  orderId?: string
}

const DRIVER_ROUTE_EMULATOR_NOTIFICATION_EVENT = 'driverRouteEmulatorNotification'

export function emitDriverRouteEmulatorNotification(notification: IDriverRouteEmulatorNotification) {
  if (typeof window === 'undefined')
    return

  window.dispatchEvent(
    new CustomEvent(DRIVER_ROUTE_EMULATOR_NOTIFICATION_EVENT, { detail: notification }),
  )
}

export function subscribeDriverRouteEmulatorNotification(
  listener: (notification: IDriverRouteEmulatorNotification) => void,
) {
  if (typeof window === 'undefined')
    return () => {}

  const handler = (event: Event) => {
    const notification = (event as CustomEvent<IDriverRouteEmulatorNotification>).detail
    if (notification?.eventType)
      listener(notification)
  }
  window.addEventListener(DRIVER_ROUTE_EMULATOR_NOTIFICATION_EVENT, handler)
  return () => window.removeEventListener(DRIVER_ROUTE_EMULATOR_NOTIFICATION_EVENT, handler)
}
