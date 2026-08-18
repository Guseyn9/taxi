import { ICar, IOrder } from '../types/types'
import { WayGraph } from './maps'
import { estimateOrder } from './order'

// Пустой граф: расстояния считаются по прямой (fallback в calculateDistance) —
// тесту важна зависимость выгоды от расстояния, а не точность маршрута.
const graph = new WayGraph()
const car = { cc_id: 1 } as unknown as ICar

/** Текущее положение такси (центр Ростова-на-Дону). */
const taxi: [number, number] = [47.2357, 39.7015]

function orderFrom(latitude: number, longitude: number): IOrder {
  return {
    b_id: '1',
    b_start_latitude: latitude,
    b_start_longitude: longitude,
    b_destination_latitude: 47.2500,
    b_destination_longitude: 39.7500,
    b_price_estimate: 400,
  } as unknown as IOrder
}

describe('estimateOrder', () => {

  it('уменьшает выгоду, когда точка «Откуда» дальше от такси', () => {
    const near = estimateOrder(orderFrom(47.2360, 39.7020), car, taxi, graph)
    const far = estimateOrder(orderFrom(47.2900, 39.6200), car, taxi, graph)

    expect(typeof near.profit).toBe('number')
    expect(typeof far.profit).toBe('number')
    expect(far.profit!).toBeLessThan(near.profit!)
  })

  it('не меняет оплаченную часть маршрута при удалении точки «Откуда»', () => {
    const pickup: [number, number] = [47.2360, 39.7020]
    const fromNearby = estimateOrder(orderFrom(...pickup), car, taxi, graph)
    const fromFarAway = estimateOrder(orderFrom(...pickup), car, [47.4000, 39.9000], graph)

    expect(fromFarAway.routeMileageKm).toBe(fromNearby.routeMileageKm)
    expect(fromFarAway.emptyMileageKm!).toBeGreaterThan(fromNearby.emptyMileageKm!)
    expect(fromFarAway.profit!).toBeLessThan(fromNearby.profit!)
  })

  it('растит выгоду по мере приближения такси к точке «Откуда»', () => {
    const order = orderFrom(47.2900, 39.6200)
    const profits = [
      estimateOrder(order, car, [47.2357, 39.7015], graph).profit!,
      estimateOrder(order, car, [47.2600, 39.6600], graph).profit!,
      estimateOrder(order, car, [47.2850, 39.6250], graph).profit!,
    ]

    expect(profits[1]).toBeGreaterThan(profits[0])
    expect(profits[2]).toBeGreaterThan(profits[1])
  })

})
