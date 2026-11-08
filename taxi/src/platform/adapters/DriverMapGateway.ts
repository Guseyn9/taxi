import { verifyFsmReconciliation } from './fsmReconciliation'
import type {
  InteractionAction,
  InteractionEvent,
  Unsubscribe,
} from '../interaction-contract'
import type {
  PlatformInterfaceRuntime,
} from '../platform-interface'
import { platformInterface } from '../platform-interface'
import type {
  IAddressPoint,
  IOrder,
  IRouteInfo,
} from '../../types/types'
import type { IWayGraph } from '../../tools/maps'
import { EBookingDriverState } from '../../types/types'
import { backendGateway } from './LegacyBackendGateway'
import {
  assertSuccessfulBackendResponse,
  BackendInteractionError,
  normalizeBackendError,
} from './backendError'
import { legacyRouteProvider } from './LegacyRouteProvider'
import {
  createConfiguredFsmTaxiCommandTransport,
  TaxiCommandTransport,
} from './FsmTaxiCommandTransport'
import {
  COMMAND_COMPLETION_STATUSES,
  CommandCompletionFailureKind,
  CommandStatusDriverCommandCompletionWaiter,
  DriverCommandCompletionWaiter,
  SnapshotDriverCommandCompletionWaiter,
} from './DriverCommandCompletionWaiter'
import {
  configuredCommandStatusPollInterval,
  createConfiguredFsmCommandStatusTransport,
} from './FsmCommandStatusTransport'
import { getSessionRecoveryId } from '../../security/sessionTokens'
import { DriverCommandRecovery, CommandRecoveryScope, DriverCommandRecoveryOptions } from './DriverCommandRecovery'

export const DRIVER_MAP_ACTIONS = {
  Arrive: 'driver.order.arrive',
  Start: 'driver.order.start',
  ConfirmBoarding: 'driver.order.confirm_boarding',
  Finish: 'driver.order.finish',
  Cancel: 'driver.order.cancel',
  OpenCard: 'driver.order.card.open',
  RequestAreas: 'driver.route.areas.request',
} as const

export const DRIVER_MAP_EVENTS = {
  CommandAccepted: 'driver.order.command.accepted',
  Arrived: 'driver.order.arrived',
  Started: 'driver.order.started',
  BoardingConfirmed: 'driver.order.boarding_confirmed',
  Finished: 'driver.order.finished',
  Cancelled: 'driver.order.cancelled',
  CardOpened: 'driver.order.card.opened',
  AreasRequested: 'driver.route.areas.requested',
  Failed: 'driver.order.action.failed',
  RecoveryChecked: 'driver.order.command.recovery_checked',
} as const

interface DriverOrderActionPayload {
  readonly orderId: IOrder['b_id']
  readonly voting?: boolean
  readonly updateState?: boolean
  readonly tolerateNotAppointed?: boolean
  readonly boardingCode?: string
  readonly reason?: string
}

export interface DriverArriveOptions {
  readonly voting?: boolean
  readonly updateState?: boolean
  readonly tolerateNotAppointed?: boolean
}

interface DriverRouteAreasPayload {
  readonly points: readonly [number, number][]
}

export interface DriverMapFailurePayload {
  readonly actionType: string
  readonly orderId?: IOrder['b_id']
  readonly code: string
  readonly message: string
  readonly failureKind?: CommandCompletionFailureKind
}

export interface DriverCommandAcceptedPayload {
  readonly actionType: string
  readonly orderId: IOrder['b_id']
  readonly instanceId: number
  readonly status: string
  readonly intent: string
  readonly duplicate: boolean
}

const isDriverMapAction = (type: string) =>
  Object.values(DRIVER_MAP_ACTIONS).includes(type as typeof DRIVER_MAP_ACTIONS[keyof typeof DRIVER_MAP_ACTIONS])

