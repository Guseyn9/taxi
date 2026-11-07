import { parseApiBoolean } from './boolean'
import { convertOrder, convertDriver } from './convert'
import { sameUser } from './identity'
import { calculateFinalPriceValue, calculateFinalPrice, updateCompletedOrderDuration } from './order'
import { participantName } from './identity'

it.each([true, 1, '1', 'true', ' TRUE ', 2])('preserves a true wire flag %p', (value: unknown) => {
  expect(parseApiBoolean(value)).toBe(true)
  expect(convertOrder({ b_voting: value } as any).b_voting).toBe(true)
  expect(convertDriver({ c_arrive_state: value } as any).c_arrive_state).toBe(true)
})
it.each([false, 0, '0', 'false', ' FALSE ', null, undefined, '', 'truthy', NaN, Infinity])('does not enable invalid/false flag %p', (value: unknown) => expect(parseApiBoolean(value)).toBe(false))
it('numeric and string identities match; missing identities never match', () => {
  expect(sameUser(1420, '1420')).toBe(true); expect(sameUser(null, null)).toBe(false); expect(sameUser('', '')).toBe(false)
})
it('calculation has a numeric model value while retaining the legacy display API', () => {
  const o = { b_options: { pricingModel: { formula: 'duration * 2', options: { duration: 3 } } } } as any
  expect(calculateFinalPriceValue(o)).toBe(6); expect(calculateFinalPrice(o)).toBe('6')
  const completed = updateCompletedOrderDuration({ ...o, b_state: 4, b_completed: '2026-11-03T10:05:00Z', drivers: [{ c_started: '2026-11-03T10:00:00Z' }] } as any)
  expect(completed.b_options!.pricingModel!.price).toBe(10)
  expect(calculateFinalPriceValue({ b_options: { pricingModel: { formula: '1/0' } } } as any)).toBeNull()
})
it('uses one authoritative identity without repeating the driver name from every API record', () => {
  expect(participantName({u_name:'Ali',u_family:'Hassan'}, {u_name:'Ali',u_family:'Hassan'})).toBe('Ali Hassan')
  expect(participantName(null, {u_name:'',u_family:''}, {u_name:'Mina'})).toBe('Mina')
  expect(participantName(undefined, {})).toBe('')
})
