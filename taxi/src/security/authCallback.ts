const STATE_KEY = 'taxi.oauth.state'
type Callback = { authHash: string | null, state: string | null, email: string | null, name: string | null }
let callback: Callback | null = null

/** Runs before store/config bootstrap so credentials cannot reach later resource URLs. */
export function captureAuthCallback(): void {
  const url = new URL(window.location.href)
  if (!['auth_hash', 'u_email', 'u_name'].some(key => url.searchParams.has(key))) return
  callback = {
    authHash: url.searchParams.get('auth_hash'), state: url.searchParams.get('state'),
    email: url.searchParams.get('u_email'), name: url.searchParams.get('u_name'),
  }
  for (const key of ['auth_hash', 'state', 'u_email', 'u_name']) url.searchParams.delete(key)
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}

export function consumeOAuthHash(): string | null {
  if (!callback?.authHash) return null
  const value = callback
  callback = null
  if (!consumeOAuthState(value.state)) throw new Error('OAUTH_STATE_MISMATCH')
  return value.authHash
}

export function consumeRegistrationCallback(): { email: string, name: string } | null {
  if (!callback || callback.authHash !== null || !callback.email || !callback.name) return null
  const result = { email: callback.email, name: callback.name }
  const state = callback.state
  callback = null
  return consumeOAuthState(state) ? result : null
}

function consumeOAuthState(state: string | null): boolean {
  let expected: string | null = null
  try { expected = sessionStorage.getItem(STATE_KEY); sessionStorage.removeItem(STATE_KEY) } catch { /* Fail closed. */ }
  return googleOAuthAvailable() && Boolean(expected && state && expected === state)
}

/** Enable only after the PHP callback echoes and validates OAuth state. */
export function googleOAuthAvailable(): boolean {
  return process.env.REACT_APP_OAUTH_STATE_SUPPORTED === 'true'
}

export function beginGoogleOAuth(url: string): string {
  if (!googleOAuthAvailable()) throw new Error('OAUTH_BACKEND_NOT_READY')
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const state = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  sessionStorage.setItem(STATE_KEY, state)
  const target = new URL(url)
  target.searchParams.set('state', state)
  return target.toString()
}
