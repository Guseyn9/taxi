/**
 * Состояние заказа, по которому карта водителя рисует кнопку и строит план.
 *
 * Своего FSM у фронтенда нет: источник истины — бэкенд. Здесь только правило,
 * по которому карта выбирает САМОЕ СВЕЖЕЕ известное ей значение, пока список
 * активных заказов (он отстаёт на несколько секунд) не догонит бэкенд.
 */

import { EBookingDriverState } from '../types/types'

export interface IEffectiveDriverStateInput {
  /** Состояние из списка активных заказов — то, что уже подтвердил бэкенд. */
  readonly backendState?: EBookingDriverState
  /** Шаг, на который водитель только что перевёл заказ нажатием на карте. */
  readonly optimisticState?: EBookingDriverState
  /**
   * Пассажир уже в салоне, хотя заказ ещё не в `Started`: попутчик, посаженный
   * в момент взятия, и голосовой заказ с подтверждённым кодом посадки (бэкенд
   * оставляет такого водителя в `Performer`/`Arrived`).
   */
  readonly boarded?: boolean
}

export function resolveEffectiveDriverState({
  backendState,
  optimisticState,
  boarded,
}: IEffectiveDriverStateInput): EBookingDriverState | undefined {
  // Оптимистичное состояние живёт, только пока оно ВПЕРЕДИ бэкенда: как только
  // тот догнал, откатывать заказ назад нечем и незачем.
  const state = optimisticState !== undefined &&
    (backendState === undefined || optimisticState > backendState) ?
    optimisticState :
    backendState

  // Иначе план (он считает по посаженным пассажирам) и кнопка разошлись бы:
  // водителю, который уже везёт пассажира, предложили бы «Поехал», а тому, кто
  // только что подтвердил код посадки, — подтвердить его ещё раз.
  if (state !== undefined && state < EBookingDriverState.Started && boarded)
    return EBookingDriverState.Started

  return state
}

export interface IDriverBoardedMarkers {
  /** Попутчик, посаженный в момент взятия заказа. */
  readonly boardedAlongTheWayIds?: readonly unknown[] | null
  /**
   * Голосовые заказы, по которым код посадки уже подтверждён. Отметка ставится
   * только после успешного ответа бэкенда на confirmBoarding и переживает уход
   * с карты — иначе после возврата водителю снова предложили бы ввести код,
   * который он уже подтвердил.
   */
  readonly confirmedBoardingOrderIds?: readonly unknown[] | null
}

/** Пассажир этого заказа уже в салоне, даже если бэкенд ещё не в `Started`. */
export function isDriverOrderBoarded(
  orderId: unknown,
  { boardedAlongTheWayIds, confirmedBoardingOrderIds }: IDriverBoardedMarkers,
): boolean {
  const id = String(orderId)
  const marked = (ids?: readonly unknown[] | null) =>
    !!ids?.some(value => String(value) === id)

  return marked(boardedAlongTheWayIds) || marked(confirmedBoardingOrderIds)
}
