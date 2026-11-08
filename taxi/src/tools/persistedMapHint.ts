import { privateDataScope } from '../security/sessionLifecycle'

/** A saved coordinate is only a camera/parked hint, never a fresh GPS fix. */
export const MAP_HINT_MAX_AGE_MS = 15 * 60 * 1000
export function createMapHint(latitude: number, longitude: number, now = Date.now()) {
  return { latitude, longitude, timestamp: now, scope: privateDataScope() }
}
export function readMapHint(value: any, now = Date.now()): [number, number] | null {
  if (!value || value.scope !== privateDataScope() || typeof value.timestamp !== 'number' ||
    !Number.isFinite(value.timestamp) || value.timestamp > now + 5000 || now - value.timestamp > MAP_HINT_MAX_AGE_MS ||
    typeof value.latitude !== 'number' || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
    typeof value.longitude !== 'number' || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) return null
  return [value.latitude, value.longitude]
}