/** Existing backend implementation behind Interaction Contract actions. */
export class DriverMapGateway {
  private readonly runtime: PlatformInterfaceRuntime
  private readonly commandTransport: TaxiCommandTransport | null
  private readonly completionWaiter: DriverCommandCompletionWaiter
  private mountCount = 0
  private inFlight = 0
  private readonly eventTimeoutMs: number
  private stopHandler: Unsubscribe | null = null
  private recoveryUserId: string | null = null
  private sendingOrders = new Set<string>()
  private actionRoutes = new Map<string, boolean>()
  private actionScopes = new Map<string, CommandRecoveryScope | null>()
  readonly recovery: DriverCommandRecovery | null

  constructor(
    runtime: PlatformInterfaceRuntime = platformInterface.runtime,
    commandTransport: TaxiCommandTransport | null = createConfiguredFsmTaxiCommandTransport(),
    completionTimeoutMs = 60000,
    completionWaiter?: DriverCommandCompletionWaiter,
    recoveryOptions?: DriverCommandRecoveryOptions | null,
  ) {
    this.eventTimeoutMs = Number.isFinite(completionTimeoutMs) && completionTimeoutMs > 0 ? Math.min(completionTimeoutMs, 15000) : 15000
    this.runtime = runtime
    this.commandTransport = commandTransport
    this.completionWaiter = completionWaiter ?? createDefaultCompletionWaiter(
      runtime,
      completionTimeoutMs,
    )
    const options = recoveryOptions === undefined ? process.env.REACT_APP_FSM_API_URL?.trim() ? {
      verifyReconciliation: (command: {orderId: string}) => verifyFsmReconciliation(process.env.REACT_APP_FSM_API_URL!.trim(), command.orderId),
      scope: () => {
        const service = process.env.REACT_APP_FSM_API_URL?.trim().replace(/\/+$/, '')
        const sessionId = getSessionRecoveryId()
        return service && sessionId && this.recoveryUserId ? { service, sessionId, userId: this.recoveryUserId } : null
      },
    } : null : recoveryOptions
    this.recovery = commandTransport && this.completionWaiter.supportsInstanceRecovery && options ?
      new DriverCommandRecovery(this.completionWaiter, { ...options, onRecovered: (command, result) => {
        // Recovered metadata never advances local trip state. Query refresh owns it.
        this.runtime.publish({ type: DRIVER_MAP_EVENTS.RecoveryChecked,
          payload: { orderId: command.orderId, instanceId: command.instanceId, status: result.status, failureKind: result.failureKind },
          metadata: { source: 'driver.command.recovery', timestamp: new Date().toISOString() } })
        options.onRecovered?.(command, result)
      } }) : null
  }

  setRecoveryIdentity(userId: string | number | null): void {
    this.recoveryUserId = userId === null ? null : String(userId)
    this.recovery?.activate()
  }

  mount(): Unsubscribe {
    this.mountCount += 1
    this.ensureHandler()

    let unmounted = false
    return () => {
      if (unmounted)
        return
      unmounted = true
      this.mountCount = Math.max(0, this.mountCount - 1)
      this.releaseIdleHandler()
    }
  }

  subscribe(listener: (event: InteractionEvent) => void): Unsubscribe {
    return this.runtime.subscribe(listener)
  }

  arrive(
    orderId: IOrder['b_id'],
    options: boolean | DriverArriveOptions = {},
  ): Promise<void> {
    const normalizedOptions = typeof options === 'boolean' ? { voting: options } : options
    return this.dispatch(DRIVER_MAP_ACTIONS.Arrive, {
      orderId,
      updateState: true,
      ...normalizedOptions,
    })
  }

  start(orderId: IOrder['b_id']): Promise<void> {
    return this.dispatch(DRIVER_MAP_ACTIONS.Start, { orderId })
  }

  confirmBoarding(
    orderId: IOrder['b_id'],
    boardingCode: string,
    updateState = true,
  ): Promise<void> {
    return this.dispatch(DRIVER_MAP_ACTIONS.ConfirmBoarding, {
      orderId,
      boardingCode,
      updateState,
    })
  }

