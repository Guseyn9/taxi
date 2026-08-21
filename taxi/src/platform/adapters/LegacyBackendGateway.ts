import * as API from '../../API'
import type { InteractionEvent } from '../interaction-contract'
import { assertSuccessfulBackendResponse, normalizeBackendError } from './backendError'

export const BACKEND_EVENTS = {
  Completed: 'backend.request.completed',
  Failed: 'backend.request.failed',
} as const

type BackendEventPublisher = (event: InteractionEvent) => void
type AsyncBackendRequest = (...args: any[]) => Promise<any>

/**
 * Compatibility boundary for the existing iBronevik client.
 * UI code depends on this port while transport replacement stays local here.
 */
export class LegacyBackendGateway {
  private eventPublisher: BackendEventPublisher | null = null

  readonly activateChatServer = this.observe('activateChatServer', API.activateChatServer)
  readonly arrivedVotingOrder = this.observe('arrivedVotingOrder', API.arrivedVotingOrder)
  readonly cancelVotingParticipation = this.observe('cancelVotingParticipation', API.cancelVotingParticipation)
  readonly checkRefCode = this.observe('checkRefCode', API.checkRefCode)
  readonly confirmVotingCode = this.observe('confirmVotingCode', API.confirmVotingCode)
  readonly cancelDrive = this.observe('cancelDrive', API.cancelDrive)
  readonly createUserCar = this.observe('createUserCar', API.createUserCar)
  readonly chooseCandidate = this.observe('chooseCandidate', API.chooseCandidate)
  readonly editCar = this.observe('editCar', API.editCar)
  readonly editUser = this.observe('editUser', API.editUser)
  readonly getAuthorizedUser = this.observe('getAuthorizedUser', API.getAuthorizedUser)
  readonly getCar = this.observe('getCar', API.getCar)
  readonly getCars = this.observe('getCars', API.getCars)
  readonly geocode = this.observe('geocode', API.geocode)
  readonly getImageFile = this.observe('getImageFile', API.getImageFile)
  readonly getOrder = this.observe('getOrder', API.getOrder)
  readonly getPointSuggestions = this.observe('getPointSuggestions', API.getPointSuggestions)
  readonly getUser = this.observe('getUser', API.getUser)
  readonly getUsers = this.observe('getUsers', API.getUsers)
  readonly getUserCar = this.observe('getUserCar', API.getUserCar)
  readonly getWashTrips = this.observe('getWashTrips', API.getWashTrips)
  readonly makeRoutePoints = this.observe('makeRoutePoints', API.makeRoutePoints)
  readonly participateVotingOrder = this.observe('participateVotingOrder', API.participateVotingOrder)
  readonly postDrive = this.observe('postDrive', API.postDrive)
  readonly releaseCandidateChoice = this.observe('releaseCandidateChoice', API.releaseCandidateChoice)
  readonly reverseGeocode = this.observe('reverseGeocode', API.reverseGeocode)
  readonly sendOrderOffer = this.observe('sendOrderOffer', API.sendOrderOffer)
  readonly setOrderRating = this.observe('setOrderRating', API.setOrderRating)
  readonly setOrderState = this.observe('setOrderState', API.setOrderState)
  readonly setOutDrive = this.observe('setOutDrive', API.setOutDrive)
  readonly setWaitingTime = this.observe('setWaitingTime', API.setWaitingTime)
  readonly takeOrder = this.observe('takeOrder', API.takeOrder)
  readonly uploadFile = this.observe('uploadFile', API.uploadFile)
  readonly updateOrderCustomerPrice = this.observe('updateOrderCustomerPrice', API.updateOrderCustomerPrice)

  setEventPublisher(publisher: BackendEventPublisher | null): void {
    this.eventPublisher = publisher
  }

  private observe<T extends AsyncBackendRequest>(
    operation: string,
    request: T,
  ): T {
    return (async(...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
      const correlationId = `backend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      try {
        const result = assertSuccessfulBackendResponse(await request(...args))
        this.publish(BACKEND_EVENTS.Completed, { operation }, correlationId)
        return result
      } catch (error) {
        const normalized = normalizeBackendError(error)
        this.publish(BACKEND_EVENTS.Failed, {
          operation,
          code: normalized.code,
          message: normalized.message,
        }, correlationId)
        throw normalized
      }
    }) as T
  }

  private publish(type: string, payload: Readonly<Record<string, unknown>>, correlationId: string): void {
    this.eventPublisher?.({
      type,
      payload,
      metadata: {
        source: 'legacy.backend.adapter',
        timestamp: new Date().toISOString(),
        correlationId,
      },
    })
  }
}

export const backendGateway = new LegacyBackendGateway()
