import type {
  InteractionAction,
  InteractionEvent,
  Unsubscribe,
} from '../interaction-contract'
import type { PlatformInterfaceRuntime } from '../platform-interface'
import {
  PASSENGER_ACTIONS,
  platformInterface,
} from '../platform-interface'
import { EBookingDriverState } from '../../types/types'
import { backendGateway } from './LegacyBackendGateway'
import {
  BackendInteractionError,
  normalizeBackendError,
} from './backendError'

export const PASSENGER_EVENTS = {
  CommandCompleted: 'passenger.command.completed',
  CommandFailed: 'passenger.command.failed',
} as const

interface PassengerCommandPayload {
  readonly args: readonly unknown[]
}

interface PassengerCommandCompletedPayload {
  readonly actionType: string
  readonly result: unknown
}

interface PassengerCommandFailedPayload {
  readonly actionType: string
  readonly code: string
  readonly message: string
}

const MUTATION_ACTIONS = new Set<string>([
  PASSENGER_ACTIONS.CreateOrder,
  PASSENGER_ACTIONS.CancelOrder,
  PASSENGER_ACTIONS.SelectCandidate,
  PASSENGER_ACTIONS.ReleaseCandidate,
  PASSENGER_ACTIONS.UpdateWaitingTime,
  PASSENGER_ACTIONS.UpdateCustomerPrice,
  PASSENGER_ACTIONS.CompleteRide,
])

/**
 * Passenger outgoing port backed by the legacy API during migration.
 * UI mutations enter PI as Actions; only this adapter handler knows the old API.
 */
export class LegacyPassengerGateway {
  private readonly runtime: PlatformInterfaceRuntime
  private stopHandler: Unsubscribe | null = null

  readonly geocode = backendGateway.geocode
  readonly reverseGeocode = backendGateway.reverseGeocode
  readonly getOrder = backendGateway.getOrder
  readonly getUser = backendGateway.getUser
  readonly getUsers = backendGateway.getUsers
  readonly getCar = backendGateway.getCar
  readonly getCars = backendGateway.getCars

  constructor(runtime: PlatformInterfaceRuntime = platformInterface.runtime) {
    this.runtime = runtime
  }

  createOrder(...args: Parameters<typeof backendGateway.postDrive>) {
    return this.dispatch<Awaited<ReturnType<typeof backendGateway.postDrive>>>(
      PASSENGER_ACTIONS.CreateOrder,
      args,
    )
  }

  cancelOrder(...args: Parameters<typeof backendGateway.cancelDrive>) {
    return this.dispatch<Awaited<ReturnType<typeof backendGateway.cancelDrive>>>(
      PASSENGER_ACTIONS.CancelOrder,
      args,
    )
  }

  selectCandidate(...args: Parameters<typeof backendGateway.chooseCandidate>) {
    return this.dispatch<Awaited<ReturnType<typeof backendGateway.chooseCandidate>>>(
      PASSENGER_ACTIONS.SelectCandidate,
      args,
    )
  }

  releaseCandidate(...args: Parameters<typeof backendGateway.releaseCandidateChoice>) {
    return this.dispatch<Awaited<ReturnType<typeof backendGateway.releaseCandidateChoice>>>(
      PASSENGER_ACTIONS.ReleaseCandidate,
      args,
    )
  }

  updateWaitingTime(...args: Parameters<typeof backendGateway.setWaitingTime>) {
    return this.dispatch<Awaited<ReturnType<typeof backendGateway.setWaitingTime>>>(
      PASSENGER_ACTIONS.UpdateWaitingTime,
      args,
    )
  }

  updateCustomerPrice(...args: Parameters<typeof backendGateway.updateOrderCustomerPrice>) {
    return this.dispatch<Awaited<ReturnType<typeof backendGateway.updateOrderCustomerPrice>>>(
      PASSENGER_ACTIONS.UpdateCustomerPrice,
      args,
    )
  }