  finish(orderId: IOrder['b_id']): Promise<void> {
    return this.dispatch(DRIVER_MAP_ACTIONS.Finish, { orderId })
  }

  cancel(orderId: IOrder['b_id'], reason?: string): Promise<void> {
    return this.dispatch(DRIVER_MAP_ACTIONS.Cancel, { orderId, reason })
  }

  openCard(orderId: IOrder['b_id']): Promise<void> {
    return this.dispatch(DRIVER_MAP_ACTIONS.OpenCard, { orderId })
  }

  requestAreas(points: readonly [number, number][]): Promise<void> {
    return this.dispatch(DRIVER_MAP_ACTIONS.RequestAreas, { points })
  }

  reverseGeocode(...args: Parameters<typeof backendGateway.reverseGeocode>) {
    return backendGateway.reverseGeocode(...args)
  }

  makeRoutePoints(
    from: IAddressPoint,
    to: IAddressPoint,
    wayGraph?: IWayGraph,
  ): Promise<IRouteInfo> {
    return legacyRouteProvider.makeRoutePoints(from, to, wayGraph)
  }

  private async dispatch<TPayload>(type: string, payload: TPayload): Promise<void> {
    const lifecycleAction = isDriverLifecycleAction(type)
    const orderId = lifecycleAction ? String((payload as unknown as DriverOrderActionPayload).orderId) : ''
    const assertNoPending = () => {
      if (!lifecycleAction) return
      if (this.sendingOrders.has(orderId)) throw new BackendInteractionError('FSM_COMMAND_PENDING', 'This order already has an action in progress.')
      this.recovery?.assertCanSend(orderId)
    }
    assertNoPending()
    const lifecycle = this.canUseFsm(type) && (this.commandTransport?.resolveEnabled ? await this.commandTransport.resolveEnabled(serverIntentFor(type)) : true)
    assertNoPending() // A command may have been accepted while reading rollout settings.
    let scope: CommandRecoveryScope | null = null
    if (lifecycle) {
      try {
        if (this.sendingOrders.has(orderId)) throw new BackendInteractionError('FSM_COMMAND_PENDING', 'This order already has an action in progress.')
        this.recovery?.assertCanSend(orderId)
        scope = this.recovery?.captureScope() || null
        if (this.recovery && !scope) throw new BackendInteractionError('FSM_COMMAND_SESSION_CHANGED', 'An authenticated driver session is required before sending an action.')
      } catch (error) { return Promise.reject(error) }
      this.sendingOrders.add(orderId)
    }
    this.ensureHandler()
    const action: InteractionAction<TPayload> = {
      type,
      payload,
      metadata: {
        source: 'driver.interface',
        timestamp: new Date().toISOString(),
        correlationId: createCorrelationId(),
      },
    }
    this.actionRoutes.set(action.metadata!.correlationId!, lifecycle)
    if (lifecycle) this.actionScopes.set(action.metadata!.correlationId!, scope)
    this.inFlight += 1
    const result = lifecycle ?
      this.dispatchServerLifecycle(action, payload as unknown as DriverOrderActionPayload) :
      this.dispatchAndWaitForEvent<void>(action, this.successEventFor(type), () => undefined)
    return result.finally(() => {
      if (lifecycle) { this.sendingOrders.delete(orderId); this.actionScopes.delete(action.metadata!.correlationId!) }
      this.actionRoutes.delete(action.metadata!.correlationId!)
      this.inFlight -= 1
      this.releaseIdleHandler()
    })
  }

  private releaseIdleHandler(): void {
    // An accepted command belongs to the app, not to the currently mounted map.
    if (this.mountCount === 0 && this.inFlight === 0 && this.stopHandler) {
      this.stopHandler()
      this.stopHandler = null
    }
  }

