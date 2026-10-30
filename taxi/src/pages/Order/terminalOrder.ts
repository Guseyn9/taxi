import { EBookingStates, IOrder } from '../../types/types'

/** The booking's terminal state takes precedence over a stale driver state. */
export function isCompletedOrder(order: Pick<IOrder, 'b_state' | 'b_completed'>): boolean {
  return order.b_state === EBookingStates.Completed ||
    (Boolean(order.b_completed) && order.b_state !== EBookingStates.Canceled)
}
