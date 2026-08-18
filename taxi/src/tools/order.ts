import moment from 'moment'
import SITE_CONSTANTS from '../siteConstants'
import {
  APPROXIMATE_ROUTE_COST_PER_KM,
  APPROXIMATE_SUBMIT_COST_PER_KM,
  DEFAULT_CITY_ID,
  PROFIT_RANKS,
} from '../constants/orders'
import {
  EBookingStates,
  EDriverResponseModes,
  EOrderProfitRank,
  IOrder,
  ICar,
  IOrderEstimation,
} from '../types/types'
import { IWayGraph, IWayGraphNode } from './maps'

export function getOrderDriveStartedAt(order?: IOrder | null) {
  return order?.drivers?.find(driver => driver.c_started)?.c_started
}

export function updateCompletedOrderDuration(order: IOrder): IOrder {
  const driveStartedAt = getOrderDriveStartedAt(order)
  if (
    order.b_state === EBookingStates.Completed &&
    order.b_options?.pricingModel &&
    driveStartedAt
  ) {
    order = {
      ...order,
      b_options: {
        ...order.b_options,
        pricingModel: {
          ...order.b_options.pricingModel,
          options: {
            ...(order.b_options.pricingModel.options || {}),
            duration: moment(order.b_completed)
              .diff(driveStartedAt, 'minutes'),
          },
        },
      },
    }
    const newPrice = calculateFinalPrice(order)
    if (typeof newPrice === 'number')
      order.b_options!.pricingModel!.price = newPrice
  }
  return order
}

export const calculateFinalPriceFormula = (order: IOrder | null) => {
  if (!order) {
    return 'err'
  }
  if (!order?.b_options?.pricingModel?.formula) {
    return 'err'
  }
  let formula = order.b_options?.pricingModel?.formula
  let options = order.b_options?.pricingModel?.options || {}

  // pick up submitPrice from b_options
  options = {
    ...options,
    ...{
      submit_price: order.b_options?.submitPrice,
      distance: order.b_options?.pricingModel?.calculationType === 'incomplete'? '?' : order.b_options?.pricingModel?.options?.distance,
      duration:  order.b_options?.pricingModel?.calculationType === 'incomplete' && order.b_options?.pricingModel?.options?.duration === 0? '?' : order.b_options?.pricingModel?.options?.duration,
    },
  }
  // Replace all placeholders in the formula with their values
  Object.entries(options).forEach(([key, value]) => {
    const placeholder = `${key}`
    formula = (formula || 'error_0x01').replace(new RegExp(placeholder, 'g'), value === '?' ? '?' :Math.trunc(value)?.toString() || '0')
  })

  const timeRatioMatch = (formula || 'error_0x02').match(/\(([^)]+)\)\*(\d+(?:\.\d+)?)/)
  if (timeRatioMatch) {
    const coefficient = parseFloat(timeRatioMatch[2])
    if (coefficient === 1) {
      // If coefficient is 1, remove parentheses and multiplication
      formula = (formula || 'error_0x03').replace(/\(([^)]+)\)\*\d+(?:\.\d+)?/, '$1')
    }
  }

  return formula
}

export const calculateFinalPrice = (order: IOrder | null) => {
  if (!order) {
    return 'err'
  }
  if(!order.b_options?.pricingModel?.formula) {
    return 'err'
  }
  if(order.b_options?.pricingModel?.formula === '-') {
    return '-'
  }
  let formula  = order.b_options?.pricingModel?.formula
  let options = order.b_options?.pricingModel?.options || {}

  // pick up submitPrice from b_options
  options = {
    ...options,
    ...{
      submit_rice: order.b_options?.submitPrice,
    },
  }
  if (!formula || formula === 'err') {
    return 'err'
  }
  Object.entries(options).forEach(([key, value]) => {
    const placeholder = `${key}`
    formula = formula.replace(new RegExp(placeholder, 'g'), value?.toString() || '0')
  })
  try {
    const result = eval(formula)
    console.log('FINAL FORMULA', formula, '=', result, ' ~ ', Math.trunc(result))
    return Math.trunc(result).toString()
  } catch (e) {
    return 'err'
  }
}

