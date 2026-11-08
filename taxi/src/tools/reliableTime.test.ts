import { getStableRemainingLifetimeSeconds as remaining } from './reliableTime'
it('does not restart a countdown from renders or unchanged polling', () => {
  const o = { b_id: 'time-static', remaining_lifetime_seconds: 60 }
  expect(remaining(o, 1000)).toBe(60); expect(remaining({ ...o }, 11000)).toBe(50)
})
it('accepts a short server extension including after the previous deadline reached zero', () => {
  const o = { b_id: 'time-extend', remaining_lifetime_seconds: 40, b_max_waiting: 60 }
  expect(remaining(o, 1000)).toBe(40)
  expect(remaining({ ...o, remaining_lifetime_seconds: 55 }, 11000)).toBe(55)
  expect(remaining({ ...o, remaining_lifetime_seconds: 0 }, 70000)).toBe(0)
  expect(remaining({ ...o, remaining_lifetime_seconds: 30 }, 71000)).toBe(30)
})
it('accepts a changed waiting interval without freezing an identical remaining value', () => {
  const o = { b_id: 'time-interval', remaining_lifetime_seconds: 30, b_max_waiting: 60 }
  remaining(o, 1000); expect(remaining({ ...o, b_max_waiting: 90 }, 11000)).toBe(30)
  expect(remaining({ ...o, remaining_lifetime_seconds: Infinity }, 11000)).toBeNull()
})
