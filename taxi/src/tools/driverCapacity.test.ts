import { EBookingDriverState, ICar, IOrder } from '../types/types'
import {
  DEFAULT_CAR_SEATS,
  canDriverTakeOrderBySeats,
  filterOrdersByFreeSeats,
  getCarCapacity,
  getDriverFreeSeats,
  getOrderSeatsCount,
} from './driverCapacity'

const DRIVER_ID = 'driver-1'

const car = (seats?: number) => ({ c_id: 'car-1', seats } as unknown as ICar)

function order(
  id: string,
  passengers?: number,
  driverState?: EBookingDriverState,
): IOrder {
  return {
    b_id: id,
    b_passengers_count: passengers,
    drivers: driverState === undefined ?
      [] :
      [{ u_id: DRIVER_ID, c_state: driverState }],
  } as unknown as IOrder
}

describe('getOrderSeatsCount', () => {

  it('считает заказ без числа пассажиров за одного', () => {
    expect(getOrderSeatsCount(order('1'))).toBe(1)
    expect(getOrderSeatsCount(order('1', 0))).toBe(1)
  })

  it('берёт число пассажиров заказа', () => {
    expect(getOrderSeatsCount(order('1', 3))).toBe(3)
  })

})

describe('getCarCapacity', () => {

  it('берёт вместимость машины', () => {
    expect(getCarCapacity(car(6))).toBe(6)
  })

  it('падает в дефолт, когда мест у машины нет', () => {
    expect(getCarCapacity(car())).toBe(DEFAULT_CAR_SEATS)
    expect(getCarCapacity(null)).toBe(DEFAULT_CAR_SEATS)
  })

})

describe('getDriverFreeSeats', () => {

  it('вычитает пассажиров взятого заказа из вместимости', () => {
    const activeOrders = [order('1', 3, EBookingDriverState.Performer)]

    expect(getDriverFreeSeats(car(4), activeOrders, DRIVER_ID)).toBe(1)
  })

  it('суммирует места нескольких поездок водителя', () => {
    const activeOrders = [
      order('1', 2, EBookingDriverState.Started),
      order('2', 1, EBookingDriverState.Arrived),
    ]

    expect(getDriverFreeSeats(car(4), activeOrders, DRIVER_ID)).toBe(1)
  })

  it('не занимает места чужими заказами и откликами', () => {
    const activeOrders = [
      order('1', 3),
      order('2', 2, EBookingDriverState.Considering),
      order('3', 2, EBookingDriverState.Canceled),
    ]

    expect(getDriverFreeSeats(car(4), activeOrders, DRIVER_ID)).toBe(4)
  })

  it('не уходит в минус, когда пассажиров больше вместимости', () => {
    const activeOrders = [order('1', 8, EBookingDriverState.Started)]

    expect(getDriverFreeSeats(car(4), activeOrders, DRIVER_ID)).toBe(0)
  })

})

describe('canDriverTakeOrderBySeats', () => {

  it('пропускает заказ, который помещается в оставшиеся места', () => {
    expect(canDriverTakeOrderBySeats(order('1', 1), 1, DRIVER_ID)).toBe(true)
  })

  it('отсекает заказ, для которого мест не хватает', () => {
    expect(canDriverTakeOrderBySeats(order('1', 2), 1, DRIVER_ID)).toBe(false)
  })

  it('всегда показывает заказ, в котором водитель уже участвует', () => {
    const taken = order('1', 3, EBookingDriverState.Started)

    expect(canDriverTakeOrderBySeats(taken, 0, DRIVER_ID)).toBe(true)
  })

})

describe('filterOrdersByFreeSeats', () => {

  it('оставляет только заказы по вместимости и свои поездки', () => {
    const activeOrders = [order('taken', 3, EBookingDriverState.Started)]
    const freeSeats = getDriverFreeSeats(car(4), activeOrders, DRIVER_ID)
    const orders = [
      ...activeOrders,
      order('one-seat', 1),
      order('two-seats', 2),
      order('no-count'),
    ]

    expect(filterOrdersByFreeSeats(orders, freeSeats, DRIVER_ID)?.map(item => item.b_id))
      .toEqual(['taken', 'one-seat', 'no-count'])
  })

  it('возвращает null для отсутствующего списка', () => {
    expect(filterOrdersByFreeSeats(null, 4, DRIVER_ID)).toBeNull()
  })

})
