/**
 * Driver trip plan — an ordered list of stops the driver still has to visit.
 *
 * Until now the driver map navigated exactly ONE order: pickup, then dropoff.
 * Same-way ("попутные") orders break that assumption — the driver can carry two
 * passengers at once, so the route becomes a sequence of pickups and dropoffs
 * belonging to different orders.
 *
 * This module answers one question and nothing else: given the driver's active
 * orders and where they are now, in which ORDER should the remaining stops be
 * visited? It is pure (no React, no network, no side effects) so the ordering
 * rule can be unit-tested on its own.
 *
 * The rule, as agreed with the product owner: always head for the nearest stop
 * that is currently allowed, where a dropoff is only allowed once that order's
 * passenger is on board. In practice that reproduces the expected behaviour —
 * a same-way passenger whose pickup is right ahead is collected first, and once
 * everyone is aboard whoever's destination is closest is dropped off first.
 *
 * Two constraints the caller must respect (they are the difference between a
 * stable route and an infinite rebuild loop):
 *
 *   1. Feed RAW order coordinates here. Road-snapped coordinates must be applied
 *      to the RESULT, never to the input — otherwise snapping changes the
 *      ordering, which changes what gets snapped.
 *   2. Rebuild the plan only when the SET of stops changes (an order was taken,
 *      declined, completed or advanced a state), not on every position update.
 *      The position is only a starting cursor; recomputing it every tick would
 *      make the order flip mid-drive and re-trigger route building each time.
 */

import { EBookingDriverState, IOrder, IUser } from '../types/types'
import { haversineMeters } from './driverRouteEmulator'

/** Distances here are only ever compared with each other, so metres are fine. */
type TCoordinate = [number, number]

export enum ETripStopKind {
  /** Забрать пассажира. */
  Pickup = 'pickup',
  /** Высадить пассажира. */
  Dropoff = 'dropoff',
}

export interface ITripStop {
  orderId: string
  kind: ETripStopKind
  lat: number
  lng: number
  order: IOrder
  /**
   * Заказ ещё НЕ взят: точка добавлена в маршрут «на пробу», чтобы водитель
   * доехал до попутчика и там решил, брать его или нет.
   */
  pending?: boolean
}

export interface ITripPlanInput {
  /** Заказы, которые водитель уже выполняет. */
  activeOrders?: IOrder[] | null
  userId?: IUser['u_id'] | null
  /** Откуда водитель поедет — стартовый курсор обхода. */
  position?: TCoordinate | null
  /** Попутные кандидаты: дают только точку посадки, помеченную `pending`. */
  candidateOrders?: IOrder[] | null
  /**
   * Голосовые заказы с подтверждённым кодом посадки. Бэкенд оставляет такого
   * водителя в `Performer`, хотя пассажир уже в салоне — считаем их за
   * `Started`, иначе маршрут повёл бы обратно к точке посадки.
   */
  boardedOrderIds?: string[] | null
}

/** Состояния, в которых заказ ведёт водителя по маршруту. */
const NAVIGATION_STATES = [
  EBookingDriverState.Performer,
  EBookingDriverState.Arrived,
  EBookingDriverState.Started,
]

function sameUser(driverID: unknown, userID?: IUser['u_id'] | null): boolean {
  return userID !== undefined && userID !== null && String(driverID) === String(userID)
}

/** Состояние текущего водителя в заказе, если он в нём участвует. */
export function getMyDriverState(
  order: IOrder,
  userID?: IUser['u_id'] | null,
): EBookingDriverState | undefined {
  return order?.drivers?.find(driver => sameUser(driver.u_id, userID))?.c_state
}

/**
 * Координата заказа. Нули отбрасываем: бэкенд отдаёт (0, 0) для заказов без
 * геоданных, и такая точка утащила бы маршрут в Атлантику.
 */
function coordinate(latitude?: number, longitude?: number): TCoordinate | null {
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng))
    return null

  return [lat, lng]
}

function makeStop(
  order: IOrder,
  kind: ETripStopKind,
  point: TCoordinate,
  pending?: boolean,
): ITripStop {
  return {
    orderId: String(order.b_id),
    kind,
    lat: point[0],
    lng: point[1],
    order,
    ...(pending ? { pending: true } : {}),
  }
}

/** Стабильный идентификатор точки маршрута. */
export function getTripStopKey(stop: ITripStop): string {
  return `${stop.orderId}:${stop.kind}`
}

/**
 * Подпись всего плана. Ею гейтится перестроение маршрута эмулятора: пока
 * подпись та же — модель уже едет по нужной геометрии и трогать её нельзя.
 */
export function getTripPlanKey(stops: ITripStop[]): string {
  return stops.map(getTripStopKey).join('|')
}

/**
 * Точка, к которой относится шаг поездки («Поехал» / «Приехал» / «Завершить»).
 *
 * Кандидат в попутчики своих шагов не имеет — его заказ ещё не взят, — поэтому
 * действие остаётся за ближайшим ВЗЯТЫМ заказом. Без этого водитель, которому
 * попутчик выпал первой точкой плана, не смог бы нажать даже «Поехал», и маркер
 * никогда бы не тронулся с места.
 */
