import type { Store } from 'redux'
import type { Unsubscribe } from '../interaction-contract'
import type {
  PlatformSnapshotListener,
  PlatformSnapshotProvider,
} from '../platform-interface/SnapshotProvider'
import { createPlatformSnapshot } from '../platform-interface/snapshot'
import type { PlatformSnapshot } from '../platform-interface/snapshot'
import {
  PASSENGER_ACTIONS,
  resolvePassengerUiConfig,
} from '../platform-interface/surfaces/passenger'
import type { PassengerUiState } from '../../types/passengerUi'
import type { IRootState } from '../../state'
import { clientOrderSelectors } from '../../state/clientOrder'
import { ordersSelectors } from '../../state/orders'
import { userSelectors } from '../../state/user'

function resolveAvailableActions(state: PassengerUiState): readonly string[] {
  switch (state) {
    case 'DRAFT':
    case 'CANCELLED':
      return [PASSENGER_ACTIONS.CreateOrder]
    case 'SEARCHING_DRIVER':
    case 'LEGACY_CHOICE_ORDER':
      return [PASSENGER_ACTIONS.CancelOrder]
    case 'CANDIDATE_SELECTION':
      return [
        PASSENGER_ACTIONS.SelectCandidate,
        PASSENGER_ACTIONS.AcceptOffer,
        PASSENGER_ACTIONS.CancelOrder,
      ]
    case 'DRIVER_ASSIGNED':
      return [PASSENGER_ACTIONS.OpenChat, PASSENGER_ACTIONS.CancelOrder]
    case 'DRIVER_ARRIVED':
      return [PASSENGER_ACTIONS.OpenChat, PASSENGER_ACTIONS.ConfirmBoarding]
    case 'TRIP_STARTED':
      return [PASSENGER_ACTIONS.CreateIncident]
    case 'TRIP_FINISHED':
      return [PASSENGER_ACTIONS.RateOrder, PASSENGER_ACTIONS.CreateOrder]
    default:
      return []
  }
}

/** Interim adapter. Replace it with DomainApiSnapshotProvider in production. */
export class LegacyReduxSnapshotProvider implements PlatformSnapshotProvider {
  private readonly store: Store<IRootState>
  private readonly listeners: PlatformSnapshotListener[] = []
  private storeUnsubscribe: Unsubscribe | null = null
  private revision = 0
  private fingerprint = ''
  private current: PlatformSnapshot | null = null

  constructor(store: Store<IRootState>) {
    this.store = store
  }

  load(): Promise<PlatformSnapshot> {
    return Promise.resolve(this.read())
  }

  subscribe(listener: PlatformSnapshotListener): Unsubscribe {
    this.listeners.push(listener)
    if (!this.storeUnsubscribe)
      this.storeUnsubscribe = this.store.subscribe(() => this.publishIfChanged())

    let unsubscribed = false
    return () => {
      if (unsubscribed)
        return
      unsubscribed = true
      const index = this.listeners.indexOf(listener)
      if (index !== -1)
        this.listeners.splice(index, 1)
      if (this.listeners.length === 0 && this.storeUnsubscribe) {
        this.storeUnsubscribe()
        this.storeUnsubscribe = null
      }
    }
  }

  private publishIfChanged(): void {
    const previousRevision = this.revision
    const snapshot = this.read()
    if (snapshot.revision === previousRevision)
      return
    this.listeners.slice().forEach(listener => listener(snapshot))
  }

  private read(): PlatformSnapshot {
    const state = this.store.getState()
    const activeOrders = ordersSelectors.activeOrders(state) ?? []
    const readyOrders = ordersSelectors.readyOrders(state) ?? []
    const historyOrders = ordersSelectors.historyOrders(state) ?? []
    const user = userSelectors.user(state)
    const selectedOrderId = clientOrderSelectors.selectedOrder(state)
    const selectedOrder = selectedOrderId ?
      activeOrders.find(order => String(order.b_id) === String(selectedOrderId)) ?? null :
      null
    const uiConfig = resolvePassengerUiConfig({ selectedOrder })
    const nextFingerprint = JSON.stringify({
      selectedOrderId,
      activeOrders,
      readyOrders,
      historyOrders,
      user,
      uiState: uiConfig.state,
    })

    if (this.current && nextFingerprint === this.fingerprint)
      return this.current

    this.fingerprint = nextFingerprint
    this.revision += 1
    this.current = createPlatformSnapshot({
      revision: this.revision,
      state: {
        source: 'legacy-redux',
        driver: {
          user,
          activeOrders,
          readyOrders,
          historyOrders,
        },
        passenger: {
          selectedOrderId,
          selectedOrder,
          activeOrders,
          uiState: uiConfig.state,
        },
      },
      availableActions: resolveAvailableActions(uiConfig.state),
      updatedAt: new Date().toISOString(),
    })
    return this.current
  }
}
