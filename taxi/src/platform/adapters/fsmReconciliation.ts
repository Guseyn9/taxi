import {fsmSessionHeaders, handleFsmAuthenticationFailure} from './fsmSessionAuth'
import {withHttpDeadline} from './httpDeadline'

export function requiresFsmReconciliation(result: {errorCode?: string}): boolean {
  return result.errorCode === 'CORE_OUTCOME_UNKNOWN' || result.errorCode === 'CORE_FSM_DIVERGENCE'
}

/** Only an authenticated, matching, fresh idle snapshot releases a quarantine. */
export async function verifyFsmReconciliation(apiUrl: string, id: string | number, localId = false, request: typeof fetch = fetch.bind(globalThis)): Promise<boolean> {
  try {
    return await withHttpDeadline(async signal => {
      const path = localId ? `/api/realtime/snapshot/taxi/order/${encodeURIComponent(id)}` : `/api/taxi/core-orders/${encodeURIComponent(id)}`
      const headers = {Accept:'application/json', ...fsmSessionHeaders()}
      const response = await request(apiUrl.replace(/\/+$/, '') + path, {method:'GET', cache:'no-store', headers, signal})
      handleFsmAuthenticationFailure(response.status, headers)
      if (!response.ok) return false
      const snapshot = await response.json()
      return snapshot?.sync?.status === 'idle' && Number.isSafeInteger(snapshot.coreOrderId) && snapshot.coreOrderId > 0 &&
        String(localId ? snapshot.orderId : snapshot.coreOrderId) === String(id)
    }, 10000, 'FSM_RECONCILIATION_UNAVAILABLE')
  } catch { return false }
}
