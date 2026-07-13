/**
 * Adapter-differ: turns Redux order lists (activeOrders / readyOrders) into the
 * world events the DriverRouteEmulator understands (`IDriverExternalEvent`).
 *
 * This lives OUTSIDE the emulator on purpose. The emulator is "dumb": it only
 * re-transmits events via `dispatch` and never interprets them. All the domain
 * knowledge — what a new order is, when the current driver became the performer,
 * when a voting order was won, what counts as a cancellation — is encoded here,
 * in the adapter. A future FSM can replace this adapter (or consume the same
 * events) without touching the emulator core.
 *
 * The adapter is a pure diff over two consecutive snapshots. The very first
 * snapshot only establishes a baseline and emits nothing, so a page reload with
 * an already-taken order does not fire a spurious ORDER_ACCEPTED.
 */

import {
  EDriverExternalEventType,
  IDriverExternalEvent,
  IGeoPoint,
} from './driverRouteEmulator'
import { isVotingOrder } from './driverOffer'
import { EBookingDriverState, IOrder, IUser } from '../types/types'

export interface IDriverOrderSnapshot {
  activeOrders: IOrder[] | null
  readyOrders: IOrder[] | null
}

export interface IDriverOrderEventAdapterContext {
  /** The current driver — whose perspective the lifecycle events are seen from. */
  userId?: IUser['u_id'] | null
}

/** States in which the current driver is actively servicing a trip. */
const DRIVING_STATES = [
  EBookingDriverState.Performer,
  EBookingDriverState.Arrived,
  EBookingDriverState.Started,
]

function myDriverState(order: IOrder, userId?: IUser['u_id'] | null): EBookingDriverState | undefined {
  if (!userId)
    return undefined

  return order.drivers?.find(driver => String(driver.u_id) === String(userId))?.c_state
}

function isDrivingState(state?: EBookingDriverState): boolean {
  return state !== undefined && DRIVING_STATES.includes(state)
}

/** Performer or any later state (Performer/Arrived/Started/Finished). */
function isPerformerOrBeyond(state?: EBookingDriverState): boolean {
  return state !== undefined && state >= EBookingDriverState.Performer
}

/** True while the driver is en route on some active order (context for "along the way"). */
function isDriverEnRoute(snapshot: IDriverOrderSnapshot, userId?: IUser['u_id'] | null): boolean {
  return (snapshot.activeOrders ?? []).some(order => isDrivingState(myDriverState(order, userId)))
}

function coordinate(lat?: number, lng?: number): IGeoPoint | null {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (!latitude && !longitude))
    return null

  return { lat: latitude, lng: longitude }
}

function orderPickup(order: IOrder): IGeoPoint | null {
  return coordinate(order.b_start_latitude, order.b_start_longitude)
}

function orderDropoff(order: IOrder): IGeoPoint | null {
  return coordinate(order.b_destination_latitude, order.b_destination_longitude)
}

function toEvent(type: EDriverExternalEventType, order: IOrder): IDriverExternalEvent {
  return {
    type,
    orderId: String(order.b_id),
    pickup: orderPickup(order),
    dropoff: orderDropoff(order),
    payload: { order },
  }
}

function indexOrdersById(snapshot: IDriverOrderSnapshot | null): Map<string, IOrder> {
  const map = new Map<string, IOrder>()
  if (!snapshot)
    return map

  ;[...(snapshot.activeOrders ?? []), ...(snapshot.readyOrders ?? [])].forEach(order => {
    if (order?.b_id)
      map.set(String(order.b_id), order)
  })
  return map
}

/**
 * Diff two consecutive order snapshots into world events for the current driver.
 * Returns [] for the baseline (prev === null). Never mutates its inputs.
 */
