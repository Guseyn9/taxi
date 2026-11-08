import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useDemoOrderPoints } from './useDemoOrderPoints'
import { snapToRoad } from './mapReachability'

jest.mock('./mapReachability', () => ({ snapToRoad: jest.fn(), REACHABLE_ROAD_METERS: 25 }))
jest.mock('./rawLog', () => ({ writeRawLog: jest.fn() }))

const first = { b_id: '1', b_start_latitude: 30.42, b_start_longitude: -9.59 }
const second = { b_id: '2', b_start_latitude: 30.43, b_start_longitude: -9.58 }
const stop = order => ({ order, orderId: order.b_id, kind: 'pickup', lat: 0, lng: 0 })
const snapped = { latitude: 30.421, longitude: -9.591, roadDistanceMeters: 100, source: 'osrm' }
function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
let root, host
function View({ enabled = true, stops, retryNonce = 0 }) {
  const points = useDemoOrderPoints(enabled, stops, retryNonce)
  return <output>{JSON.stringify(points)}</output>
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true
  snapToRoad.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete global.IS_REACT_ACT_ENVIRONMENT
})
const output = () => JSON.parse(host.textContent)

test('adding another order during a pending snap preserves both results without repeating the first request', async() => {
  const one = deferred(), two = deferred()
  snapToRoad.mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise)
  await act(async() => root.render(<View stops={[stop(first)]} />))
  await act(async() => root.render(<View stops={[stop(first), stop(second)]} />))
  await act(async() => { one.resolve(snapped); two.resolve(snapped) })
  expect(snapToRoad).toHaveBeenCalledTimes(2)
  expect(output()).toEqual({ '1': { start: [30.421, -9.591], destination: null }, '2': { start: [30.421, -9.591], destination: null } })
})

test('coordinates updated under the same order ID replace the old snapped point', async() => {
  snapToRoad.mockResolvedValueOnce(snapped).mockResolvedValueOnce({ ...snapped, latitude: 30.5 })
  await act(async() => root.render(<View stops={[stop(first)]} />))
  await act(async() => root.render(<View stops={[stop({ ...first, b_start_latitude: 30.51 })]} />))
  expect(output()['1'].start).toEqual([30.5, -9.591])
  expect(snapToRoad).toHaveBeenCalledTimes(2)
})

test('React effect replay still applies the pending result once', async() => {
  const request = deferred()
  snapToRoad.mockReturnValue(request.promise)
  await act(async() => root.render(<StrictMode><View stops={[stop(first)]} /></StrictMode>))
  await act(async() => { request.resolve(snapped) })
  expect(output()['1']?.start).toEqual([30.421, -9.591])
  expect(snapToRoad).toHaveBeenCalledTimes(1)
})

test('real booking coordinates never trigger the emulator snap adapter', async() => {
  await act(async() => root.render(<View enabled={false} stops={[stop(first)]} />))
  expect(output()).toEqual({})
  expect(snapToRoad).not.toHaveBeenCalled()
})

test('a slow second order does not delay an already resolved first order', async() => {
  const one = deferred(), two = deferred()
  snapToRoad.mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise)
  await act(async() => root.render(<View stops={[stop(first), stop(second)]} />))
  await act(async() => { one.resolve(snapped) })
  expect(output()['1'].start).toEqual([30.421, -9.591])
  expect(output()['2']).toBeUndefined()
  await act(async() => { two.resolve(snapped) })
  expect(Object.keys(output())).toEqual(['1', '2'])
})

test('an old response cannot overwrite changed coordinates or briefly expose the previous point', async() => {
  const old = deferred(), changed = deferred()
  snapToRoad.mockReturnValueOnce(old.promise).mockReturnValueOnce(changed.promise)
  await act(async() => root.render(<View stops={[stop(first)]} />))
  await act(async() => root.render(<View stops={[stop({ ...first, b_start_latitude: 30.51 })]} />))
  expect(output()).toEqual({})
  await act(async() => { changed.resolve({ ...snapped, latitude: 30.5 }) })
  await act(async() => { old.resolve(snapped) })
  expect(output()['1'].start).toEqual([30.5, -9.591])
})

test('removed orders are forgotten and their pending results never reappear', async() => {
  const old = deferred()
  snapToRoad.mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapped)
  await act(async() => root.render(<View stops={[stop(first), stop(second)]} />))
  await act(async() => root.render(<View stops={[stop(second)]} />))
  await act(async() => { old.resolve(snapped) })
  expect(Object.keys(output())).toEqual(['2'])
  await act(async() => root.render(<View stops={[]} />))
  expect(output()).toEqual({})
})

