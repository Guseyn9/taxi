import { requiresFsmReconciliation } from './fsmReconciliation'
import type { CommandCompletionRequest, CommandCompletionResult, DriverCommandCompletionWaiter } from './DriverCommandCompletionWaiter'
import { COMMAND_COMPLETION_FAILURE_KINDS, COMMAND_COMPLETION_STATUSES } from './DriverCommandCompletionWaiter'
import { BackendInteractionError } from './backendError'

const KEY = 'taxi.driver.pending-commands.v1'
const MAX_COMMANDS = 50
const ACTIONS = new Set(['driver.order.arrive', 'driver.order.start', 'driver.order.confirm_boarding', 'driver.order.finish', 'driver.order.cancel'])
export interface CommandRecoveryScope { userId: string; service: string; sessionId: string }
export interface SavedDriverCommand { actionType: string; orderId: string; instanceId: number; acceptedAt: number }
export interface RecoveringDriverCommand extends SavedDriverCommand {
  readonly phase: 'checking' | 'unconfirmed' | 'completed' | 'failed'
  readonly restored: boolean
  readonly durable: boolean
}
export interface DriverCommandRecoveryOptions {
  scope: () => CommandRecoveryScope | null
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  now?: () => number
  verifyReconciliation?: (command: SavedDriverCommand) => Promise<boolean>
  onRecovered?: (command: SavedDriverCommand, result: CommandCompletionResult) => void
}
const EMPTY: readonly RecoveringDriverCommand[] = Object.freeze([])
export const commandNeedsRecovery = (item: RecoveringDriverCommand) => item.phase === 'checking' || item.phase === 'unconfirmed'
const sameScope = (a: CommandRecoveryScope | null, b: CommandRecoveryScope | null) =>
  Boolean(a && b && a.userId === b.userId && a.service === b.service && a.sessionId === b.sessionId)
const validCommand = (value: any): value is SavedDriverCommand => Boolean(value && ACTIONS.has(value.actionType) &&
  typeof value.orderId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.orderId) &&
  Number.isSafeInteger(value.instanceId) && value.instanceId > 0 && Number.isFinite(value.acceptedAt) && value.acceptedAt > 0)

/** Accepted instance IDs only. No credentials, PINs, command bodies or automatic POST retries. */
export class DriverCommandRecovery {
  private readonly waiter: DriverCommandCompletionWaiter
  private readonly options: DriverCommandRecoveryOptions
  private readonly store: DriverCommandRecoveryOptions['storage']
  private scope: CommandRecoveryScope | null = null
  private records: readonly RecoveringDriverCommand[] = EMPTY
  private listeners = new Set<() => void>()
  private following = new Set<number>()

  constructor(waiter: DriverCommandCompletionWaiter, options: DriverCommandRecoveryOptions) {
    this.waiter = waiter
    this.options = options
    if (options.storage !== undefined) this.store = options.storage
    else { try { this.store = window.sessionStorage } catch { this.store = null } }
  }

  getSnapshot = (): readonly RecoveringDriverCommand[] => this.records
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private emit(records: readonly RecoveringDriverCommand[]): void {
    this.records = records.length ? Object.freeze(records) : EMPTY
    this.listeners.forEach(listener => listener())
  }

  /** Called after authentication, again on account/session changes and after reload. */
  activate(): void {
    const next = this.options.scope()
    if (sameScope(next, this.scope)) return
    if (this.scope) this.waiter.cancelAll()
    this.following.clear()
    this.scope = next
    this.emit(EMPTY)
    if (!next || !this.waiter.supportsInstanceRecovery) return
    let commands: SavedDriverCommand[] = []
    try {
      const raw = this.store?.getItem(KEY)
      const value = raw ? JSON.parse(raw) : null
      if (value?.version === 1 && sameScope(value.scope, next) && Array.isArray(value.commands)) {
        // Reject the whole malformed journal, rather than partially trusting it.
        if (value.commands.length <= MAX_COMMANDS && value.commands.every(validCommand) &&
          new Set(value.commands.map((item: SavedDriverCommand) => item.instanceId)).size === value.commands.length &&
          new Set(value.commands.map((item: SavedDriverCommand) => item.orderId)).size === value.commands.length)
          commands = value.commands.map(({ actionType, orderId, instanceId, acceptedAt }: SavedDriverCommand) => ({ actionType, orderId, instanceId, acceptedAt }))
      }
    } catch { /* Invalid/blocked storage cannot authorize a command. */ }
    this.emit(commands.map(item => ({ ...item, phase: 'checking', restored: true, durable: true })))
    for (const command of this.records) void this.follow(command, next)
  }

