import { runSaga, stdChannel } from 'redux-saga'
import { saga } from '../sagas'
import reducer from '../reducer'
import { ActionTypes } from '../constants'
import { getPolygonsIdsOnPoint } from '../../../API'
import { getCurrentPosition } from '../../../tools/utils'
import { zoneChecksReady, retryZonePoint } from '../../../design/reliability/zoneCheck'
jest.mock('../../../API', () => ({ getPolygonsIdsOnPoint: jest.fn(), reverseGeocode: jest.fn(), getPointSuggestions: jest.fn() }))
jest.mock('../../../siteConstants', () => ({ __esModule: true, default: {
  DEFAULT_CAR_CLASS: 'petit', DEFAULT_BOOKING_LOCATION_CLASS: 'city',
  BOOKING_LOCATION_CLASSES: [{ id: 'city', kind: 0 }],
  CAR_CLASSES: { petit: { id: 'petit', seats: 4, max_seats: 4 } }, BOOKING_COMMENTS: {},
} }))
jest.mock('../../config', () => ({ configConstants: { ActionTypes: { SET_CONFIG_SUCCESS: 'config/success' } } }))
jest.mock('../selectors', () => ({ moduleSelector: state => state.clientOrder }))
jest.mock('../../../tools/utils', () => ({
  firstItem: value => Array.from(value || [])[0], getPhoneNumberError: () => null,
  shortenAddress: value => value, getCurrentPosition: jest.fn(),
}))
jest.mock('../../../tools/addressBook', () => ({ rememberPersonalAddress: jest.fn() }))
jest.mock('../util', () => ({
  availableCarClasses: () => [{ id: 'petit', seats: 4 }],
  manualLocationClasses: () => [{ id: 'city' }], polygonsLocationClasses: () => [{ id: 'city' }],
  carClassSupportsLocationClass: () => true, carClassAllowedForRoute: () => true, maxAvailableSeats: () => 4,
}))

const point = { latitude: 30.4278, longitude: -9.5981, address: 'Agadir' }
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => jest.requireActual('timers').setImmediate(resolve)) }
const tasks = []
function start() {
  const channel = stdChannel()
  let state = { clientOrder: reducer(undefined, { type: '@@init' }) }
  const dispatch = action => { state = { clientOrder: reducer(state.clientOrder, action) }; channel.put(action) }
  const task = runSaga({ channel, dispatch, getState: () => state }, saga)
  tasks.push(task)
  return { dispatch, value: () => state.clientOrder }
}
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { tasks.splice(0).forEach(task => task.cancel()); jest.restoreAllMocks(); localStorage.clear() })

test('failed destination is explicit; retry confirms only that point and preserves the successful pickup', async () => {
  getPolygonsIdsOnPoint.mockResolvedValueOnce(['79']).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce([])
  const store = start()
  store.dispatch({ type: ActionTypes.SET_FROM_REQUEST, payload: point }); await settle()
  store.dispatch({ type: ActionTypes.SET_TO_REQUEST, payload: { ...point, latitude: 30.43 } })
  expect(store.value().toZoneStatus).toBe('checking'); await settle()
  expect(store.value().fromZoneStatus).toBe('ready')
  expect(store.value().toZoneStatus).toBe('error'); expect(store.value().toLoading).toBe(false)
  expect(zoneChecksReady(store.value())).toBe(false)
  const selected = store.value().to
  store.dispatch({ type: ActionTypes.SET_TO_REQUEST, payload: retryZonePoint(selected) })
  expect(store.value().toZoneStatus).toBe('checking'); await settle()
  expect(store.value().toZoneStatus).toBe('ready'); expect(store.value().toPolygons).toEqual([])
  expect(store.value().fromPolygons).toEqual(['79']); expect(zoneChecksReady(store.value())).toBe(true)
  expect(getPolygonsIdsOnPoint.mock.calls).toEqual([[[30.4278, -9.5981]], [[30.43, -9.5981]], [[30.43, -9.5981]]])
  expect(getCurrentPosition).not.toHaveBeenCalled()
})
test.each(['resolve', 'reject'])('late %s from an old address cannot overwrite the latest successful zone', async outcome => {
  let resolveOld, rejectOld
  getPolygonsIdsOnPoint.mockReturnValueOnce(new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject }))
    .mockResolvedValueOnce(['new-zone'])
  const store = start()
  store.dispatch({ type: ActionTypes.SET_FROM_REQUEST, payload: point }); await settle()
  store.dispatch({ type: ActionTypes.SET_FROM_REQUEST, payload: { ...point, latitude: 30.44 } }); await settle()
  if (outcome === 'resolve') resolveOld(['old-zone']); else rejectOld(new Error('old timeout'))
  await settle()
  expect(store.value().fromZoneStatus).toBe('ready')
  expect(store.value().fromPolygons).toEqual(['new-zone']); expect(store.value().from.latitude).toBe(30.44)
})
test('changing and clearing an address invalidates confirmation immediately', async () => {
  getPolygonsIdsOnPoint.mockResolvedValue(['79'])
  const store = start()
  store.dispatch({ type: ActionTypes.SET_FROM_REQUEST, payload: point })
  store.dispatch({ type: ActionTypes.SET_TO_REQUEST, payload: point }); await settle()
  expect(zoneChecksReady(store.value())).toBe(true)
  store.dispatch({ type: ActionTypes.SET_TO_REQUEST, payload: null }); await settle()
  expect(store.value().toZoneStatus).toBe('idle'); expect(store.value().toPolygons).toBeNull()
  expect(zoneChecksReady(store.value())).toBe(false)
  expect(getPolygonsIdsOnPoint).toHaveBeenCalledTimes(2)
})
test('pending pickup and destination checks stay independent', async () => {
  let finishPickup
  getPolygonsIdsOnPoint.mockReturnValueOnce(new Promise(resolve => { finishPickup = resolve })).mockRejectedValueOnce(new Error('offline'))
  const store = start()
  store.dispatch({ type: ActionTypes.SET_FROM_REQUEST, payload: point })
  store.dispatch({ type: ActionTypes.SET_TO_REQUEST, payload: point }); await settle()
  expect(store.value().fromZoneStatus).toBe('checking'); expect(store.value().toZoneStatus).toBe('error')
  finishPickup(['79']); await settle()
  expect(store.value().fromZoneStatus).toBe('ready'); expect(store.value().toZoneStatus).toBe('error')
  expect(zoneChecksReady(store.value())).toBe(false)
})