  private dispatchAndWaitForEvent<T>(
    action: InteractionAction,
    completionType: string,
    read: (event: InteractionEvent) => T,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false
      let unsubscribe: Unsubscribe = () => undefined
      const settle = (error?: unknown, value?: T) => {
        if (settled) return
        settled = true
        clearTimeout(deadline)
        unsubscribe()
        if (error) reject(normalizeBackendError(error))
        else resolve(value as T)
      }
      const deadline = setTimeout(() => settle(new BackendInteractionError(
        'DRIVER_EVENT_TIMEOUT', 'The result is unknown. Refresh the order before trying again.',
        { actionType: action.type, correlationId: action.metadata?.correlationId },
      )), this.eventTimeoutMs)
      unsubscribe = this.runtime.subscribe(event => {
        if (event.metadata?.correlationId !== action.metadata?.correlationId) return
        if (event.type === completionType) settle(undefined, read(event))
        else if (event.type === DRIVER_MAP_EVENTS.Failed) {
          const failure = event.payload as DriverMapFailurePayload
          settle(new BackendInteractionError(failure.code, failure.message, failure))
        }
      })
      if (settled) unsubscribe()
      Promise.resolve().then(() => this.runtime.dispatch(action)).catch(error => settle(error))
    })
  }

  private async dispatchServerLifecycle(
    action: InteractionAction,
    payload: DriverOrderActionPayload,
  ): Promise<void> {
    const baseline = this.completionWaiter.captureBaseline(payload.orderId)
    const accepted = await this.dispatchAndWaitForEvent<DriverCommandAcceptedPayload>(
      action, DRIVER_MAP_EVENTS.CommandAccepted, event => event.payload as DriverCommandAcceptedPayload,
    )

    const result = await this.completionWaiter.wait({
      actionType: action.type,
      orderId: payload.orderId,
      instanceId: accepted.instanceId,
      baseline,
    })
    const scope = this.actionScopes.get(action.metadata!.correlationId!) || null
    this.recovery?.settle(accepted.instanceId, result, scope)
    if (scope && !this.recovery?.isCurrent(scope)) throw new BackendInteractionError('FSM_COMMAND_SESSION_CHANGED', 'The session changed while checking the action.')
    if (result.status === COMMAND_COMPLETION_STATUSES.Completed) {
      // Тот же событийный контракт, что и в legacy-режиме: подписчик узнаёт об
      // успешном переходе одинаково, независимо от того, ждали мы бэкенд
      // напрямую или через Command Status API. Событие публикуется ПОСЛЕ
      // терминального результата команды, поэтому «выполнено» здесь не аванс.
      this.publish(action, this.successEventFor(action.type), { orderId: payload.orderId })
      return
    }

    if (result.status === COMMAND_COMPLETION_STATUSES.Cancelled) {
      throw new BackendInteractionError(
        result.errorCode ?? 'FSM_COMMAND_COMPLETION_CANCELLED',
        result.message ?? `FSM command ${action.type} completion wait was cancelled`,
        {
          actionType: action.type,
          orderId: payload.orderId,
          instanceId: accepted.instanceId,
          cancelled: true,
        },
      )
    }

    const error = new BackendInteractionError(
      result.errorCode ?? 'FSM_COMMAND_COMPLETION_FAILED',
      result.message ?? `FSM command ${action.type} did not complete`,
      {
        actionType: action.type,
        orderId: payload.orderId,
        instanceId: accepted.instanceId,
        failureKind: result.failureKind,
      },
    )
    this.publish(action, DRIVER_MAP_EVENTS.Failed, {
      actionType: action.type,
      orderId: payload.orderId,
      code: error.code,
      message: error.message,
      failureKind: result.failureKind,
    } satisfies DriverMapFailurePayload)
    throw error
  }

  private ensureHandler(): void {
    if (!this.stopHandler)
      this.stopHandler = this.runtime.registerHandler(action => this.handleAction(action))
  }

  private successEventFor(actionType: string): string {
    switch (actionType) {
      case DRIVER_MAP_ACTIONS.Arrive: return DRIVER_MAP_EVENTS.Arrived
      case DRIVER_MAP_ACTIONS.Start: return DRIVER_MAP_EVENTS.Started
      case DRIVER_MAP_ACTIONS.ConfirmBoarding: return DRIVER_MAP_EVENTS.BoardingConfirmed
      case DRIVER_MAP_ACTIONS.Finish: return DRIVER_MAP_EVENTS.Finished
      case DRIVER_MAP_ACTIONS.Cancel: return DRIVER_MAP_EVENTS.Cancelled
      case DRIVER_MAP_ACTIONS.OpenCard: return DRIVER_MAP_EVENTS.CardOpened
      case DRIVER_MAP_ACTIONS.RequestAreas: return DRIVER_MAP_EVENTS.AreasRequested
      default: throw new Error(`Unsupported Driver Map action: ${actionType}`)
    }
  }

  private async handleAction(action: InteractionAction): Promise<void> {
    if (!isDriverMapAction(action.type))
      return

    try {
      const selectedRoute = this.actionRoutes.get(action.metadata?.correlationId || '')
      const useFsm = selectedRoute ?? (this.canUseFsm(action.type) &&
        (this.commandTransport?.resolveEnabled ? await this.commandTransport.resolveEnabled(serverIntentFor(action.type)) : true))
      if (this.commandTransport && useFsm) {
        const payload = action.payload as DriverOrderActionPayload
        const commandPayload = action.type === DRIVER_MAP_ACTIONS.ConfirmBoarding ?
          { boardingCode: payload.boardingCode ?? '' } :
          action.type === DRIVER_MAP_ACTIONS.Cancel ?
            { reason: payload.reason ?? '' } :
            {}
        const accepted = await this.commandTransport.send(
          payload.orderId,
          serverIntentFor(action.type),
          commandPayload,
          action.metadata,
        )
        const scope = this.actionScopes.get(action.metadata!.correlationId!) || null
        if (scope && !this.recovery?.isCurrent(scope)) throw new BackendInteractionError('FSM_COMMAND_SESSION_CHANGED', 'The session changed while accepting the action.')
        this.recovery?.remember({ actionType: action.type, orderId: payload.orderId, instanceId: accepted.instanceId, baseline: { state: null } }, scope)
        this.publish(action, DRIVER_MAP_EVENTS.CommandAccepted, {
          actionType: action.type,
          orderId: payload.orderId,
          instanceId: accepted.instanceId,
          status: accepted.status,
          intent: accepted.intent,
          duplicate: accepted.duplicate,
        } satisfies DriverCommandAcceptedPayload)
        return
      }

      switch (action.type) {
        case DRIVER_MAP_ACTIONS.Arrive: {
          const payload = action.payload as DriverOrderActionPayload
          if (payload.updateState !== false) {
            try {
              assertSuccessfulBackendResponse(
                await backendGateway.setOrderState(payload.orderId, EBookingDriverState.Arrived),
              )
            } catch (error) {
              if (!payload.tolerateNotAppointed || !isNotAppointedPerformerError(error))
                throw error
            }
          }
          if (payload.voting) {
            try {
              assertSuccessfulBackendResponse(
                await backendGateway.arrivedVotingOrder(payload.orderId),
              )
            } catch (error) {
              if (!payload.tolerateNotAppointed || !isNotAppointedPerformerError(error))
                throw error
            }
          }
          this.publish(action, DRIVER_MAP_EVENTS.Arrived, { orderId: payload.orderId })
          break
        }
        case DRIVER_MAP_ACTIONS.Start: {
          const payload = action.payload as DriverOrderActionPayload
          assertSuccessfulBackendResponse(
            await backendGateway.setOrderState(payload.orderId, EBookingDriverState.Started),
          )
          this.publish(action, DRIVER_MAP_EVENTS.Started, { orderId: payload.orderId })
          break
        }
        case DRIVER_MAP_ACTIONS.ConfirmBoarding: {
          const payload = action.payload as DriverOrderActionPayload
          assertSuccessfulBackendResponse(
            await backendGateway.confirmVotingCode(payload.orderId, payload.boardingCode ?? ''),
          )
          if (payload.updateState !== false) {
            assertSuccessfulBackendResponse(
              await backendGateway.setOrderState(
                payload.orderId,
                EBookingDriverState.Started,
                payload.boardingCode,
              ),
            )
          }
          this.publish(action, DRIVER_MAP_EVENTS.BoardingConfirmed, { orderId: payload.orderId })
          break
        }
        case DRIVER_MAP_ACTIONS.Finish: {
          const payload = action.payload as DriverOrderActionPayload
          assertSuccessfulBackendResponse(
            await backendGateway.setOrderState(payload.orderId, EBookingDriverState.Finished),
          )
          this.publish(action, DRIVER_MAP_EVENTS.Finished, { orderId: payload.orderId })
          break
        }
        case DRIVER_MAP_ACTIONS.Cancel: {
          const payload = action.payload as DriverOrderActionPayload
          assertSuccessfulBackendResponse(
            await backendGateway.cancelDrive(payload.orderId, payload.reason),
          )
          this.publish(action, DRIVER_MAP_EVENTS.Cancelled, { orderId: payload.orderId })
          break
        }
        case DRIVER_MAP_ACTIONS.OpenCard: {
          const payload = action.payload as DriverOrderActionPayload
          this.publish(action, DRIVER_MAP_EVENTS.CardOpened, { orderId: payload.orderId })
          break
        }
        case DRIVER_MAP_ACTIONS.RequestAreas: {
          const payload = action.payload as DriverRouteAreasPayload
          this.publish(action, DRIVER_MAP_EVENTS.AreasRequested, { points: payload.points })
          break
        }
      }
    } catch (error) {
      const normalized = normalizeBackendError(error)
      const payload = action.payload as Partial<DriverOrderActionPayload> | undefined
      this.publish(action, DRIVER_MAP_EVENTS.Failed, {
        actionType: action.type,
        orderId: payload?.orderId,
        code: normalized.code,
        message: normalized.message,
      } satisfies DriverMapFailurePayload)
    }
  }

  private canUseFsm(type: string): boolean {
    return Boolean(this.commandTransport && isDriverLifecycleAction(type) && this.commandTransport.supports?.(serverIntentFor(type)) !== false)
  }

  private publish<TPayload>(
    action: InteractionAction,
    type: string,
    payload: TPayload,
  ): void {
    this.runtime.publish({
      type,
      payload,
      metadata: {
        source: 'driver.application',
        timestamp: new Date().toISOString(),
        correlationId: action.metadata?.correlationId,
      },
    })
  }
}