  captureScope(): CommandRecoveryScope | null {
    this.activate()
    return this.scope ? { ...this.scope } : null
  }
  isCurrent(scope: CommandRecoveryScope | null): boolean { return sameScope(scope, this.options.scope()) }
  belongsTo(userId: string | number): boolean { return this.scope?.userId === String(userId) && this.isCurrent(this.scope) }
  hasPending(orderId: string | number): boolean {
    this.activate()
    return this.records.some(item => item.orderId === String(orderId) && commandNeedsRecovery(item))
  }
  assertCanSend(orderId: string | number): void {
    if (this.hasPending(orderId)) throw new BackendInteractionError('FSM_COMMAND_RECOVERY_REQUIRED', 'Check the previous action before sending another command.')
    if (this.records.filter(commandNeedsRecovery).length >= MAX_COMMANDS) throw new BackendInteractionError('FSM_COMMAND_RECOVERY_LIMIT', 'Check pending actions before sending another command.')
  }

  /** Persist synchronously before publishing CommandAccepted to the UI. */
  remember(request: CommandCompletionRequest, scope: CommandRecoveryScope | null): void {
    if (!scope || !this.isCurrent(scope) || !this.waiter.supportsInstanceRecovery) return
    const command: SavedDriverCommand = { actionType: request.actionType, orderId: String(request.orderId), instanceId: request.instanceId, acceptedAt: (this.options.now || Date.now)() }
    if (!validCommand(command)) throw new BackendInteractionError('FSM_COMMAND_RECOVERY_PROTOCOL_ERROR', 'Accepted command cannot be restored safely.')
    const existing = this.records.find(item => item.instanceId === command.instanceId)
    if (existing) {
      if (existing.orderId !== command.orderId || existing.actionType !== command.actionType)
        throw new BackendInteractionError('FSM_COMMAND_RECOVERY_PROTOCOL_ERROR', 'Accepted instance belongs to another action.')
      return
    }
    this.emit([...this.records, { ...command, phase: 'checking', restored: false, durable: true }])
    if (!this.persist()) this.emit(this.records.map(item => item.instanceId === command.instanceId ? { ...item, durable: false } : item))
  }

  settle(instanceId: number, result: CommandCompletionResult, scope: CommandRecoveryScope | null, reconciled = false): void {
    if (!this.isCurrent(scope) || !sameScope(scope, this.scope)) return
    const terminal = result.status === COMMAND_COMPLETION_STATUSES.Completed ||
      result.status === COMMAND_COMPLETION_STATUSES.Failed && result.failureKind === COMMAND_COMPLETION_FAILURE_KINDS.Execution && (!requiresFsmReconciliation(result) || reconciled)
    if (terminal) this.emit(this.records.flatMap(item => item.instanceId !== instanceId ? [item] : item.restored ? [{ ...item, phase: result.status === COMMAND_COMPLETION_STATUSES.Completed ? 'completed' as const : 'failed' as const }] : []))
    else this.emit(this.records.map(item => item.instanceId === instanceId ? { ...item, phase: 'unconfirmed' } : item))
    this.persist()
  }

  retry(instanceId: number): void {
    this.activate()
    const command = this.records.find(item => item.instanceId === instanceId)
    if (command && command.phase === 'unconfirmed' && this.scope && !this.following.has(instanceId)) void this.follow(command, this.scope)
  }
  dismiss(instanceId: number): void {
    this.emit(this.records.filter(item => item.instanceId !== instanceId || commandNeedsRecovery(item)))
  }

  private async follow(command: RecoveringDriverCommand, scope: CommandRecoveryScope): Promise<void> {
    if (this.following.has(command.instanceId)) return
    this.following.add(command.instanceId)
    this.emit(this.records.map(item => item.instanceId === command.instanceId ? { ...item, phase: 'checking', restored: true } : item))
    try {
      const result = await this.waiter.wait({ ...command, baseline: { state: null } })
      if (!this.isCurrent(scope) || !sameScope(this.scope, scope)) return
      const reconciled = requiresFsmReconciliation(result) && this.options.verifyReconciliation ? await this.options.verifyReconciliation(command) : false
      if (!this.isCurrent(scope) || !sameScope(this.scope, scope)) return
      this.settle(command.instanceId, result, scope, reconciled)
      this.options.onRecovered?.(command, result)
    } catch {
      this.settle(command.instanceId, { status: COMMAND_COMPLETION_STATUSES.Timeout, instanceId: command.instanceId }, scope)
    } finally {
      if (sameScope(this.scope, scope)) this.following.delete(command.instanceId)
    }
  }

  private persist(): boolean {
    if (!this.scope || !this.isCurrent(this.scope)) return false
    const commands = this.records.filter(commandNeedsRecovery).map(({ actionType, orderId, instanceId, acceptedAt }) => ({ actionType, orderId, instanceId, acceptedAt }))
    try {
      if (!this.store) return false
      if (!commands.length) this.store.removeItem(KEY)
      else this.store.setItem(KEY, JSON.stringify({ version: 1, scope: this.scope, commands }))
      return true
    } catch { return false }
  }
}
