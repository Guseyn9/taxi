export const SESSION_DOMAIN_RESET = 'taxi/session/RESET_PRIVATE_DOMAINS'
let generation = 0
let owner: string | undefined
let guestScope: string | undefined
const listeners = new Set<() => void>()
export const sessionGeneration = () => generation
export const advanceSessionGeneration = () => {
  generation++
  listeners.forEach(listener => { try { listener() } catch { /* Other private caches must still be cleared. */ } })
  return generation
}
export function subscribeSessionBoundary(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function assertSessionGeneration(expected: number): void {
  if (expected !== generation) throw new Error('Session changed; obsolete operation discarded')
}
export function privateDataScope(): string {
  if (owner) return owner
  try { guestScope = guestScope || sessionStorage.getItem('taxi.private.guest') || undefined } catch { /* Memory-only guest. */ }
  if (!guestScope) {
    guestScope = `${Date.now()}-${Math.random()}`
    try { sessionStorage.setItem('taxi.private.guest', guestScope) } catch { /* Memory-only guest. */ }
  }
  return `guest:${guestScope}`
}
export function setPrivateDataOwner(id?: string | number | null): void {
  let tenant = process.env.REACT_APP_SERVICE_CONFIG || 'default'
  try { tenant = process.env.REACT_APP_SERVICE_CONFIG || localStorage.getItem('config') || tenant } catch { /* Fixed or default tenant. */ }
  owner = id == null ? undefined : `user:${tenant}:${id}`
  try { localStorage.setItem('taxi.private.owner', owner || 'guest') } catch { /* Memory-only privacy boundary. */ }
}
/** Derived compatibility state may never cross an identity boundary. Persistent address books are scoped separately. */
export function clearPrivateDerivedStorage(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (/^state\.(clientOrder\.|user\.user$)/.test(key) || /^(?:passenger|driver(?:Offers|Voting|Started|Choice|Pickup|Rejected)|hiddenOrders$|cachedDriverMapState(?:\.|$)|gruzvill_(?:passenger_saved_phone|driver_parked_position|driver_demo|last_browser_geolocation)|taxi_(?:raw_log|flow_log|frontend_debug_log|frontend_debug_snapshots|decision_log))/.test(key)) localStorage.removeItem(key)
    }
  } catch { /* Blocked storage cannot preserve in-memory private state. */ }
}
export function clearUnownedPrivateStorage(): void {
  try {
    if (!sessionStorage.getItem('state.user.tokens') && localStorage.getItem('taxi.private.owner')?.startsWith('user:')) clearPrivateDerivedStorage()
  } catch { /* No usable persistent restoration when storage is unavailable. */ }
}