test('disabling emulator drops its points and ignores old pending work when it is enabled again', async() => {
  const old = deferred(), next = deferred()
  snapToRoad.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
  await act(async() => root.render(<View stops={[stop(first)]} />))
  await act(async() => root.render(<View enabled={false} stops={[stop(first)]} />))
  expect(output()).toEqual({})
  await act(async() => root.render(<View stops={[stop(first)]} />))
  await act(async() => { old.resolve(snapped) })
  expect(output()).toEqual({})
  await act(async() => { next.resolve({ ...snapped, latitude: 30.6 }) })
  expect(output()['1'].start).toEqual([30.6, -9.591])
  expect(snapToRoad).toHaveBeenCalledTimes(2)
})

test('duplicate pickup/dropoff stops and unrelated metadata or GPS changes do not repeat the work', async() => {
  snapToRoad.mockResolvedValue(snapped)
  const order = { ...first, b_destination_latitude: 30.44, b_destination_longitude: -9.57 }
  await act(async() => root.render(<View stops={[stop(order), { ...stop(order), kind: 'dropoff' }]} />))
  const updatedStops = [
    { ...stop({ ...order, b_start_address: 'different display address' }), lat: 31, lng: -10 },
    { ...stop(order), kind: 'dropoff' },
  ]
  await act(async() => root.render(<View stops={updatedStops} />))
  expect(snapToRoad).toHaveBeenCalledTimes(2)
  expect(output()['1']).toEqual({ start: [30.421, -9.591], destination: [30.421, -9.591] })
})

test('one failed endpoint does not discard the destination or another order', async() => {
  snapToRoad.mockRejectedValueOnce(new Error('nearest unavailable')).mockResolvedValue(snapped)
  const stops = [
    stop({ ...first, b_destination_latitude: 30.44, b_destination_longitude: -9.57 }), stop(second),
  ]
  await act(async() => root.render(<View stops={stops} />))
  expect(output()['1']).toEqual({ start: null, destination: [30.421, -9.591] })
  expect(output()['2'].start).toEqual([30.421, -9.591])
})

test('points already near a road keep their exact booked coordinates', async() => {
  snapToRoad.mockResolvedValue({ ...snapped, roadDistanceMeters: 25 })
  await act(async() => root.render(<View stops={[stop(first)]} />))
  expect(output()).toEqual({})
})

test.each([null, undefined, '', ' ', false, true, 'bad', NaN, Infinity, 91])(
  'invalid latitude %s is never sent to the adapter', async(value) => {
    await act(async() => root.render(<View stops={[stop({ ...first, b_start_latitude: value })]} />))
    expect(output()).toEqual({})
    expect(snapToRoad).not.toHaveBeenCalled()
  },
)

test('ignores a pending result after unmount', async() => {
  const pending = deferred(), errors = jest.spyOn(console, 'error').mockImplementation(() => {})
  snapToRoad.mockReturnValue(pending.promise)
  try {
    await act(async() => root.render(<View stops={[stop(first)]} />))
    act(() => root.unmount())
    root = createRoot(host)
    await act(async() => { pending.resolve(snapped) })
    expect(errors).not.toHaveBeenCalled()
  } finally { errors.mockRestore() }
})

test('a stalled-route recovery retries unavailable points and replaces a partial result', async() => {
  const order = { ...first, b_destination_latitude: 30.44, b_destination_longitude: -9.57 }
  snapToRoad.mockResolvedValueOnce(snapped).mockResolvedValueOnce(null).mockResolvedValue(snapped)
  await act(async() => root.render(<View stops={[stop(order)]} />))
  expect(output()['1']).toEqual({ start: [30.421, -9.591], destination: null })
  await act(async() => root.render(<View stops={[stop(order)]} retryNonce={1} />))
  expect(output()['1']).toEqual({ start: [30.421, -9.591], destination: [30.421, -9.591] })
})

test('a later plan update can recover a previous miss instead of keeping it forever', async() => {
  snapToRoad.mockResolvedValueOnce(null).mockResolvedValue(snapped)
  await act(async() => root.render(<View stops={[stop(first)]} />))
  expect(output()).toEqual({})
  await act(async() => root.render(<View stops={[stop(first), stop(second)]} />))
  expect(output()['1']?.start).toEqual([30.421, -9.591])
  expect(output()['2']?.start).toEqual([30.421, -9.591])
})

test('a successful near-road result is retained when route recovery is requested', async() => {
  snapToRoad.mockResolvedValueOnce({ ...snapped, roadDistanceMeters: 0 }).mockResolvedValue(snapped)
  await act(async() => root.render(<View stops={[stop(first)]} />))
  await act(async() => root.render(<View stops={[stop(first), stop(second)]} retryNonce={1} />))
  expect(output()['1']).toBeUndefined()
  expect(snapToRoad).toHaveBeenCalledTimes(2)
})
