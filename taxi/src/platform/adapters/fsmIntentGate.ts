const aliases: Record<string, string> = {
  'driver.order.arrive': 'driver_arrived', 'driver.order.start': 'ride_started',
  'driver.order.confirm_boarding': 'ride_started', 'driver.order.finish': 'ride_finished',
  'driver.order.cancel': 'driver_cancel_requested',
}
export function normalizeFsmIntent(intent: string): string { return aliases[intent] || intent }
export function fsmIntentEnabled(intent: string): boolean {
  const configured = process.env.REACT_APP_FSM_ENABLED_INTENTS
  return configured === undefined || configured.split(',').map(value => value.trim()).includes(normalizeFsmIntent(intent))
}
