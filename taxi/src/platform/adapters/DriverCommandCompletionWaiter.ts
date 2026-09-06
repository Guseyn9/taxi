import type { IOrder } from '../../types/types'
import type {
  PlatformInterfaceRuntime,
  PlatformSnapshot,
} from '../platform-interface'
import { BackendInteractionError, normalizeBackendError } from './backendError'
import {
  CommandStatusTransport,
  FSM_COMMAND_EXECUTION_STATUSES,
  normalizeCommandStatusPollInterval,
} from './FsmCommandStatusTransport'

export const COMMAND_COMPLETION_STATUSES = {
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  Timeout: 'TIMEOUT',
  Cancelled: 'CANCELLED',
} as const

export type CommandCompletionStatus =
  typeof COMMAND_COMPLETION_STATUSES[keyof typeof COMMAND_COMPLETION_STATUSES]

export const COMMAND_COMPLETION_FAILURE_KINDS = {
  Execution: 'EXECUTION',
  StatusLookup: 'STATUS_LOOKUP',
} as const

export type CommandCompletionFailureKind =
  typeof COMMAND_COMPLETION_FAILURE_KINDS[keyof typeof COMMAND_COMPLETION_FAILURE_KINDS]

export interface CommandCompletionBaseline {
  readonly state: string | null
}

export interface CommandCompletionRequest {
  readonly actionType: string
  readonly orderId: IOrder['b_id']
  readonly instanceId: number
  readonly baseline: CommandCompletionBaseline
}

export interface CommandCompletionResult {
  readonly status: CommandCompletionStatus
  readonly instanceId: number
  readonly errorCode?: string
  readonly message?: string
  readonly failureKind?: CommandCompletionFailureKind
}

export interface DriverCommandCompletionWaiter {
  captureBaseline(orderId: IOrder['b_id']): CommandCompletionBaseline
  wait(request: CommandCompletionRequest): Promise<CommandCompletionResult>
  fail(instanceId: number, errorCode: string, message: string): void
  cancelAll(): void
}

interface PendingStatusCompletion {
  readonly promise: Promise<CommandCompletionResult>
  readonly request: CommandCompletionRequest
  resolve(result: CommandCompletionResult): void
  pollTimer: ReturnType<typeof setTimeout> | null
  deadlineTimer: ReturnType<typeof setTimeout> | null
}

/** Normative TASK-CORE-001 completion by execution instanceId. */
export class CommandStatusDriverCommandCompletionWaiter implements DriverCommandCompletionWaiter {
  private readonly transport: CommandStatusTransport
  private readonly timeoutMs: number
  private readonly pollIntervalMs: number
  private readonly pending = new Map<number, PendingStatusCompletion>()

  constructor(
    transport: CommandStatusTransport,
    timeoutMs = 60000,
    pollIntervalMs = 1000,
  ) {
    this.transport = transport
    this.timeoutMs = Math.max(0, timeoutMs)
    this.pollIntervalMs = normalizeCommandStatusPollInterval(pollIntervalMs)
  }

  captureBaseline(): CommandCompletionBaseline {
    return { state: null }
  }

  wait(request: CommandCompletionRequest): Promise<CommandCompletionResult> {
    const existing = this.pending.get(request.instanceId)
    if (existing)
      return existing.promise

    let resolvePromise: (result: CommandCompletionResult) => void = () => undefined
    const promise = new Promise<CommandCompletionResult>(resolve => {
      resolvePromise = resolve
    })
    const completion: PendingStatusCompletion = {
      promise,
      request,
      resolve: resolvePromise,
      pollTimer: null,
      deadlineTimer: null,
    }
    this.pending.set(request.instanceId, completion)
    if (this.timeoutMs > 0) {
      completion.deadlineTimer = setTimeout(() => {
        this.settle(completion, {
          status: COMMAND_COMPLETION_STATUSES.Timeout,
          instanceId: request.instanceId,
          errorCode: 'FSM_COMMAND_COMPLETION_TIMEOUT',
          message: `FSM command ${request.actionType} did not reach a terminal status`,
        })
      }, this.timeoutMs)
    }
    void this.poll(completion)
    return promise
  }

  fail(instanceId: number, errorCode: string, message: string): void {
    const completion = this.pending.get(instanceId)
    if (completion) {
      this.settle(completion, {
        status: COMMAND_COMPLETION_STATUSES.Failed,
        instanceId,
        errorCode,
        message,
        failureKind: COMMAND_COMPLETION_FAILURE_KINDS.Execution,
      })
    }
  }