export function candidateMode(order?: IOrder): boolean {
  switch (SITE_CONSTANTS.DRIVER_RESPONSE_MODE) {
    case EDriverResponseModes.Performer:
      return false
    case EDriverResponseModes.Candidate:
      return true
    case EDriverResponseModes.ByOrder:
      for (const id of order?.b_comments ?? [])
        switch (SITE_CONSTANTS.BOOKING_COMMENTS[id].responseMode) {
          case EDriverResponseModes.Performer:
            return false
          case EDriverResponseModes.Candidate:
            return true
        }
      return false
    default:
      throw new Error('Not implemented')
  }
}

export function estimateOrder(
  order: IOrder,
  car: ICar,
  startingPoint: [lat: number, lng: number],
  graph: IWayGraph,
): IOrderEstimation {
  // Расстояния считаются один раз и переиспользуются: поиск пути по графу дорог —
  // самая дорогая часть оценки, а пересчёт идёт по таймеру для всех видимых заказов.
  const distance = calculateDistance(order, startingPoint, graph)
  const profit = distance ? estimateProfitByDistance(order, car, distance) : undefined
  const profitRank = typeof profit === 'number' ? rankProfit(profit) : undefined

  // Оценку накладывают на заказ спредом и пересчитывают по мере движения такси,
  // поэтому «пусто» тоже возвращаем всеми полями: иначе от прошлого расчёта
  // остался бы холостой пробег, посчитанный от другой точки.
  if (!distance || typeof profit !== 'number' || !Number.isFinite(profit))
    return {
      profit,
      profitRank,
      emptyMileageKm: undefined,
      routeMileageKm: undefined,
      profitPerEmptyKm: undefined,
      profitSortValue: undefined,
    }

  const [emptyMeters, routeMeters] = distance
  const emptyMileageKm = Number((emptyMeters / 1000).toFixed(2))
  const routeMileageKm = Number((routeMeters / 1000).toFixed(2))
  const profitPerEmptyKm = Number((profit / Math.max(emptyMileageKm, 0.1)).toFixed(2))
  const profitSortValue = Number((profitPerEmptyKm + profit / 1000).toFixed(2))

  return {
    profit,
    profitRank,
    emptyMileageKm,
    routeMileageKm,
    profitPerEmptyKm,
    profitSortValue,
  }
}

function getProfitFactorsForCar(car: ICar) {
  const byDefaultCity = SITE_CONSTANTS.CALCULATION_BENEFITS[DEFAULT_CITY_ID]
  if (byDefaultCity?.[car.cc_id])
    return byDefaultCity[car.cc_id]

  for (const cityFactors of Object.values(SITE_CONSTANTS.CALCULATION_BENEFITS || {})) {
    if (cityFactors?.[car.cc_id])
      return cityFactors[car.cc_id]
    const firstClassFactors = Object.values(cityFactors || {})[0]
    if (firstClassFactors)
      return firstClassFactors
  }

  return undefined
}

function getOrderDisplayedPrice(order: IOrder) {
  const price = Number(
    order.b_price_estimate ||
    (order as any).b_price ||
    (order as any).price ||
    (order.b_options as any)?.customer_price ||
    (order.b_options as any)?.performers_price ||
    0,
  )

  return Number.isFinite(price) ? price : 0
}

