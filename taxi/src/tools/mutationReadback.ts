export function isAmbiguousMutationError(error: unknown, depth = 0): boolean {
  if (!error || depth > 4) return false
  const value = error as any
  const code = String(value.code ?? '')
  if (/ECONNABORTED|ETIMEDOUT|ERR_NETWORK|TIMEOUT|DEADLINE/.test(code)) return true
  // Axios 0.21 XHR errors have no code. A lost response does not prove a lost write.
  if (value.isAxiosError && (/^Network Error$/i.test(value.message || '') ||
    Number(value.response?.status) >= 500 || Number(value.response?.status) === 408)) return true
  return isAmbiguousMutationError(value.details, depth + 1) || isAmbiguousMutationError(value.cause, depth + 1)
}

/** One mutation at a time. Unknown outcomes must be read before any later write. */
export class MutationReadbackGuard {
  private readonly active = new Set<string>()
  private readonly uncertain = new Map<string, number>()
  constructor(private readonly storageKey = 'taxi.lifecycle.pending.v1') {}

  private saved(key: string): number | undefined {
    try {
      const records = JSON.parse(sessionStorage.getItem(this.storageKey) || '{}')
      const state = records[key]
      if (Number.isInteger(state)) return state
    } catch { /* Private mode or invalid storage: keep the in-page guard. */ }
    return this.uncertain.get(key)
  }

  private remember(key: string, state?: number) {
    if (state === undefined) this.uncertain.delete(key)
    else this.uncertain.set(key, state)
    try {
      const records = JSON.parse(sessionStorage.getItem(this.storageKey) || '{}')
      if (state === undefined) delete records[key]
      else records[key] = state
      sessionStorage.setItem(this.storageKey, JSON.stringify(records))
    } catch { /* The in-page guard still prevents an automatic retry. */ }
  }

  async run<T>(key: string, expected: number, request: () => Promise<T>, readState: () => Promise<number>, checking: (active: boolean) => void): Promise<{value: T} | {verifiedState: number}> {
    if (this.active.has(key)) throw Object.assign(new Error('An action is already pending'), {code:'MUTATION_IN_PROGRESS'})
    this.active.add(key)
    const verify = async() => {
      checking(true)
      try { return await readState() } finally { checking(false) }
    }
    try {
      const previous = this.saved(key)
      if (previous !== undefined) {
        // A failed read leaves the guard in place. No mutation is sent.
        const current = await verify()
        this.remember(key)
        if (current === expected) return {verifiedState:current}
      }
      try {
        // Persist before dispatch: reload/close can happen before rejection is delivered.
        this.remember(key, expected)
        const value = await request()
        this.remember(key)
        return {value}
      } catch (error) {
        if (!isAmbiguousMutationError(error)) { this.remember(key); throw error }
        this.remember(key, expected)
        let current: number
        try { current = await verify() }
        catch { throw Object.assign(new Error('Order state is unknown. Check the connection and order before retrying.'), {code:'ORDER_STATE_UNKNOWN',cause:error}) }
        this.remember(key)
        if (current === expected) return {verifiedState:current}
        // A known old state is not a confirmation of the requested transition.
        throw error
      }
    } finally { this.active.delete(key) }
  }
}