export function diffDriverOrderEvents(
  prev: IDriverOrderSnapshot | null,
  next: IDriverOrderSnapshot,
  ctx: IDriverOrderEventAdapterContext = {},
): IDriverExternalEvent[] {
  if (!prev)
    return []

  const userId = ctx.userId
  const events: IDriverExternalEvent[] = []
  const prevById = indexOrdersById(prev)
  const nextById = indexOrdersById(next)

  // 1) Newly appeared ready orders → NEW_ORDER / NEW_VOTING_ORDER / NEW_ALONG_THE_WAY_ORDER.
  const prevReadyIds = new Set((prev.readyOrders ?? []).map(order => String(order.b_id)))
  ;(next.readyOrders ?? []).forEach(order => {
    const id = String(order.b_id)
    if (prevReadyIds.has(id))
      return

    if (isVotingOrder(order))
      events.push(toEvent(EDriverExternalEventType.NewVotingOrder, order))
    else if (isDriverEnRoute(next, userId))
      // The driver is already on a trip and a new plain order shows up: a
      // potential same-way pickup. The adapter only flags it; deciding whether
      // to actually take it is left to the consumer (FSM later).
      events.push(toEvent(EDriverExternalEventType.NewAlongTheWayOrder, order))
    else
      events.push(toEvent(EDriverExternalEventType.NewOrder, order))
  })

  // 2) Lifecycle transitions of the current driver on active orders.
  ;(next.activeOrders ?? []).forEach(order => {
    const id = String(order.b_id)
    const nowState = myDriverState(order, userId)
    const prevState = myDriverState(prevById.get(id) ?? order, userId)
    const wasPresent = prevById.has(id)

    // Became the performer for the first time.
    if (
      nowState === EBookingDriverState.Performer &&
      (!wasPresent || !isPerformerOrBeyond(prevState))
    ) {
      events.push(toEvent(
        isVotingOrder(order) ? EDriverExternalEventType.VotingWon : EDriverExternalEventType.OrderAccepted,
        order,
      ))
    }

    // Cancelled while driving (still visible, but my state flipped to Canceled).
    if (isDrivingState(prevState) && nowState === EBookingDriverState.Canceled)
      events.push(toEvent(EDriverExternalEventType.OrderCancelled, order))
  })

  // 3) Orders that vanished entirely while I was driving → treated as cancelled.
  ;(prev.activeOrders ?? []).forEach(order => {
    const id = String(order.b_id)
    if (nextById.has(id))
      return

    if (isDrivingState(myDriverState(order, userId)))
      events.push(toEvent(EDriverExternalEventType.OrderCancelled, order))
  })

  return events
}

function cloneSnapshot(snapshot: IDriverOrderSnapshot): IDriverOrderSnapshot {
  return {
    activeOrders: snapshot.activeOrders ? [...snapshot.activeOrders] : null,
    readyOrders: snapshot.readyOrders ? [...snapshot.readyOrders] : null,
  }
}

/**
 * Stateful wrapper around `diffDriverOrderEvents`. Feed it the latest snapshot
 * with `ingest`; it remembers the previous one and returns the events for the
 * transition. Wire the returned events straight into `emulator.dispatch`.
 */
export class DriverOrderEventAdapter {
  private previous: IDriverOrderSnapshot | null = null
  private context: IDriverOrderEventAdapterContext

  constructor(context: IDriverOrderEventAdapterContext = {}) {
    this.context = { ...context }
  }

  /** Update the observed driver without losing the baseline snapshot. */
  setContext(context: IDriverOrderEventAdapterContext) {
    this.context = { ...this.context, ...context }
  }

  /** Diff against the previous snapshot, store the new one, return the events. */
  ingest(snapshot: IDriverOrderSnapshot): IDriverExternalEvent[] {
    const events = diffDriverOrderEvents(this.previous, snapshot, this.context)
    this.previous = cloneSnapshot(snapshot)
    return events
  }

  /** Forget the baseline so the next ingest establishes a fresh one silently. */
  reset() {
    this.previous = null
  }
}
