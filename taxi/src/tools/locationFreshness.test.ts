import { isFreshDevicePosition, LOCATION_MAX_AGE_MS } from './locationFreshness'
import reducer from '../state/geolocation/reducer'
import { geoposition } from '../state/geolocation/selectors'
import { ActionTypes } from '../state/geolocation/constants'

const fix = (timestamp = Date.now(), coords: any = {}) => ({ timestamp, coords: { latitude: 0, longitude: 0, accuracy: 10, ...coords } } as GeolocationPosition)
it('accepts a recent physical fix including zero coordinates and rejects expired/future fixes', () => {
  const now = Date.now()
  expect(isFreshDevicePosition(fix(now), now)).toBe(true)
  expect(isFreshDevicePosition(fix(now - LOCATION_MAX_AGE_MS), now)).toBe(true)
  expect(isFreshDevicePosition(fix(now - LOCATION_MAX_AGE_MS - 1), now)).toBe(false)
  expect(isFreshDevicePosition(fix(now + 5001), now)).toBe(false)
})
it.each([{ accuracy: 201 }, { accuracy: -1 }, { accuracy: NaN }, { latitude: 91 }, { longitude: -181 }, { latitude: '0' }])('rejects invalid or low-quality fixes %p', (coords: any) => {
  expect(isFreshDevicePosition(fix(Date.now(), coords))).toBe(false)
})
it('a permission/read failure invalidates the previous successful Redux fix', () => {
  const position = fix()
  const valid = reducer(undefined, { type: ActionTypes.GET_SUCCESS, payload: position })
  expect(geoposition({ geolocation: valid } as any)).toBe(position)
  const failed = reducer(valid, { type: ActionTypes.GET_FAIL, payload: { code: 1 } })
  expect(geoposition({ geolocation: failed } as any)).toBeUndefined()
  expect(geoposition({ geolocation: valid } as any)).toBe(position)
})
