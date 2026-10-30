import moment from 'moment'
import { isCompletedOrder } from './terminalOrder'
import { EBookingDriverState, EBookingStates } from '../../types/types'

it('uses the terminal booking state even when the driver still reports Started', () => {
  const order = {
    b_state: EBookingStates.Completed,
    b_completed: undefined,
    drivers: [{ c_state: EBookingDriverState.Started }],
  }
  expect(isCompletedOrder(order)).toBe(true)
})

it('does not treat a live or cancelled booking as completed', () => {
  expect(isCompletedOrder({ b_state: EBookingStates.Approved, b_completed: undefined })).toBe(false)
  expect(isCompletedOrder({ b_state: EBookingStates.Canceled, b_completed: moment() })).toBe(false)
})
