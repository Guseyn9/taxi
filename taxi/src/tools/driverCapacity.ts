import SITE_CONSTANTS from '../siteConstants'
import { EBookingDriverState, ICar, IOrder, IUser } from '../types/types'

/** Вместимость салона, когда ни у машины, ни у её класса нет данных о числе мест. */
export const DEFAULT_CAR_SEATS = 4

/**
 * Состояния, в которых места заказа уже заняты: водитель едет за пассажирами,
 * ждёт их или уже везёт. До посадки места тоже считаем занятыми — они
 * зарезервированы за этим заказом.
 */
const SEATS_OCCUPYING_STATES = [
  EBookingDriverState.Performer,
  EBookingDriverState.Arrived,
  EBookingDriverState.Started,
]

function toPositiveInt(value: unknown): number | undefined {
  const number = Number(value)

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined
}

/** Сколько мест занимает заказ. Без указанного числа пассажиров считаем одного. */
export function getOrderSeatsCount(order?: IOrder | null): number {
  return toPositiveInt(order?.b_passengers_count) ?? 1
}

/** Вместимость: сначала данные самой машины, затем её класса, затем дефолт. */
export function getCarCapacity(car?: ICar | null): number {
  const carSeats = toPositiveInt(car?.seats)
  if (carSeats)
    return carSeats

  const carClassSeats = car?.cc_id ?
    toPositiveInt(SITE_CONSTANTS.CAR_CLASSES[car.cc_id]?.seats) :
    undefined

  return carClassSeats ?? DEFAULT_CAR_SEATS
}

function isSameUser(driverID: unknown, userID?: IUser['u_id']) {
  return userID !== undefined && userID !== null && String(driverID) === String(userID)
}

/** Заказ, который водитель уже выполняет, — его пассажиры занимают места. */
export function isSeatsOccupyingOrder(order: IOrder, userID?: IUser['u_id']): boolean {
  return !!order?.drivers?.some(driver =>
    isSameUser(driver.u_id, userID) &&
    SEATS_OCCUPYING_STATES.includes(driver.c_state),
  )
}

/**
 * Водитель уже участвует в заказе (взял, откликнулся, голосует). Такой заказ
 * из списка не убираем: он либо уже его, либо решение по нему принято раньше.
 */
export function isDriverParticipatingOrder(order: IOrder, userID?: IUser['u_id']): boolean {
  return !!order?.drivers?.some(driver =>
    isSameUser(driver.u_id, userID) &&
    driver.c_state !== EBookingDriverState.Canceled,
  )
}

/** Сколько мест в салоне уже занято текущими поездками водителя. */
export function getOccupiedSeats(
  orders?: IOrder[] | null,
  userID?: IUser['u_id'],
): number {
  return (orders ?? []).reduce(
    (sum, order) => isSeatsOccupyingOrder(order, userID) ? sum + getOrderSeatsCount(order) : sum,
    0,
  )
}

/** Сколько мест осталось свободными с учётом уже взятых заказов. */
export function getDriverFreeSeats(
  car?: ICar | null,
  activeOrders?: IOrder[] | null,
  userID?: IUser['u_id'],
): number {
  return Math.max(0, getCarCapacity(car) - getOccupiedSeats(activeOrders, userID))
}

/** Помещается ли заказ в оставшиеся места. Свои заказы проходят всегда. */
export function canDriverTakeOrderBySeats(
  order: IOrder,
  freeSeats: number,
  userID?: IUser['u_id'],
): boolean {
  if (isDriverParticipatingOrder(order, userID))
    return true

  return getOrderSeatsCount(order) <= freeSeats
}

/**
 * Оставляет только те заказы, которые водитель реально может взять: число
 * пассажиров не больше свободных мест в салоне.
 */
export function filterOrdersByFreeSeats<T extends IOrder>(
  orders: T[] | null | undefined,
  freeSeats: number,
  userID?: IUser['u_id'],
): T[] | null {
  if (!orders)
    return null

  return orders.filter(order => canDriverTakeOrderBySeats(order, freeSeats, userID))
}
