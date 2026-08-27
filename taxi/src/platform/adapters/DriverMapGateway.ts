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
  DriverCommandCompletionWaiter,
  SnapshotDriverCommandCompletionWaiter,
} from './DriverCommandCompletionWaiter'

export const DRIVER_MAP_ACTIONS = {
  Arrive: 'driver.order.arrive',
  Start: 'driver.order.start',
  ConfirmBoarding: 'driver.order.confirm_boarding',
  Finish: 'driver.order.finish',
  OpenCard: 'driver.order.card.open',
  RequestAreas: 'driver.route.areas.request',
} as const

export const DRIVER_MAP_EVENTS = {
  CommandAccepted: 'driver.order.command.accepted',
  Arrived: 'driver.order.arrived',
  Started: 'driver.order.started',
  BoardingConfirmed: 'driver.order.boarding_confirmed',
  Finished: 'driver.order.finished',
  CardOpened: 'driver.order.card.opened',
  AreasRequested: 'driver.route.areas.requested',
  Failed: 'driver.order.action.failed',
} as const

interface DriverOrderActionPayload {
  readonly orderId: IOrder['b_id']
  readonly voting?: boolean
  readonly updateState?: boolean
  readonly tolerateNotAppointed?: boolean
  readonly boardingCode?: string
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
  private stopHandler: Unsubscribe | null = null

  constructor(
    runtime: PlatformInterfaceRuntime = platformInterface.runtime,
    commandTransport: TaxiCommandTransport | null = createConfiguredFsmTaxiCommandTransport(),
    completionTimeoutMs = 60000,
    completionWaiter?: DriverCommandCompletionWaiter,
  ) {
    this.runtime = runtime
    this.commandTransport = commandTransport
    this.completionWaiter = completionWaiter ??
      new SnapshotDriverCommandCompletionWaiter(runtime, completionTimeoutMs)
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
      if (this.mountCount === 0 && this.stopHandler) {
        this.stopHandler()
        this.stopHandler = null
        this.completionWaiter.cancelAll()
      }
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

  private dispatch<TPayload>(type: string, payload: TPayload): Promise<void> {
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
    if (this.commandTransport && isDriverLifecycleAction(type)) {
      return this.dispatchServerLifecycle(
        action,
        payload as unknown as DriverOrderActionPayload,
      )
    }
    return this.dispatchAndWaitForEvent(action, this.successEventFor(type))
  }

  private dispatchAndWaitForEvent(
    action: InteractionAction,
    completionType: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.runtime.subscribe(event => {
        if (event.metadata?.correlationId !== action.metadata?.correlationId)
          return
        if (event.type === completionType) {
          unsubscribe()
          resolve()
          return
        }
        if (event.type === DRIVER_MAP_EVENTS.Failed) {
          unsubscribe()
          const failure = event.payload as DriverMapFailurePayload
          reject(new BackendInteractionError(failure.code, failure.message, failure))
        }
      })

      void this.runtime.dispatch(action).catch(error => {
        unsubscribe()
        reject(normalizeBackendError(error))
      })
    })
  }

  private async dispatchServerLifecycle(
    action: InteractionAction,
    payload: DriverOrderActionPayload,
  ): Promise<void> {
    const baseline = this.completionWaiter.captureBaseline(payload.orderId)
    const accepted = await new Promise<DriverCommandAcceptedPayload>((resolve, reject) => {
      const unsubscribeEvents = this.runtime.subscribe(event => {
        if (event.metadata?.correlationId !== action.metadata?.correlationId)
          return
        if (event.type === DRIVER_MAP_EVENTS.CommandAccepted) {
          unsubscribeEvents()
          resolve(event.payload as DriverCommandAcceptedPayload)
          return
        }
        if (event.type === DRIVER_MAP_EVENTS.Failed) {
          unsubscribeEvents()
          const failure = event.payload as DriverMapFailurePayload
          reject(new BackendInteractionError(failure.code, failure.message, failure))
        }
      })
      void this.runtime.dispatch(action).catch(error => {
        unsubscribeEvents()
        reject(normalizeBackendError(error))
      })
    })

    const result = await this.completionWaiter.wait({
      actionType: action.type,
      orderId: payload.orderId,
      instanceId: accepted.instanceId,
      baseline,
    })
    if (result.status === COMMAND_COMPLETION_STATUSES.Completed) {
      // Тот же событийный контракт, что и в legacy-режиме: подписчик узнаёт об
      // успешном переходе одинаково, независимо от того, ждали мы бэкенд
      // напрямую или через Command Status API. Событие публикуется ПОСЛЕ
      // терминального результата команды, поэтому «выполнено» здесь не аванс.
      this.publish(action, this.successEventFor(action.type), { orderId: payload.orderId })
      return
    }

    const error = new BackendInteractionError(
      result.errorCode ?? 'FSM_COMMAND_COMPLETION_FAILED',
      result.message ?? `FSM command ${action.type} did not complete`,
      { actionType: action.type, orderId: payload.orderId, instanceId: accepted.instanceId },
    )
    this.publish(action, DRIVER_MAP_EVENTS.Failed, {
      actionType: action.type,
      orderId: payload.orderId,
      code: error.code,
      message: error.message,
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
      case DRIVER_MAP_ACTIONS.OpenCard: return DRIVER_MAP_EVENTS.CardOpened
      case DRIVER_MAP_ACTIONS.RequestAreas: return DRIVER_MAP_EVENTS.AreasRequested
      default: throw new Error(`Unsupported Driver Map action: ${actionType}`)
    }
  }

  private async handleAction(action: InteractionAction): Promise<void> {
    if (!isDriverMapAction(action.type))
      return

    try {
      if (this.commandTransport && isDriverLifecycleAction(action.type)) {
        const payload = action.payload as DriverOrderActionPayload
        const commandPayload = action.type === DRIVER_MAP_ACTIONS.ConfirmBoarding ?
          { boardingCode: payload.boardingCode ?? '' } :
          {}
        const accepted = await this.commandTransport.send(
          payload.orderId,
          action.type,
          commandPayload,
          action.metadata,
        )
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
  ]
  return lifecycleActions.includes(type)
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
