import { loadSessionTokens } from '../../security/sessionTokens'
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
