import { BackendInteractionError } from './backendError'
import { withHttpDeadline } from './httpDeadline'

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

const knownIntents = new Set(['order_registered', 'vote_requested', 'offer_requested', 'direct_assignment_requested', 'candidate_selected', 'candidate_released', 'offer_selected', 'driver_arrived', 'ride_started', 'ride_finished', 'cancel_requested', 'driver_cancel_requested'])

/** Read fresh before choosing a write path. Failed reads never select legacy. */
export async function resolveFsmIntent(intent: string, apiUrl: string, request: typeof fetch = fetch.bind(globalThis)): Promise<boolean> {
  if (!fsmIntentEnabled(intent)) return false
  if (process.env.REACT_APP_FSM_RUNTIME_FLAGS_ENABLED !== 'true') return true
  try {
    return await withHttpDeadline(async signal => {
      const response = await request(apiUrl.replace(/\/+$/, '') + '/api/taxi/features', {method:'GET', cache:'no-store', credentials:'omit', signal, headers:{Accept:'application/json'}})
      if (!response.ok) throw new Error('Rollout configuration is unavailable')
      const config = await response.json()
      if (config?.schemaVersion !== 1 || !Array.isArray(config.enabledIntents) || config.enabledIntents.length > knownIntents.size || config.enabledIntents.some((v:unknown) => typeof v !== 'string' || !knownIntents.has(v)))
        throw new Error('Invalid rollout configuration')
      return config.enabledIntents.includes(normalizeFsmIntent(intent))
    }, 5000, 'FSM_FEATURE_FLAGS_UNAVAILABLE')
  } catch {
    throw new BackendInteractionError('FSM_FEATURE_FLAGS_UNAVAILABLE', 'Operation settings could not be loaded. Retry when connected.')
  }
}
