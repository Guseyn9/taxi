import Config from '../config'
const pending = new Set<string>()
const key = (owner: unknown) => `taxi.booking-review:${Config.API_URL}:${String(owner || 'guest')}`
/** Only a boolean is persisted; never a phone, address, payload or token. */
export function bookingCreationNeedsReview(owner: unknown): boolean {
  const scope = key(owner)
  try {return sessionStorage.getItem(scope) === '1' || pending.has(scope)} catch {return pending.has(scope)}
}
export function markBookingCreationReview(owner: unknown, required: boolean): void {
  const scope = key(owner)
  if (required) pending.add(scope)
  else pending.delete(scope)
  try {if (required) sessionStorage.setItem(scope, '1'); else sessionStorage.removeItem(scope)} catch { /* Keep the in-page guard. */ }
}
