export const PASSENGER_ACTIONS = {
  CreateOrder: 'order_create',
  CancelOrder: 'order_cancel_by_client',
  SelectCandidate: 'order_select_candidate',
  AcceptOffer: 'order_select_offer',
  ReleaseCandidate: 'order_release_candidate',
  UpdateWaitingTime: 'order_update_waiting_time',
  UpdateCustomerPrice: 'order_update_customer_price',
  CompleteRide: 'order_complete_ride',
  OpenChat: 'order_open_chat',
  ConfirmBoarding: 'order_confirm_boarding',
  CreateIncident: 'order_create_incident',
  RateOrder: 'order_rate',
} as const

export type PassengerAction = typeof PASSENGER_ACTIONS[keyof typeof PASSENGER_ACTIONS]
