import { requiresFsmReconciliation, verifyFsmReconciliation } from './fsmReconciliation'
import { getSessionRecoveryId } from '../../security/sessionTokens'
import { fsmSessionHeaders, handleFsmAuthenticationFailure } from './fsmSessionAuth'
import { BackendInteractionError } from './backendError'
import { withHttpDeadline } from './httpDeadline'
import { FsmTaxiCommandTransport } from './FsmTaxiCommandTransport'
import { FsmCommandStatusTransport } from './FsmCommandStatusTransport'
import { resolveFsmIntent } from './fsmIntentGate'

const JOURNAL = 'taxi.passenger.fsm-pending.v1'
type Pending = { session: string; service: string; orderId: string; intent: string; commandId: string; digest: string; attempted?: boolean; instanceId?: number; entityId?: number }

function pendingForCurrentSession(): Pending | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(JOURNAL) || 'null')
    return saved?.session === getSessionRecoveryId() && saved?.service === process.env.REACT_APP_FSM_API_URL?.trim() ? saved : null
  } catch { return null }
}
export async function fsmPassengerEnabled(intent?: string): Promise<boolean> {
  const url = process.env.REACT_APP_FSM_API_URL?.trim()
  if (!url || process.env.REACT_APP_FSM_PASSENGER_ENABLED !== 'true') return false
  // Recover an accepted/uncertain command even after the operator disables it.
  if (pendingForCurrentSession()) return true
  return !intent || resolveFsmIntent(intent, url)
}

/** One write path, accepted-command recovery and no optimistic completion. */
export class FsmPassengerBridge {
  constructor(private readonly apiUrl: string, private readonly fetchRequest: typeof fetch = fetch.bind(globalThis), private readonly timeoutMs = 30000) {}

  async command(orderId: string, intent: string, payload: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await this.run(orderId, intent, payload)
  }

  async create(data: Record<string, unknown>, mode: 'DIRECT' | 'VOTE' | 'OFFER'): Promise<string> {
    const pending = await this.run('new-order', 'order_registered', { data, mode })
    const snapshot = await this.read(`/api/realtime/snapshot/taxi/order/${pending.entityId}`)
    if (!Number.isSafeInteger(snapshot.coreOrderId) || Number(snapshot.coreOrderId) <= 0)
      throw new BackendInteractionError('FSM_COMMAND_PROTOCOL_ERROR', 'The created order has no confirmed Core id')
    if (getSessionRecoveryId() !== pending.session)
      throw new BackendInteractionError('FSM_COMMAND_SESSION_CHANGED', 'The session changed while creating the order')
    sessionStorage.removeItem(JOURNAL)
    return String(snapshot.coreOrderId)
  }

