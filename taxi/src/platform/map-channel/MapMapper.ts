/**
 * Platform Core — Mapper канала «карта».
 *
 * Переводит намерение пользователя карты в семантический Action контракта.
 * Через контракт ходят только семантические действия домена (driver.order.select),
 * никогда UI-события вроде marker.clicked / popup.closed.
 *
 * Словарь границы живёт в map-channel-protocol: Mapper его импортирует, но
 * ничего не экспортирует сам, кроме собственно преобразования.
 */

import type { InteractionAction } from '../interaction-contract'
import type { IOrderSelectPayload, TMapOrderId } from './map-channel-protocol'
import { DRIVER_ORDER_SELECT_ACTION, MAP_CHANNEL_SOURCE } from './map-channel-protocol'

/**
 * Чистая функция: без состояния, без I/O, без Browser API.
 *
 * timestamp и correlationId приходят извне (их порождает транспорт — см.
 * MapChannel), чтобы функция оставалась детерминированной и тестируемой.
 *
 * Принимаются непустые строки и конечные числа. Сырой ID сохраняется без
 * преобразования типа; невалидное значение даёт null, без исключений.
 */
export function mapOrderSelectToAction(
  orderId: unknown,
  timestamp: string,
  correlationId: string,
): InteractionAction<IOrderSelectPayload> | null {
  const validString = typeof orderId === 'string' && orderId.trim().length > 0
  const validNumber = typeof orderId === 'number' && Number.isFinite(orderId)

  if (!validString && !validNumber)
    return null

  return {
    type: DRIVER_ORDER_SELECT_ACTION,
    payload: { orderId: orderId as TMapOrderId },
    metadata: {
      source: MAP_CHANNEL_SOURCE,
      timestamp,
      correlationId,
    },
  }
}