export function getTripActionStop(stops: ITripStop[]): ITripStop | null {
  return stops.find(stop => !stop.pending) ?? null
}

/**
 * Осталась ли ровно одна взятая точка — то есть ведёт ли текущий шаг к КОНЦУ
 * поездки, а не к промежуточной высадке. От этого зависит подпись кнопки:
 * промежуточная закрывает один заказ («Завершить заказ №N»), последняя — всю
 * поездку («Завершить поездку»).
 *
 * Кандидаты в попутчики не в счёт: решение по ним ещё не принято, и поездку они
 * пока не продлевают.
 */
export function isFinalTripStop(stops: ITripStop[]): boolean {
  return stops.filter(stop => !stop.pending).length <= 1
}

/** Заказы, участвующие в плане, в порядке первого появления. */
export function getTripPlanOrderIds(stops: ITripStop[]): string[] {
  const seen: string[] = []
  stops.forEach(stop => {
    if (!seen.includes(stop.orderId))
      seen.push(stop.orderId)
  })
  return seen
}

/**
 * Порядок обхода. Сравниваем расстояния, а при совпадении — ключи точек:
 * без детерминированного тай-брейка равноудалённые точки меняются местами от
 * пересчёта к пересчёту, подпись плана «дрожит» и маршрут строится заново.
 */
function isCloser(candidate: ITripStop, best: ITripStop, from: TCoordinate): boolean {
  const candidateDistance = haversineMeters(
    { lat: from[0], lng: from[1] },
    { lat: candidate.lat, lng: candidate.lng },
  )
  const bestDistance = haversineMeters(
    { lat: from[0], lng: from[1] },
    { lat: best.lat, lng: best.lng },
  )

  if (Math.abs(candidateDistance - bestDistance) > 1e-6)
    return candidateDistance < bestDistance

  return getTripStopKey(candidate) < getTripStopKey(best)
}

/**
 * Собирает точки, которые водителю ещё предстоит посетить, и упорядочивает их
 * жадным обходом «ближайшая допустимая точка».
 */
export function buildDriverTripPlan(input: ITripPlanInput): ITripStop[] {
  const { userId, position } = input
  const boarded = new Set((input.boardedOrderIds ?? []).map(String))
  const stops: ITripStop[] = []
  /** Заказы, чей пассажир уже в салоне — их высадка доступна сразу. */
  const onBoard = new Set<string>()
  const planned = new Set<string>()

  ;(input.activeOrders ?? []).forEach(order => {
    if (!order?.b_id)
      return

    const state = getMyDriverState(order, userId)
    if (state === undefined || !NAVIGATION_STATES.includes(state))
      return

    const orderId = String(order.b_id)
    if (planned.has(orderId))
      return
    planned.add(orderId)

    const pickup = coordinate(order.b_start_latitude, order.b_start_longitude)
    const dropoff = coordinate(order.b_destination_latitude, order.b_destination_longitude)
    const isOnBoard = state === EBookingDriverState.Started || boarded.has(orderId)

    // Пассажир ещё не в машине — сначала за ним. Заказ без координат подачи
    // высаживать всё равно надо, поэтому его высадку не блокируем.
    if (!isOnBoard && pickup)
      stops.push(makeStop(order, ETripStopKind.Pickup, pickup))
    else
      onBoard.add(orderId)

    if (dropoff)
      stops.push(makeStop(order, ETripStopKind.Dropoff, dropoff))
  })

  // Попутные кандидаты дают только точку посадки: высадка появится, когда заказ
  // будет реально взят и придёт в активные.
  ;(input.candidateOrders ?? []).forEach(order => {
    if (!order?.b_id)
      return

    const orderId = String(order.b_id)
    if (planned.has(orderId))
      return
    planned.add(orderId)

    const pickup = coordinate(order.b_start_latitude, order.b_start_longitude)
    if (pickup)
      stops.push(makeStop(order, ETripStopKind.Pickup, pickup, true))
  })

  if (stops.length < 2)
    return stops

  const remaining = stops.slice()
  const ordered: ITripStop[] = []
  let cursor: TCoordinate = position ?? [remaining[0].lat, remaining[0].lng]

  while (remaining.length) {
    // Высадка допустима, только когда пассажир этого заказа уже в салоне.
    const allowed = remaining.filter(stop =>
      stop.kind === ETripStopKind.Pickup || onBoard.has(stop.orderId),
    )
    // Пустым `allowed` быть не может (у каждой высадки есть своя посадка), но
    // если данные заказа окажутся неполными — лучше отдать точку, чем зациклиться.
    const pool = allowed.length ? allowed : remaining

    let best = pool[0]
    for (let index = 1; index < pool.length; index += 1) {
      if (isCloser(pool[index], best, cursor))
        best = pool[index]
    }

    remaining.splice(remaining.indexOf(best), 1)
    ordered.push(best)
    if (best.kind === ETripStopKind.Pickup)
      onBoard.add(best.orderId)
    cursor = [best.lat, best.lng]
  }

  return ordered
}
