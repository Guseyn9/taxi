import { connect, ConnectedProps, useStore } from 'react-redux'
import type { IRootState } from '../../state'
import { clientOrderActionCreators, clientOrderSelectors } from '../../state/clientOrder'
import { configSelectors } from '../../state/config'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { ordersActionCreators, ordersSelectors } from '../../state/orders'
import { userSelectors } from '../../state/user'

/**
 * Temporary Redux boundary for Passenger Channel.
 * Passenger screens consume these bindings without depending on the legacy
 * store shape. The adapter can be removed when Passenger Snapshot is complete.
 */
export const passengerScreenConnector = connect(
  (state: IRootState) => ({
    activeOrders: ordersSelectors.activeOrders(state),
    selectedOrder: clientOrderSelectors.selectedOrder(state),
    user: userSelectors.user(state),
    language: configSelectors.language(state),
  }),
  {
    setVoteModal: modalsActionCreators.setVoteModal,
    setDriverModal: modalsActionCreators.setDriverModal,
    setMessageModal: modalsActionCreators.setMessageModal,
    setCancelModal: modalsActionCreators.setCancelModal,
    setOnTheWayModal: modalsActionCreators.setOnTheWayModal,
    setRatingModal: modalsActionCreators.setRatingModal,
    setCandidatesModal: modalsActionCreators.setCandidatesModal,
    watchActiveOrders: ordersActionCreators.watchActiveOrders,
    refreshActiveOrders: ordersActionCreators.refreshActiveOrders,
    setFrom: clientOrderActionCreators.setFrom,
    setTo: clientOrderActionCreators.setTo,
    setSelectedOrder: clientOrderActionCreators.setSelectedOrder,
    resetClientOrder: clientOrderActionCreators.reset,
    setPickupPrice: clientOrderActionCreators.setPickupPrice,
  },
)

export type PassengerScreenStoreProps = ConnectedProps<typeof passengerScreenConnector>

export const passengerVotingFormConnector = connect(
  (state: IRootState) => ({
    from: clientOrderSelectors.from(state),
    to: clientOrderSelectors.to(state),
    comments: clientOrderSelectors.comments(state),
    time: clientOrderSelectors.time(state),
    phone: clientOrderSelectors.phone(state),
    user: userSelectors.user(state),
    locationClass: clientOrderSelectors.locationClass(state),
    locationClassSelectionMode: clientOrderSelectors.locationClassSelectionMode(state),
    algorithmLocationClass: clientOrderSelectors.algorithmLocationClass(state),
    locationClasses: clientOrderSelectors.availableLocationClasses(state),
    orderFormLayout: clientOrderSelectors.orderFormLayout(state),
    pickupPrice: clientOrderSelectors.pickupPrice(state),
    customerPrice: clientOrderSelectors.customerPrice(state),
    language: configSelectors.language(state),
  }),
  {
    setPickTimeModal: modalsActionCreators.setPickTimeModal,
    setCommentsModal: modalsActionCreators.setCommentsModal,
    setLoginModal: modalsActionCreators.setLoginModal,
    setMessageModal: modalsActionCreators.setMessageModal,
    setRatingModal: modalsActionCreators.setRatingModal,
    createOrder: ordersActionCreators.create,
    refreshActiveOrders: ordersActionCreators.refreshActiveOrders,
    setPhone: clientOrderActionCreators.setPhone,
    setPickupPrice: clientOrderActionCreators.setPickupPrice,
    setCustomerPrice: clientOrderActionCreators.setCustomerPrice,
    resetClientOrder: clientOrderActionCreators.reset,
    setFrom: clientOrderActionCreators.setFrom,
    setTo: clientOrderActionCreators.setTo,
  },
)

export type PassengerVotingFormStoreProps = ConnectedProps<typeof passengerVotingFormConnector>

export const passengerLiveOrderConnector = connect(
  (state: IRootState) => ({
    currentUser: userSelectors.user(state),
    activeChat: modalsSelectors.activeChat(state),
    language: configSelectors.language(state),
  }),
  {
    setActiveChat: modalsActionCreators.setActiveChat,
    setAlarmModal: modalsActionCreators.setAlarmModal,
    setCancelModal: modalsActionCreators.setCancelModal,
    setMessageModal: modalsActionCreators.setMessageModal,
    setRatingModal: modalsActionCreators.setRatingModal,
    setSelectedOrder: clientOrderActionCreators.setSelectedOrder,
    setPickupPrice: clientOrderActionCreators.setPickupPrice,
    refreshActiveOrders: ordersActionCreators.refreshActiveOrders,
  },
)

export type PassengerLiveOrderStoreProps = ConnectedProps<typeof passengerLiveOrderConnector>

export interface PassengerOrderSubmissionState {
  readonly carClass: ReturnType<typeof clientOrderSelectors.carClass>
  readonly seats: ReturnType<typeof clientOrderSelectors.seats>
  readonly pickupPrice: ReturnType<typeof clientOrderSelectors.pickupPrice>
  readonly customerPrice: ReturnType<typeof clientOrderSelectors.customerPrice>
}

/** Reads the latest values at submit time without exposing Redux to the form. */
export function usePassengerOrderSubmissionReader(): () => PassengerOrderSubmissionState {
  const store = useStore<IRootState>()
  return () => {
    const state = store.getState()
    return {
      carClass: clientOrderSelectors.carClass(state),
      seats: clientOrderSelectors.seats(state),
      pickupPrice: clientOrderSelectors.pickupPrice(state),
      customerPrice: clientOrderSelectors.customerPrice(state),
    }
  }
}
