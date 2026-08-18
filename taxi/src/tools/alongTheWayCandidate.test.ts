import { EBookingDriverState, IOrder } from '../types/types'
import { isAlongTheWayCandidate } from './alongTheWayCandidate'

const DRIVER_ID = 'driver-1'

function order(id: string, extra: Record<string, unknown> = {}): IOrder {
  return {
    b_id: id,
    b_passengers_count: 1,
    b_cars_count: 1,
    drivers: [],
    ...extra,
  } as unknown as IOrder
}

const context = (extra: Record<string, unknown> = {}) => ({
  userId: DRIVER_ID,
  freeSeats: 3,
  ...extra,
})

describe('isAlongTheWayCandidate', () => {

  it('пропускает обычный заказ, который помещается по местам', () => {
    expect(isAlongTheWayCandidate(order('A'), context())).toBe(true)
  })

  it('отсекает заказ, для которого не хватает мест', () => {
    expect(isAlongTheWayCandidate(order('A', { b_passengers_count: 4 }), context())).toBe(false)
  })

  it('отсекает голосование', () => {
    expect(isAlongTheWayCandidate(order('A', { b_voting: true }), context())).toBe(false)
  })

  it('отсекает оффер', () => {
    expect(isAlongTheWayCandidate(order('A', { b_cars_count: 0 }), context())).toBe(false)
  })

  it('отсекает заказ, в котором водитель уже участвует', () => {
    const mine = order('A', {
      drivers: [{ u_id: DRIVER_ID, c_state: EBookingDriverState.Performer }],
    })

    expect(isAlongTheWayCandidate(mine, context())).toBe(false)
  })

  it('не мешает чужому участию', () => {
    const foreign = order('A', {
      drivers: [{ u_id: 'other-driver', c_state: EBookingDriverState.Performer }],
    })

    expect(isAlongTheWayCandidate(foreign, context())).toBe(true)
  })

  it('отсекает заказ, от которого водитель уже отказался', () => {
    expect(isAlongTheWayCandidate(order('A'), context({ declinedOrderIds: { A: true } }))).toBe(false)
  })

  it('отсекает пустой заказ', () => {
    expect(isAlongTheWayCandidate(null, context())).toBe(false)
    expect(isAlongTheWayCandidate(order(''), context())).toBe(false)
  })

})