  cancelAll(): void {
    for (const completion of Array.from(this.pending.values())) {
      this.settle(completion, {
        status: COMMAND_COMPLETION_STATUSES.Cancelled,
        instanceId: completion.request.instanceId,
        errorCode: 'FSM_COMMAND_COMPLETION_CANCELLED',
        message: 'FSM command completion wait was cancelled',
      })
    }
  }

  private async poll(completion: PendingStatusCompletion): Promise<void> {
    if (this.pending.get(completion.request.instanceId) !== completion)
      return

    try {
      const result = await this.transport.getStatus(completion.request.instanceId)
      if (this.pending.get(completion.request.instanceId) !== completion)
        return
      if (result.status === FSM_COMMAND_EXECUTION_STATUSES.Completed) {
        this.settle(completion, {
          status: COMMAND_COMPLETION_STATUSES.Completed,
          instanceId: completion.request.instanceId,
        })
        return
      }
      if (result.status === FSM_COMMAND_EXECUTION_STATUSES.Failed) {
        this.settle(completion, {
          status: COMMAND_COMPLETION_STATUSES.Failed,
          instanceId: completion.request.instanceId,
          errorCode: result.errorCode,
          message: result.errorMessage,
          failureKind: COMMAND_COMPLETION_FAILURE_KINDS.Execution,
        })
        return
      }
    } catch (error) {
      if (this.pending.get(completion.request.instanceId) !== completion)
        return
      const normalized = normalizeBackendError(error)
      if (isTerminalStatusReadError(normalized)) {
        this.settle(completion, {
          status: COMMAND_COMPLETION_STATUSES.Failed,
          instanceId: completion.request.instanceId,
          errorCode: normalized.code,
          message: normalized.message,
          failureKind: COMMAND_COMPLETION_FAILURE_KINDS.StatusLookup,
        })
        return
      }
    }

    if (this.pending.get(completion.request.instanceId) !== completion)
      return

    completion.pollTimer = setTimeout(() => {
      completion.pollTimer = null
      void this.poll(completion)
    }, this.pollIntervalMs)
  }

  private settle(
    completion: PendingStatusCompletion,
    result: CommandCompletionResult,
  ): void {
    if (this.pending.get(completion.request.instanceId) !== completion)
      return
    this.pending.delete(completion.request.instanceId)
    if (completion.pollTimer)
      clearTimeout(completion.pollTimer)
    if (completion.deadlineTimer)
      clearTimeout(completion.deadlineTimer)
    completion.pollTimer = null
    completion.deadlineTimer = null
    completion.resolve(result)
  }
}

function isTerminalStatusReadError(error: BackendInteractionError): boolean {
  return /^FSM_COMMAND_STATUS_HTTP_4\d\d$/.test(error.code) ||
    error.code === 'FSM_COMMAND_STATUS_PROTOCOL_ERROR'
}

interface PendingCompletion {
  readonly promise: Promise<CommandCompletionResult>
  readonly request: CommandCompletionRequest
  readonly completedStates: readonly string[]
  readonly initiallyCompleted: boolean
  resolve(result: CommandCompletionResult): void
  unsubscribe: () => void
  timeout: ReturnType<typeof setTimeout> | null
}

/**
 * Temporary Snapshot-based completion mechanism.
 *
 * Kept only for environments where the FSM API is not configured. Production
 * completion uses CommandStatusDriverCommandCompletionWaiter.
 */
export class SnapshotDriverCommandCompletionWaiter implements DriverCommandCompletionWaiter {
  private readonly runtime: PlatformInterfaceRuntime
  private readonly timeoutMs: number
  private readonly pending = new Map<number, PendingCompletion>()

  constructor(runtime: PlatformInterfaceRuntime, timeoutMs = 60000) {
    this.runtime = runtime
    this.timeoutMs = Math.max(0, timeoutMs)
  }

  captureBaseline(orderId: IOrder['b_id']): CommandCompletionBaseline {
    return { state: findOrderState(this.runtime.getSnapshot(), orderId) }
  }

