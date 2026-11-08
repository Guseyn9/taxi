/** Three 20-second publishing cycles; an expired fix must never become a new measurement. */
export const LOCATION_MAX_AGE_MS = 60_000
export const LOCATION_MAX_ACCURACY_METERS = 200

export function isFreshDevicePosition(position?: GeolocationPosition | null, now = Date.now()): position is GeolocationPosition {
  if (!position || !Number.isFinite(position.timestamp) || position.timestamp > now + 5000 || now - position.timestamp > LOCATION_MAX_AGE_MS) return false
  const { latitude, longitude, accuracy } = position.coords || {}
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180 &&
    typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= LOCATION_MAX_ACCURACY_METERS
}
