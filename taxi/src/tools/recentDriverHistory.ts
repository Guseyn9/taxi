import {EBookingDriverState, EBookingStates, IOrder} from '../types/types'

export interface RecentDriverHistory {owner: string; orders: IOrder[]}
export function isConfirmedDriverHistory(order: IOrder, owner: string): boolean {
  const driver = order.drivers?.find(driver => String(driver.u_id) === owner)
  return !!driver && !!(order.b_canceled ||
    [EBookingStates.Canceled, EBookingStates.Completed].includes(Number(order.b_state)) ||
    [EBookingDriverState.Canceled, EBookingDriverState.Finished].includes(Number(driver.c_state)))
}

/** Only read-back terminal orders belong here. Disappearance alone proves nothing. */
export function retainDriverHistory(previous: RecentDriverHistory | null, owner: string, order: IOrder): RecentDriverHistory | null {
  if (!owner || !isConfirmedDriverHistory(order, owner)) return previous
  const orders = previous?.owner === owner ? previous.orders : []
  return {owner, orders: [order, ...orders.filter(item => item.b_id !== order.b_id)].slice(0, 50)}
}

export function mergeDriverHistory(archive: IOrder[] | null, recent: RecentDriverHistory | null, owner: string): IOrder[] | null {
  const confirmed = recent?.owner === owner ? recent.orders.filter(order => isConfirmedDriverHistory(order, owner)) : []
  if (!confirmed.length) return archive
  // Archive is authoritative when the same booking appears in both sources.
  const archiveIds = new Set((archive || []).map(order => order.b_id))
  const createdAt = (order: IOrder) => {
    const numeric = Number(order.b_created)
    return Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(String(order.b_created ?? ''))
  }
  return [...confirmed.filter(order => !archiveIds.has(order.b_id)), ...(archive || [])]
    .sort((a,b) => {const first=createdAt(a),second=createdAt(b);return Number.isFinite(first)&&Number.isFinite(second)?second-first:0})
}
