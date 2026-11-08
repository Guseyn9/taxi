import { runSaga } from 'redux-saga'
import moment from 'moment'
import * as API from '../../../API'
import { cancelExpiredOrdersSaga } from '../sagas'
import { EBookingStates, EBookingDriverState, EUserRoles } from '../../../types/types'
jest.mock('../../../API', () => ({ getOrder: jest.fn(), cancelDrive: jest.fn() }))

let serial = 0
const expired = () => ({ b_id: `expiry-regression-${++serial}`, b_voting: true, b_state: EBookingStates.Processing,
  b_created: moment().subtract(30, 'minutes'), b_start_datetime: moment().subtract(30, 'minutes'),
  b_max_waiting: 60, remaining_lifetime_seconds: 0, drivers: [] })
const run = order => runSaga({ dispatch: () => {}, getState: () => ({ user: { user: { u_id: 'client', u_role: EUserRoles.Client } } }) }, cancelExpiredOrdersSaga, [order]).toPromise()
beforeEach(() => jest.clearAllMocks())
it('does not cancel an order whose deadline was extended on the server', async () => {
  const stale = expired(), fresh = { ...stale, remaining_lifetime_seconds: 12 }
  API.getOrder.mockResolvedValue(fresh)
  expect(await run(stale)).toEqual([fresh]); expect(API.cancelDrive).not.toHaveBeenCalled()
})
it('does not cancel after a driver has been selected', async () => {
  const stale = expired(), fresh = { ...stale, drivers: [{ u_id: 'driver', c_state: EBookingDriverState.Performer }] }
  API.getOrder.mockResolvedValue(fresh)
  expect(await run(stale)).toEqual([fresh]); expect(API.cancelDrive).not.toHaveBeenCalled()
})
it('keeps the order when expiry cannot be confirmed', async () => {
  const stale = expired(), error = jest.spyOn(console, 'error').mockImplementation(() => {})
  API.getOrder.mockRejectedValue(new Error('offline'))
  try { expect(await run(stale)).toEqual([stale]); expect(API.cancelDrive).not.toHaveBeenCalled() } finally { error.mockRestore() }
})
it('keeps the order until cancellation is read back as cancelled', async () => {
  const stale = expired()
  API.getOrder.mockResolvedValue(stale); API.cancelDrive.mockResolvedValue({ code: 200 })
  expect(await run(stale)).toEqual([stale]); expect(API.cancelDrive).toHaveBeenCalledTimes(1)
})