function isDriverLifecycleAction(type: string): boolean {
  const lifecycleActions: readonly string[] = [
    DRIVER_MAP_ACTIONS.Arrive,
    DRIVER_MAP_ACTIONS.Start,
    DRIVER_MAP_ACTIONS.ConfirmBoarding,
    DRIVER_MAP_ACTIONS.Finish,
    DRIVER_MAP_ACTIONS.Cancel,
  ]
  return lifecycleActions.includes(type)
}

function createDefaultCompletionWaiter(
  runtime: PlatformInterfaceRuntime,
  timeoutMs: number,
): DriverCommandCompletionWaiter {
  const statusTransport = createConfiguredFsmCommandStatusTransport()
  return statusTransport ?
    new CommandStatusDriverCommandCompletionWaiter(
      statusTransport,
      timeoutMs,
      configuredCommandStatusPollInterval(),
    ) :
    new SnapshotDriverCommandCompletionWaiter(runtime, timeoutMs)
}

function serverIntentFor(actionType: string): string {
  return actionType === DRIVER_MAP_ACTIONS.Cancel ? 'driver_cancel_requested' : actionType
}

function createCorrelationId(): string {
  return `driver-map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isNotAppointedPerformerError(error: unknown): boolean {
  const normalized = normalizeBackendError(error)
  return [normalized.message, normalized.details]
    .map(value => typeof value === 'string' ? value : JSON.stringify(value))
    .join(' ')
    .toLowerCase()
    .includes('not appointed performer')
}

export const driverMapGateway = new DriverMapGateway()
