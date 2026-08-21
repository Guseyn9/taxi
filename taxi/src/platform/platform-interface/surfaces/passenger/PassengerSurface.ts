import type { PassengerUiConfig } from '../../../../types/passengerUi'
import type { PlatformInterfaceRuntime } from '../../PlatformInterfaceRuntime'
import { SURFACE_KINDS } from '../../types'
import { SnapshotSurface } from '../SnapshotSurface'
import type { PassengerUiFacts } from './PassengerPresentation'
import { resolvePassengerUiConfig } from './PassengerPresentation'
import { PASSENGER_ACTIONS } from './passengerActions'

export const PASSENGER_SIMPLE_SURFACE_ID = 'passenger.simple'

export interface PassengerPresentation {
  readonly uiConfig: PassengerUiConfig
  readonly availableActions: readonly string[]
}

export class PassengerSurface extends SnapshotSurface {
  constructor(runtime: PlatformInterfaceRuntime) {
    super(PASSENGER_SIMPLE_SURFACE_ID, SURFACE_KINDS.Simple, runtime)
  }

  resolve(facts: PassengerUiFacts): PassengerPresentation {
    const availableActions = this.getRuntimeState().snapshot?.availableActions ?? []
    const baseUiConfig = resolvePassengerUiConfig(facts)
    const hasActions = availableActions.length > 0
    const canCancel = availableActions.includes(PASSENGER_ACTIONS.CancelOrder)
    const canSelect = availableActions.includes(PASSENGER_ACTIONS.SelectCandidate) ||
      availableActions.includes(PASSENGER_ACTIONS.AcceptOffer)
    const canChat = availableActions.includes(PASSENGER_ACTIONS.OpenChat)
    const canCreateIncident = availableActions.includes(PASSENGER_ACTIONS.CreateIncident)
    const visibleBlocks = hasActions ?
      baseUiConfig.visibleBlocks.filter(block => {
        if (block === 'cancelButton') return canCancel
        if (block === 'candidateList') return canSelect
        if (block === 'chatButton') return canChat
        if (block === 'sosButton') return canCreateIncident
        return true
      }) :
      baseUiConfig.visibleBlocks

    return Object.freeze({
      uiConfig: Object.freeze({
        ...baseUiConfig,
        showCancel: hasActions ? baseUiConfig.showCancel && canCancel : baseUiConfig.showCancel,
        showChat: hasActions ? baseUiConfig.showChat && canChat : baseUiConfig.showChat,
        visibleBlocks,
        availableActions,
      }),
      availableActions,
    })
  }
}
