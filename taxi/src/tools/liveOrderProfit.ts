/**
 * Живой пересчёт выгоды заказа по текущему положению такси.
 *
 * В формулу выгоды входит расстояние до точки «Откуда»: подача не оплачивается
 * (пассажир платит только за «Откуда» → «Куда»), поэтому чем дальше точка
 * посадки от такси, тем меньше водитель заработает на заказе.
 *
 * Селекторы заказов считают выгоду от redux-геопозиции — сырого GPS браузера.
 * Во время прогона эмулятора он стоит на месте (маркер ведёт driverRouteEmulator),
 * поэтому выгода оставалась одной и той же на всё время поездки. Здесь берётся
 * та же позиция, что видит водитель на карте — шина driverPosition с откатом на
 * GPS, — и выгода пересчитывается раз в PROFIT_UPDATE_INTERVAL_MS.
 */

import { useEffect, useMemo, useState } from 'react'

import { IOrder } from '../types/types'
import { PROFIT_UPDATE_INTERVAL_MS } from '../constants/orders'
import { userPrimaryCar } from '../state/cars/selectors'
import { geoposition } from '../state/geolocation/selectors'
import { wayGraph } from '../state/areas/selectors'
import {
  TDriverPosition,
  getDriverPosition,
  subscribeDriverPosition,
} from './driverPosition'
import { useReliableNow, useSimpleSelector } from './hooks'
import { geopositionToPoint } from './maps'
import { estimateOrder, sortOrdersByProfit } from './order'

function isSamePoint(a?: TDriverPosition | null, b?: TDriverPosition | null) {
  if (!a || !b)
    return !a && !b
  return a[0] === b[0] && a[1] === b[1]
}

/**
 * Положение такси, «замороженное» между тактами пересчёта.
 *
 * Маркер водителя публикуется несколько раз в секунду, поэтому мы не подписаны
 * на шину постоянно: пересчёт выгоды тянет за собой поиск пути по графу дорог
 * для каждого видимого заказа и пересортировку списка, и делать это на каждый
 * шаг маркера незачем. Позицию снимаем по такту общего таймера, а подписка
 * нужна ровно до первой известной точки — чтобы после старта эмулятора выгода
 * не ждала ближайшего такта.
 */
function useSampledDriverPoint(): TDriverPosition | undefined {
  const browserGeoposition = useSimpleSelector(geoposition)
  const fallbackPoint = useMemo(
    () => browserGeoposition ? geopositionToPoint(browserGeoposition) : undefined,
    [browserGeoposition],
  )

  const [sampledPoint, setSampledPoint] = useState<TDriverPosition | undefined>(
    () => getDriverPosition() ?? fallbackPoint,
  )
  const tick = useReliableNow(true, PROFIT_UPDATE_INTERVAL_MS)

  useEffect(() => {
    const point = getDriverPosition() ?? fallbackPoint
    // Такси стоит на месте — новая ссылка на те же координаты не должна
    // запускать пересчёт.
    setSampledPoint(previous => isSamePoint(previous, point) ? previous : point)
  }, [tick, fallbackPoint])

  useEffect(() => {
    if (sampledPoint)
      return undefined

    return subscribeDriverPosition(position => {
      if (position)
        setSampledPoint(position)
    })
  }, [sampledPoint])

  return sampledPoint
}

/**
 * Пересчитывает выгоду списка заказов от текущего положения такси и заново
 * сортирует список — самый выгодный сверху.
 */
export function useLiveEstimatedOrders(orders: IOrder[] | null): IOrder[] | null {
  const point = useSampledDriverPoint()
  const car = useSimpleSelector(userPrimaryCar)
  const graph = useSimpleSelector(wayGraph)

  return useMemo(() => {
    if (!orders?.length || !point || !car)
      return orders

    return sortOrdersByProfit(orders.map(order => ({
      ...order,
      ...estimateOrder(order, car, point, graph),
    })))
  }, [orders, point, car, graph])
}

/** То же самое для карточки одного заказа. */
export function useLiveEstimatedOrder(order: IOrder | null): IOrder | null {
  const point = useSampledDriverPoint()
  const car = useSimpleSelector(userPrimaryCar)
  const graph = useSimpleSelector(wayGraph)

  return useMemo(() => {
    if (!order || !point || !car)
      return order

    return { ...order, ...estimateOrder(order, car, point, graph) }
  }, [order, point, car, graph])
}
