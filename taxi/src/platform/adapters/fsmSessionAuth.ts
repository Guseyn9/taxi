import { loadSessionTokens, clearSessionTokens } from '../../security/sessionTokens'
import { BackendInteractionError } from './backendError'

/** Read at request time so logout/rotation never leaves a captured token behind. */
export function fsmSessionHeaders(): Record<string, string> {
  const pair = loadSessionTokens()
  if (!pair)
    throw new BackendInteractionError('FSM_COMMAND_HTTP_401', 'Sign in to continue')
  return { 'X-Auth-Token': pair.token, 'X-Auth-U-Hash': pair.u_hash }
}

export function fsmSocketAuthMessage(): string {
  const pair = loadSessionTokens()
  if (!pair)
    throw new BackendInteractionError('FSM_QUERY_HTTP_401', 'Sign in to continue')
  return JSON.stringify({ type: 'auth', token: pair.token, u_hash: pair.u_hash })
}

const authRequiredListeners = new Set<() => void>()
export function subscribeFsmAuthenticationRequired(listener: () => void): () => void {
  authRequiredListeners.add(listener)
  return () => { authRequiredListeners.delete(listener) }
}

/** A delayed refusal from an old request cannot sign out a newer session. */
export function handleFsmAuthenticationFailure(status: number, sent: HeadersInit): void {
  if (status !== 401) return
  const readHeader = (name: string): string | null => {
    if (typeof (sent as Headers).get === 'function') return (sent as Headers).get(name)
    const entries = Array.isArray(sent) ? sent : Object.entries(sent)
    return entries.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || null
  }
  const current = loadSessionTokens()
  if (!current || readHeader('X-Auth-Token') !== current.token || readHeader('X-Auth-U-Hash') !== current.u_hash) return
  clearSessionTokens()
  authRequiredListeners.forEach(listener => listener())
}
export function handleFsmSocketClose(event: unknown, sentAuth: string | null): void {
  if ((event as {code?: number})?.code !== 4401 || !sentAuth) return
  const pair = JSON.parse(sentAuth)
  handleFsmAuthenticationFailure(401, {'X-Auth-Token':pair.token, 'X-Auth-U-Hash':pair.u_hash})
}