  wait(request: CommandCompletionRequest): Promise<CommandCompletionResult> {
    const existing = this.pending.get(request.instanceId)
    if (existing)
      return existing.promise

    const completedStates = getCompletedStates(request.actionType)
    const initiallyCompleted = request.baseline.state !== null &&
      completedStates.includes(request.baseline.state)
    let resolvePromise: (result: CommandCompletionResult) => void = () => undefined
    const promise = new Promise<CommandCompletionResult>(resolve => {
      resolvePromise = resolve
    })
    const completion: PendingCompletion = {
      promise,
      request,
      completedStates,
      initiallyCompleted,
      resolve: resolvePromise,
      unsubscribe: () => undefined,
      timeout: null,
    }
    this.pending.set(request.instanceId, completion)

    completion.unsubscribe = this.runtime.subscribeRuntime(() => {
      this.checkSnapshot(completion)
    })
    if (this.timeoutMs > 0) {
      completion.timeout = setTimeout(() => {
        this.settle(completion, {
          status: COMMAND_COMPLETION_STATUSES.Timeout,
          instanceId: request.instanceId,
          errorCode: 'FSM_COMMAND_COMPLETION_TIMEOUT',
          message: `FSM command ${request.actionType} was accepted but its transition was not observed`,
        })
      }, this.timeoutMs)
    }
    this.checkSnapshot(completion)

    return promise
  }

  fail(instanceId: number, errorCode: string, message: string): void {
    const completion = this.pending.get(instanceId)
    if (!completion)
      return
    this.settle(completion, {
      status: COMMAND_COMPLETION_STATUSES.Failed,
      instanceId,
      errorCode,
      message,
      failureKind: COMMAND_COMPLETION_FAILURE_KINDS.Execution,
    })
  }

  cancelAll(): void {
    for (const completion of Array.from(this.pending.values())) {
      this.settle(completion, {
        status: COMMAND_COMPLETION_STATUSES.Cancelled,
        instanceId: completion.request.instanceId,
        errorCode: 'FSM_COMMAND_COMPLETION_CANCELLED',
        message: 'FSM command completion wait was cancelled',
      })
    }
  }

  private checkSnapshot(completion: PendingCompletion): void {
    if (completion.initiallyCompleted)
      return
    const state = findOrderState(
      this.runtime.getSnapshot(),
      completion.request.orderId,
    )
    if (state && completion.completedStates.includes(state)) {
      this.settle(completion, {
        status: COMMAND_COMPLETION_STATUSES.Completed,
        instanceId: completion.request.instanceId,
      })
    }
  }

  private settle(
    completion: PendingCompletion,
    result: CommandCompletionResult,
  ): void {
    if (this.pending.get(completion.request.instanceId) !== completion)
      return
    this.pending.delete(completion.request.instanceId)
    completion.unsubscribe()
    if (completion.timeout)
      clearTimeout(completion.timeout)
    completion.timeout = null
    completion.resolve(result)
  }
}

function getCompletedStates(actionType: string): readonly string[] {
  switch (actionType) {
    case 'driver.order.arrive':
      return ['order_driver_arrived', 'order_in_ride', 'order_completed']
    case 'driver.order.start':
    case 'driver.order.confirm_boarding':
      return ['order_in_ride', 'order_completed']
    case 'driver.order.finish':
      return ['order_completed']
    case 'driver.order.cancel':
      return ['order_cancelled', 'ride_interrupted']
    default:
      throw new Error(`Unsupported Driver lifecycle action: ${actionType}`)
  }
}

function findOrderState(
  snapshot: PlatformSnapshot | null,
  orderId: IOrder['b_id'],
): string | null {
  const state = snapshot?.state as {
    readonly domainOrder?: {
      readonly snapshot?: { readonly orderId?: unknown, readonly state?: unknown }
    }
    readonly domainDriver?: {
      readonly snapshot?: FsmDriverAggregateSnapshot
    }
  } | undefined
  const domainOrder = state?.domainOrder?.snapshot
  if (
    domainOrder &&
    String(domainOrder.orderId) === String(orderId) &&
    typeof domainOrder.state === 'string'
  )
    return domainOrder.state

  const driver = state?.domainDriver?.snapshot?.driver
  const cards = [
    ...(driver?.readyOrders ?? []),
    ...(driver?.activeOrders ?? []),
    ...(driver?.historyOrders ?? []),
    ...(driver?.currentTrip ? [driver.currentTrip] : []),
  ]
  const order = cards.find(card => String(card.orderId) === String(orderId))
  return typeof order?.state === 'string' ? order.state : null
}

interface FsmDriverAggregateSnapshot {
  readonly driver?: {
    readonly readyOrders?: readonly FsmDriverStateCard[]
    readonly activeOrders?: readonly FsmDriverStateCard[]
    readonly historyOrders?: readonly FsmDriverStateCard[]
    readonly currentTrip?: FsmDriverStateCard | null
  }
}

interface FsmDriverStateCard {
  readonly orderId?: unknown
  readonly state?: unknown
}