  completeRide(orderId: Parameters<typeof backendGateway.setOrderState>[0]) {
    return this.dispatch<Awaited<ReturnType<typeof backendGateway.setOrderState>>>(
      PASSENGER_ACTIONS.CompleteRide,
      [orderId],
    )
  }

  private async dispatch<TResult>(actionType: string, args: readonly unknown[]): Promise<TResult> {
    this.ensureHandler()
    const correlationId = `passenger-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const response = new Promise<TResult>((resolve, reject) => {
      const unsubscribe = this.runtime.subscribe(event => {
        if (event.metadata?.correlationId !== correlationId)
          return

        if (event.type === PASSENGER_EVENTS.CommandCompleted) {
          unsubscribe()
          resolve((event.payload as PassengerCommandCompletedPayload).result as TResult)
          return
        }

        if (event.type === PASSENGER_EVENTS.CommandFailed) {
          unsubscribe()
          const failure = event.payload as PassengerCommandFailedPayload
          reject(new BackendInteractionError(failure.code, failure.message, failure))
        }
      })
    })

    const action: InteractionAction<PassengerCommandPayload> = {
      type: actionType,
      payload: { args },
      metadata: {
        source: 'passenger.interface',
        timestamp: new Date().toISOString(),
        correlationId,
      },
    }

    await Promise.all([this.runtime.dispatch(action), response])
    return response
  }

  private ensureHandler(): void {
    if (!this.stopHandler)
      this.stopHandler = this.runtime.registerHandler(action => this.handleAction(action))
  }

  private async handleAction(action: InteractionAction): Promise<void> {
    if (!MUTATION_ACTIONS.has(action.type))
      return

    try {
      const args = (action.payload as PassengerCommandPayload | undefined)?.args ?? []
      const result = await this.executeLegacyMutation(action.type, args)
      this.publish(action, PASSENGER_EVENTS.CommandCompleted, {
        actionType: action.type,
        result,
      } satisfies PassengerCommandCompletedPayload)
    } catch (error) {
      const normalized = normalizeBackendError(error)
      this.publish(action, PASSENGER_EVENTS.CommandFailed, {
        actionType: action.type,
        code: normalized.code,
        message: normalized.message,
      } satisfies PassengerCommandFailedPayload)
    }
  }

  private executeLegacyMutation(actionType: string, args: readonly unknown[]): Promise<unknown> {
    switch (actionType) {
      case PASSENGER_ACTIONS.CreateOrder:
        return backendGateway.postDrive(...args as Parameters<typeof backendGateway.postDrive>)
      case PASSENGER_ACTIONS.CancelOrder:
        return backendGateway.cancelDrive(...args as Parameters<typeof backendGateway.cancelDrive>)
      case PASSENGER_ACTIONS.SelectCandidate:
        return backendGateway.chooseCandidate(...args as Parameters<typeof backendGateway.chooseCandidate>)
      case PASSENGER_ACTIONS.ReleaseCandidate:
        return backendGateway.releaseCandidateChoice(
          ...args as Parameters<typeof backendGateway.releaseCandidateChoice>,
        )
      case PASSENGER_ACTIONS.UpdateWaitingTime:
        return backendGateway.setWaitingTime(...args as Parameters<typeof backendGateway.setWaitingTime>)
      case PASSENGER_ACTIONS.UpdateCustomerPrice:
        return backendGateway.updateOrderCustomerPrice(
          ...args as Parameters<typeof backendGateway.updateOrderCustomerPrice>,
        )
      case PASSENGER_ACTIONS.CompleteRide:
        return backendGateway.setOrderState(
          args[0] as Parameters<typeof backendGateway.setOrderState>[0],
          EBookingDriverState.Finished,
        )
      default:
        return Promise.reject(new Error(`Unsupported Passenger action: ${actionType}`))
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
        source: 'passenger.application',
        timestamp: new Date().toISOString(),
        correlationId: action.metadata?.correlationId,
      },
    } as InteractionEvent<TPayload>)
  }
}

export const passengerGateway = new LegacyPassengerGateway()