  private async run(orderId: string, intent: string, payload: Readonly<Record<string, unknown>>): Promise<Pending> {
    const session = getSessionRecoveryId()
    if (!session) throw new BackendInteractionError('FSM_COMMAND_HTTP_401', 'Sign in to continue')
    const assertCurrent = () => {
      if (getSessionRecoveryId() !== session)
        throw new BackendInteractionError('FSM_COMMAND_SESSION_CHANGED', 'The session changed while processing the action')
    }
    const bytes = new TextEncoder().encode(JSON.stringify({ orderId, intent, payload }))
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
    let saved: Pending | null = null
    try { saved = JSON.parse(sessionStorage.getItem(JOURNAL) || 'null') } catch { /* No usable record. */ }
    if (saved && (saved.session !== session || saved.service !== this.apiUrl)) saved = null
    if (saved && (saved.orderId !== orderId || saved.intent !== intent || saved.digest !== digest)) {
      // A completed old action must not block unrelated future actions forever.
      // Missing/lost POST receipts are recovered by an authenticated GET only.
      if (!saved.instanceId) {
        const receipt = await this.read(`/api/commands/by-key/taxi/${encodeURIComponent(saved.commandId)}`)
        assertCurrent()
        if (!Number.isSafeInteger(receipt.instanceId)) throw new BackendInteractionError('FSM_COMMAND_RECOVERY_REQUIRED', 'Check the previous action')
        saved.instanceId = receipt.instanceId; saved.entityId = receipt.entityId
      }
      const previous = await new FsmCommandStatusTransport({apiUrl:this.apiUrl,useSessionAuth:true}, {fetch:this.fetchRequest}).getStatus(saved.instanceId!)
      assertCurrent()
      if (!['COMPLETED','FAILED'].includes(previous.status))
        throw new BackendInteractionError('FSM_COMMAND_RECOVERY_REQUIRED', 'Check the previous action before sending another command')
      if (requiresFsmReconciliation(previous)) await this.checkQuarantine(saved)
      if (saved.intent === 'order_registered' && previous.status === 'COMPLETED') {
        const created = await this.read(`/api/realtime/snapshot/taxi/order/${saved.entityId}`)
        assertCurrent()
        if (!Number.isSafeInteger(created.coreOrderId)) throw new BackendInteractionError('FSM_COMMAND_RECOVERY_REQUIRED', 'Check the created order')
        sessionStorage.removeItem(JOURNAL)
        throw new BackendInteractionError('FSM_ORDER_ALREADY_CREATED', 'Open the already created order before making another request', {coreOrderId:created.coreOrderId})
      }
      sessionStorage.removeItem(JOURNAL); saved = null
    }
    const pending: Pending = saved || { session, service: this.apiUrl, orderId, intent, digest, attempted: false, commandId: `cmd-${crypto.randomUUID()}` }
    const persist = () => {
      assertCurrent()
      // Refuse a new write when its recovery receipt cannot be saved.
      try { sessionStorage.setItem(JOURNAL, JSON.stringify(pending)) } catch {
        throw new BackendInteractionError('FSM_COMMAND_RECOVERY_REQUIRED', 'Session storage is unavailable; check the order before continuing')
      }
    }
    const clear = () => { assertCurrent(); sessionStorage.removeItem(JOURNAL) }
    persist()
    if (!pending.instanceId) {
      let accepted: any
      if (saved) {
        try {
          accepted = await this.read(`/api/commands/by-key/taxi/${encodeURIComponent(pending.commandId)}`)
          assertCurrent()
          accepted = { ...accepted, accepted: true }
        } catch (error) {
          if ((error as any)?.code !== 'FSM_COMMAND_HTTP_404') throw error
        }
      }
      try {
        if (!accepted && !await resolveFsmIntent(intent, this.apiUrl, this.fetchRequest)) {
          const current = JSON.parse(sessionStorage.getItem(JOURNAL) || 'null')
          if (current?.commandId === pending.commandId && current.attempted === false) clear()
          throw new BackendInteractionError('FSM_INTENT_DISABLED', 'Check the previous action before switching to legacy')
        }
        if (!accepted) { pending.attempted = true; persist() }
        if (!accepted && intent === 'order_registered') {
          accepted = await this.read('/api/taxi/orders', { method: 'POST', headers: { 'Idempotency-Key': pending.commandId }, body: JSON.stringify(payload) })
        } else if (!accepted) {
          const transport = new FsmTaxiCommandTransport({ apiUrl: this.apiUrl, useSessionAuth: true, useCoreOrderIds: true }, { fetch: this.fetchRequest, createId: () => pending.commandId })
          accepted = await transport.send(orderId, intent, payload)
        }
      } catch (error) {
        const code = (error as any)?.code || ''
        if (/HTTP_(400|401|403|404|409)$/.test(code) && getSessionRecoveryId() === session) clear()
        if (code === 'FSM_FEATURE_FLAGS_UNAVAILABLE') {
          const current = JSON.parse(sessionStorage.getItem(JOURNAL) || 'null')
          if (current?.commandId === pending.commandId && current.attempted === false) clear()
        }
        throw error
      }
      assertCurrent()
      if (accepted?.accepted !== true || !Number.isSafeInteger(accepted.instanceId) || accepted.instanceId <= 0 || !Number.isSafeInteger(accepted.entityId))
        throw new BackendInteractionError('FSM_COMMAND_PROTOCOL_ERROR', 'The command receipt is invalid; check the order')
      pending.instanceId = accepted.instanceId
      pending.entityId = accepted.entityId
      persist()
    }
    const status = new FsmCommandStatusTransport({ apiUrl: this.apiUrl, useSessionAuth: true }, { fetch: this.fetchRequest })
    const deadline = Date.now() + this.timeoutMs
    while (Date.now() < deadline) {
      assertCurrent()
      const value = await status.getStatus(pending.instanceId!)
      assertCurrent()
      if (value.status === 'COMPLETED') { if (intent !== 'order_registered') clear(); return pending }
      if (value.status === 'FAILED') {
        if (requiresFsmReconciliation(value)) await this.checkQuarantine(pending)
        clear()
        throw new BackendInteractionError(value.errorCode || 'CORE_REJECTED', value.errorMessage || 'The server rejected the action')
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new BackendInteractionError('FSM_COMMAND_PENDING', 'The server is still checking the action. Check its status before retrying')
  }

  private async checkQuarantine(pending: Pending): Promise<never> {
    const verified = pending.entityId && await verifyFsmReconciliation(this.apiUrl, pending.entityId, true, this.fetchRequest)
    if (getSessionRecoveryId() !== pending.session)
      throw new BackendInteractionError('FSM_COMMAND_SESSION_CHANGED', 'The session changed while checking the order')
    if (verified) sessionStorage.removeItem(JOURNAL)
    throw new BackendInteractionError(verified ? 'FSM_COMMAND_RECOVERY_REQUIRED' : 'CORE_OUTCOME_UNKNOWN',
      verified ? 'The server reconciled the order. Check it before sending another action.' : 'The previous write requires server reconciliation.')
  }

  private async read(path: string, init: RequestInit = {}): Promise<any> {
    return withHttpDeadline(async signal => {
      const sentHeaders = { Accept: 'application/json', 'Content-Type': 'application/json', ...fsmSessionHeaders(), ...init.headers }
      const response = await this.fetchRequest(this.apiUrl.replace(/\/+$/, '') + path, { method: 'GET', ...init, signal, headers: sentHeaders })
      handleFsmAuthenticationFailure(response.status, sentHeaders)
      const data = await response.json()
      if (!response.ok) throw new BackendInteractionError(`FSM_COMMAND_HTTP_${response.status}`, 'The action could not be confirmed', data)
      return data
    }, 15000, 'FSM_COMMAND_TIMEOUT')
  }
}

export function configuredFsmPassengerBridge(): FsmPassengerBridge {
  return new FsmPassengerBridge(process.env.REACT_APP_FSM_API_URL!.trim())
}