function estimateProfitByDisplayedPrice(order: IOrder, distance: [number, number]) {
  const [startingPointToOrder, startToDestination] = distance
    .map(distance => distance / 1000)
  const income = getOrderDisplayedPrice(order)

  if (!Number.isFinite(income))
    return undefined

  // Fallback for configs where calculation_benefits is absent for the current
  // city/car class. It keeps the order in the profit sorting and, importantly,
  // shows negative values instead of silently hiding the calculation.
  //
  // Подача и оплаченная часть маршрута стоят по-разному: пассажир платит только
  // за «Откуда» → «Куда», поэтому километр до точки посадки водитель оплачивает
  // из своего кармана и он бьёт по выгоде заметно сильнее.
  const cost =
    APPROXIMATE_SUBMIT_COST_PER_KM * startingPointToOrder +
    APPROXIMATE_ROUTE_COST_PER_KM * startToDestination
  return Number((income - cost).toFixed(2))
}

export function estimateProfit(
  order: IOrder,
  car: ICar,
  startingPoint: [lat: number, lng: number],
  graph: IWayGraph,
): number | undefined {
  const distance = calculateDistance(order, startingPoint, graph)
  if (!distance)
    return

  return estimateProfitByDistance(order, car, distance)
}

function estimateProfitByDistance(
  order: IOrder,
  car: ICar,
  distance: [startingPointToOrder: number, startToDestination: number],
): number | undefined {
  let factors = getProfitFactorsForCar(car)

  if (!factors)
    return estimateProfitByDisplayedPrice(order, distance)

  const orderTime = moment(0)
  for (const part of ['hours', 'minutes', 'seconds'] as const)
    orderTime.set(part, order.b_start_datetime.get(part))
  const factorsModification = factors.time_modifications.find(({
    start, end,
  }) =>
    start < end ?
      start < orderTime && orderTime < end :
      end < orderTime && orderTime < start,
  )
  if (factorsModification)
    factors = { ...factors, ...factorsModification }

  const [startingPointToOrder, startToDestination] = distance
    .map(distance => distance / 1000)
  const { fuel_cost, rate, base_fare, min_fare } = factors
  const income = Math.max(base_fare + rate * startToDestination, min_fare)
  const cost = fuel_cost * (startingPointToOrder + startToDestination)
  return Number((income - cost).toFixed(2))
}

export function rankProfit(profit: number): EOrderProfitRank {
  const ranks = [...PROFIT_RANKS].sort(([, a], [, b]) => a - b)
  let rank = EOrderProfitRank.Low
  for (const [minProfitRank, minProfit] of ranks)
    if (profit >= minProfit)
      rank = minProfitRank
  return rank
}

/**
 * Прибыль заказа для раскраски. Отличается от {@link estimateOrder} тем, что не
 * должна оставлять карточку/булавку без цвета: если оценка не посчиталась (нет
 * координат, машины или геопозиции), берём грубую прикидку по цене заказа.
 */
export function getEstimatedProfit(order: IOrder) {
  if (typeof order.profit === 'number' && Number.isFinite(order.profit))
    return order.profit

  const price = Number(order.b_price_estimate || (order as any).b_price || (order as any).price || 0)
  const tips = Number(order.b_tips || 0)
  const passengerBonus = Number(order.b_passengers_count || 0) * 3
  const fallback = price + tips + passengerBonus
  return Number.isFinite(fallback) && fallback > 0 ? fallback : undefined
}

// Перцентильная раскраска: цвет зависит не от абсолютной суммы, а от того,
// насколько заказ выгоднее ОСТАЛЬНЫХ видимых заказов. При каждом обновлении списка
// собираем прибыли всех видимых заказов, ранжируем и делим на 5 групп по 20%:
// p0 — нижние 20% (🔴), p1 20–40% (🟠), p2 40–60% (🟡), p3 60–80% (🟢), p4 — верхние 20% (💚).
// Так даже при близких прибылях сразу видно, какие заказы лучше других.
export const PROFIT_PERCENTILE_BUCKETS = 5

