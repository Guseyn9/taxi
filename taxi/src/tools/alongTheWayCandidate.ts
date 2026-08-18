/**
 * Who qualifies as a same-way ("попутный") pickup.
 *
 * The order-event adapter flags every plain order that shows up while the driver
 * is already on a trip (`NEW_ALONG_THE_WAY_ORDER`) — it has no idea about seats,
 * order kind or what the driver already declined. This predicate is the filter
 * between "an order appeared" and "worth driving over to ask the driver".
 *
 * Kept separate from the map component so the rule can be unit-tested and later
 * moved into an FSM without touching React code.
 */

import { IOrder, IUser } from '../types/types'
import { canDriverTakeOrderBySeats, isDriverParticipatingOrder } from './driverCapacity'
import { isOfferOrder, isVotingOrder } from './driverOffer'

export interface IAlongTheWayContext {
  userId?: IUser['u_id'] | null
  /** Свободные места в салоне с учётом уже взятых заказов. */
  freeSeats: number
  /** Заказы, по которым водитель уже сказал «не брать». */
  declinedOrderIds?: Record<string, boolean> | null
}

export function isAlongTheWayCandidate(
  order: IOrder | null | undefined,
  context: IAlongTheWayContext,
): boolean {
  if (!order?.b_id)
    return false

  // Голосования и офферы идут своими сценариями (код посадки, торг по цене) —
  // подхватывать их «по пути» нельзя.
  if (isVotingOrder(order) || isOfferOrder(order))
    return false

  // Водитель уже как-то относится к этому заказу (взял, откликнулся, отказался
  // раньше) — решение по нему принято не здесь.
  if (isDriverParticipatingOrder(order, context.userId ?? undefined))
    return false

  if (context.declinedOrderIds?.[String(order.b_id)])
    return false

  return canDriverTakeOrderBySeats(order, context.freeSeats, context.userId ?? undefined)
}
