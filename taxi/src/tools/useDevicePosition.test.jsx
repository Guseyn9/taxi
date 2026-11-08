import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useDevicePosition } from './useDevicePosition'
import { LOCATION_MAX_AGE_MS } from './locationFreshness'

let root, container
beforeEach(() => { jest.useFakeTimers(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers() })
const fix = (latitude, longitude, extra = {}) => ({ timestamp: Date.now(), coords: { latitude, longitude, accuracy: 10 }, ...extra })
function Fixture({ position }) { return <output>{JSON.stringify(useDevicePosition(position))}</output> }
const show = position => act(() => root.render(<Fixture position={position} />))

test('an ordinary device accepts a fresh relocated fix and recovers after GPS failure', () => {
  show(fix(30, -9)); expect(container.textContent).toBe('[30,-9]')
  show(fix(31, -8)); expect(container.textContent).toBe('[31,-8]')
  show(undefined); expect(container.textContent).toBe('null')
  show(fix(0, 0)); expect(container.textContent).toBe('[0,0]')
  show(fix(30, -9, { coords: { latitude: 30, longitude: -9, accuracy: 1000 } })); expect(container.textContent).toBe('null')
})
test('a displayed fix expires without requiring any network, render or GPS event', () => {
  show(fix(30, -9))
  act(() => jest.advanceTimersByTime(LOCATION_MAX_AGE_MS + 1))
  expect(container.textContent).toBe('null')
})
test('replacement cancels the previous expiration and unmount releases the timer', () => {
  show(fix(30, -9)); act(() => jest.advanceTimersByTime(30000))
  show(fix(31, -8)); act(() => jest.advanceTimersByTime(30001))
  expect(container.textContent).toBe('[31,-8]')
  act(() => root.unmount()); root = createRoot(container)
  expect(jest.getTimerCount()).toBe(0)
})
