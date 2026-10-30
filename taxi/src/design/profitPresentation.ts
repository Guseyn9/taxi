import {IOrder} from '../types/types'
import {computeProfitPercentiles} from '../tools/order'
/** Presentation must never pass off the legacy fare fallback as calculated profit. */
export function calculatedProfit(order: IOrder): number | undefined {
  return typeof order.profit === 'number' && Number.isFinite(order.profit) ? order.profit : undefined
}
export function profitPercentiles(orders: IOrder[]) {
  return computeProfitPercentiles(orders.filter(order => calculatedProfit(order) !== undefined))
}
