import {
  DriverOrderEventAdapter,
  IDriverOrderSnapshot,
  diffDriverOrderEvents,
} from './driverOrderEventAdapter'
import { EDriverExternalEventType } from './driverRouteEmulator'
import { EBookingDriverState, IOrder } from '../types/types'

const ME = 'me'

interface IMakeOrderOptions {
  voting?: boolean
  myState?: EBookingDriverState
  startLat?: number
  startLng?: number
  destLat?: number
  destLng?: number
}

function makeOrder(id: string, options: IMakeOrderOptions = {}): IOrder {
  return {
    b_id: id,
    b_start_latitude: options.startLat ?? 47.20,
    b_start_longitude: options.startLng ?? 39.60,
    b_destination_latitude: options.destLat ?? 47.30,
    b_destination_longitude: options.destLng ?? 39.70,
    b_voting: options.voting,
    drivers: options.myState !== undefined ?
      [{ u_id: ME, c_id: 'car-1', c_state: options.myState }] :
      [],
  } as unknown as IOrder
}

function snapshot(active: IOrder[], ready: IOrder[]): IDriverOrderSnapshot {
  return { activeOrders: active, readyOrders: ready }
}

const types = (events: ReturnType<typeof diffDriverOrderEvents>) => events.map(event => event.type)

describe('diffDriverOrderEvents', () => {
  it('emits nothing on the baseline snapshot', () => {
    const events = diffDriverOrderEvents(null, snapshot([], [makeOrder('a')]), { userId: ME })
    expect(events).toEqual([])
  })

  it('emits NEW_ORDER for a freshly appeared plain ready order', () => {
    const prev = snapshot([], [])
    const next = snapshot([], [makeOrder('a')])
    const events = diffDriverOrderEvents(prev, next, { userId: ME })

    expect(types(events)).toEqual([EDriverExternalEventType.NewOrder])
    expect(events[0].orderId).toBe('a')
    expect(events[0].pickup).toEqual({ lat: 47.20, lng: 39.60 })
    expect(events[0].dropoff).toEqual({ lat: 47.30, lng: 39.70 })
  })

  it('emits NEW_VOTING_ORDER for a freshly appeared voting ready order', () => {
    const prev = snapshot([], [])
    const next = snapshot([], [makeOrder('v', { voting: true })])
    expect(types(diffDriverOrderEvents(prev, next, { userId: ME })))
      .toEqual([EDriverExternalEventType.NewVotingOrder])
  })

  it('emits NEW_ALONG_THE_WAY_ORDER when a new order appears while the driver is en route', () => {
    const activeTrip = makeOrder('trip', { myState: EBookingDriverState.Started })
    const prev = snapshot([activeTrip], [])
    const next = snapshot([activeTrip], [makeOrder('same-way')])

    expect(types(diffDriverOrderEvents(prev, next, { userId: ME })))
      .toEqual([EDriverExternalEventType.NewAlongTheWayOrder])
  })

  it('emits ORDER_ACCEPTED when the current driver becomes the performer', () => {
    const prev = snapshot([makeOrder('a', { myState: EBookingDriverState.Considering })], [])
    const next = snapshot([makeOrder('a', { myState: EBookingDriverState.Performer })], [])

    expect(types(diffDriverOrderEvents(prev, next, { userId: ME })))
      .toEqual([EDriverExternalEventType.OrderAccepted])
  })

  it('emits VOTING_WON when the driver becomes performer on a voting order', () => {
    const prev = snapshot([makeOrder('v', { voting: true, myState: EBookingDriverState.Considering })], [])
    const next = snapshot([makeOrder('v', { voting: true, myState: EBookingDriverState.Performer })], [])

    expect(types(diffDriverOrderEvents(prev, next, { userId: ME })))
      .toEqual([EDriverExternalEventType.VotingWon])
  })

  it('does not re-emit ORDER_ACCEPTED once already performing', () => {
    const prev = snapshot([makeOrder('a', { myState: EBookingDriverState.Performer })], [])
    const next = snapshot([makeOrder('a', { myState: EBookingDriverState.Arrived })], [])

    expect(diffDriverOrderEvents(prev, next, { userId: ME })).toEqual([])
  })

  it('emits ORDER_CANCELLED when my state flips to Canceled while driving', () => {
    const prev = snapshot([makeOrder('a', { myState: EBookingDriverState.Performer })], [])
    const next = snapshot([makeOrder('a', { myState: EBookingDriverState.Canceled })], [])

    expect(types(diffDriverOrderEvents(prev, next, { userId: ME })))
      .toEqual([EDriverExternalEventType.OrderCancelled])
  })

  it('emits ORDER_CANCELLED when an order I was driving disappears entirely', () => {
    const prev = snapshot([makeOrder('a', { myState: EBookingDriverState.Started })], [])
    const next = snapshot([], [])

    expect(types(diffDriverOrderEvents(prev, next, { userId: ME })))
      .toEqual([EDriverExternalEventType.OrderCancelled])
  })

  it('ignores lifecycle transitions of other drivers', () => {
    const otherPrev = { b_id: 'a', drivers: [{ u_id: 'someone-else', c_id: 'c', c_state: EBookingDriverState.Considering }] } as unknown as IOrder
    const otherNext = { b_id: 'a', drivers: [{ u_id: 'someone-else', c_id: 'c', c_state: EBookingDriverState.Performer }] } as unknown as IOrder

    expect(diffDriverOrderEvents(snapshot([otherPrev], []), snapshot([otherNext], []), { userId: ME }))
      .toEqual([])
  })
})

describe('DriverOrderEventAdapter', () => {
  it('establishes a silent baseline, then diffs subsequent snapshots', () => {
    const adapter = new DriverOrderEventAdapter({ userId: ME })

    expect(adapter.ingest(snapshot([], []))).toEqual([])
    const events = adapter.ingest(snapshot([], [makeOrder('a')]))
    expect(types(events)).toEqual([EDriverExternalEventType.NewOrder])
    // The same snapshot again yields no new events (already known order).
    expect(adapter.ingest(snapshot([], [makeOrder('a')]))).toEqual([])
  })

  it('reset() forgets the baseline so the next ingest is silent again', () => {
    const adapter = new DriverOrderEventAdapter({ userId: ME })
    adapter.ingest(snapshot([], [makeOrder('a')]))
    adapter.reset()
    expect(adapter.ingest(snapshot([], [makeOrder('a'), makeOrder('b')]))).toEqual([])
  })
})