/** Карта { b_id -> группа 0..4 }, общая для булавок на карте и карточек в списках. */
export function computeProfitPercentiles(orders: IOrder[]): Record<string, number> {
  const entries: Array<{ id: string, profit: number }> = []
  orders.forEach(order => {
    if (!order?.b_id) return
    const profit = getEstimatedProfit(order)
    if (profit === undefined) return
    entries.push({ id: String(order.b_id), profit })
  })

  const result: Record<string, number> = {}
  const count = entries.length
  if (!count) return result

  const values = entries.map(entry => entry.profit)
  entries.forEach(({ id, profit }) => {
    // Мидранк-перцентиль: одинаковые прибыли получают одну группу (один цвет),
    // а различающиеся — раскладываются по группам по относительному рангу.
    const below = values.reduce((sum, value) => sum + (value < profit ? 1 : 0), 0)
    const atOrBelow = values.reduce((sum, value) => sum + (value <= profit ? 1 : 0), 0)
    const percentile = (below + atOrBelow) / (2 * count)
    result[id] = Math.min(PROFIT_PERCENTILE_BUCKETS - 1, Math.floor(percentile * PROFIT_PERCENTILE_BUCKETS))
  })

  return result
}

export function getProfitSortValue(order: IOrder) {
  if (typeof order.profitSortValue === 'number' && Number.isFinite(order.profitSortValue))
    return order.profitSortValue

  if (typeof order.profitPerEmptyKm === 'number' && Number.isFinite(order.profitPerEmptyKm))
    return order.profitPerEmptyKm

  if (typeof order.profit === 'number' && Number.isFinite(order.profit))
    return order.profit

  return Number.NEGATIVE_INFINITY
}

/**
 * Порядок списка заказов у водителя. Живёт рядом с расчётом выгоды, потому что
 * пересортировать нужно везде, где выгода пересчитана: и в селекторах, и при
 * обновлении по текущему положению такси.
 */
export function sortOrdersByProfit(orders: IOrder[] | null): IOrder[] | null {
  if (!orders)
    return null

  return [...orders].sort((a, b) => {
    const profitDiff = getProfitSortValue(b) - getProfitSortValue(a)
    if (profitDiff !== 0)
      return profitDiff

    return String(b.b_id).localeCompare(String(a.b_id))
  })
}

export function calculateDistance(
  order: IOrder,
  startingPoint: [lat: number, lng: number],
  graph: IWayGraph,
): [startingPointToOrder: number, startToDestination: number] | undefined {
  if (!(
    order.b_start_latitude && order.b_start_longitude &&
    order.b_destination_latitude && order.b_destination_longitude
  ))
    return

  const fallbackDistance = (): [number, number] => [
    geoDistanceMeters(startingPoint[0], startingPoint[1], order.b_start_latitude!, order.b_start_longitude!) * 1.25,
    geoDistanceMeters(order.b_start_latitude!, order.b_start_longitude!, order.b_destination_latitude!, order.b_destination_longitude!) * 1.25,
  ]

  if (!graph?.findClosestNode || !graph?.findShortestPath)
    return fallbackDistance()

  const nodes: IWayGraphNode[] = []
  for (const [lat, lng] of [
    startingPoint,
    [order.b_start_latitude, order.b_start_longitude],
    [order.b_destination_latitude, order.b_destination_longitude],
  ]) {
    const [node] = graph.findClosestNode(lat, lng)
    if (!node)
      return fallbackDistance()
    nodes.push(node)
  }
  const [startNode, orderStartNode, destinationNode] = nodes

  const distances: number[] = []
  for (const [start, destination] of [
    [startNode, orderStartNode],
    [orderStartNode, destinationNode],
  ]) {
    const [, distance] = graph.findShortestPath(start.id, destination.id)
    if (distance === Infinity)
      return fallbackDistance()
    distances.push(distance)
  }
  const [startingPointToOrder, startToDestination] = distances

  return [startingPointToOrder, startToDestination]
}


function geoDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusMeters = 6371000
  const toRad = (value: number) => value * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
