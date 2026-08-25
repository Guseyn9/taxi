/**
 * Подписка карты водителя на подтверждение кода посадки.
 *
 * Команду выполняет карточка заказа, а не обработчики карты, поэтому событие
 * шлюза — единственный сигнал, по которому карта узнаёт, что бэкенд уже перевёл
 * заказ в Started. Дальше работает тот же механизм, что и у переходов самой
 * карты: состояние сразу, сверка со списком заказов — следом.
 *
 * Вынесено из Driver/Map.tsx отдельным модулем ради одного: чтобы цепочку
 * «успех confirmBoarding → BoardingConfirmed → состояние = Started» можно было
 * проверить целиком в runtime, а не по наличию нужных конструкций в исходнике.
 */

import type { InteractionEvent, Unsubscribe } from '../interaction-contract'
import type { IOrder } from '../../types/types'
import { EBookingDriverState } from '../../types/types'
import { DRIVER_MAP_EVENTS } from './DriverMapGateway'

export interface IDriverBoardingProjection {
  /** Запомнить шаг, до которого заказ уже дошёл, пока список заказов отстаёт. */
  readonly rememberBoardedState: (
    orderId: IOrder['b_id'],
    state: EBookingDriverState,
  ) => void
  /** Перечитать заказ и список активных заказов. */
  readonly refreshOrderState: (orderId: IOrder['b_id']) => void
}

interface IBoardingConfirmedPayload {
  readonly orderId?: IOrder['b_id']
}

export function subscribeDriverBoardingConfirmed(
  gateway: { subscribe: (listener: (event: InteractionEvent) => void) => Unsubscribe },
  projection: IDriverBoardingProjection,
): Unsubscribe {
  return gateway.subscribe(event => {
    if (event.type !== DRIVER_MAP_EVENTS.BoardingConfirmed)
      return

    const { orderId } = (event.payload ?? {}) as IBoardingConfirmedPayload
    if (!orderId)
      return

    projection.rememberBoardedState(orderId, EBookingDriverState.Started)
    projection.refreshOrderState(orderId)
  })
}
