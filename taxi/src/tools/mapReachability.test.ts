import { jest, test, expect, beforeEach, afterEach } from '@jest/globals'

type Adapter = typeof import('./mapReachability')
type ResponseStub = { ok: boolean, json: () => Promise<unknown> }
type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<ResponseStub>
let adapter: Adapter
let fetchMock: ReturnType<typeof jest.fn<FetchStub>>
const point = { latitude: 30.42, longitude: -9.59 }
const body = { code: 'Ok', waypoints: [{ location: [-9.591, 30.421], distance: 100 }] }
const response = (data: unknown = body) => ({ ok: true, json: async() => data })
const originalFetch = globalThis.fetch

beforeEach(() => {
  jest.resetModules()
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-11-04T12:00:00Z'))
  fetchMock = jest.fn<FetchStub>().mockResolvedValue(response())
  // The adapter consumes only ok/json/signal; no external network is used here.
  globalThis.fetch = fetchMock as unknown as typeof fetch
  adapter = require('./mapReachability')
})
afterEach(() => {
  jest.useRealTimers()
  globalThis.fetch = originalFetch
})

test('parallel requests for the same rounded coordinate share one HTTP request', async() => {
  let resolve: (value: ResponseStub) => void = () => {}
  fetchMock.mockReturnValue(new Promise(yes => { resolve = yes }))
  const one = adapter.snapToRoad(point)
  const two = adapter.snapToRoad({ latitude: 30.4200001, longitude: -9.5900001 })
  resolve(response())
  expect(await one).toEqual(await two)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('a transient failure expires so a later user action can recover without reloading', async() => {
  fetchMock.mockRejectedValueOnce(new Error('offline'))
  expect(await adapter.snapToRoad(point)).toBeNull()
  expect(await adapter.snapToRoad(point)).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(5001)
  expect(await adapter.snapToRoad(point)).toMatchObject({ latitude: 30.421, source: 'osrm' })
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('successful results expire rather than living forever', async() => {
  await adapter.snapToRoad(point)
  jest.advanceTimersByTime(15 * 60 * 1000 + 1)
  await adapter.snapToRoad(point)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('the response cache has a finite size and evicts the oldest untouched coordinate', async() => {
  for (let i = 0; i < 257; i++) await adapter.snapToRoad({ ...point, latitude: 30 + i / 1000 })
  await adapter.snapToRoad({ ...point, latitude: 30 })
  expect(fetchMock).toHaveBeenCalledTimes(258)
})

test('a timeout settles even if the fetch adapter does not react to AbortSignal', async() => {
  fetchMock.mockReturnValue(new Promise(() => {}))
  const pending = adapter.snapToRoad(point)
  const completed = jest.fn()
  pending.then(completed)
  await jest.advanceTimersByTimeAsync(6001)
  expect(completed).toHaveBeenCalledWith(null)
})

test('cache hits protect the recently used coordinate from LRU eviction', async() => {
  for (let i = 0; i < 256; i++) await adapter.snapToRoad({ ...point, latitude: 30 + i / 1000 })
  await adapter.snapToRoad({ ...point, latitude: 30 })
  await adapter.snapToRoad({ ...point, latitude: 31 })
  await adapter.snapToRoad({ ...point, latitude: 30 })
  expect(fetchMock).toHaveBeenCalledTimes(257)
  await adapter.snapToRoad({ ...point, latitude: 30.001 })
  expect(fetchMock).toHaveBeenCalledTimes(258)
})

test('changing the system clock does not invalidate the monotonic cache lifetime', async() => {
  await adapter.snapToRoad(point)
  jest.setSystemTime(new Date('2099-11-04T12:00:00Z'))
  await adapter.snapToRoad(point)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(15 * 60 * 1000 + 1)
  await adapter.snapToRoad(point)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('a slow JSON body is included in the same finite timeout', async() => {
  fetchMock.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) })
  const pending = adapter.snapToRoad(point)
  await jest.advanceTimersByTimeAsync(6001)
  expect(await pending).toBeNull()
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  expect(jest.getTimerCount()).toBe(0)
})

test('timeout still works when AbortController is unavailable', async() => {
  const original = globalThis.AbortController
  Object.defineProperty(globalThis, 'AbortController', { configurable: true, writable: true, value: undefined })
  try {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const pending = adapter.snapToRoad(point)
    await jest.advanceTimersByTimeAsync(6001)
    expect(await pending).toBeNull()
    expect(fetchMock.mock.calls[0][1]).toBeUndefined()
  } finally { globalThis.AbortController = original }
})

test('a late timed-out response cannot overwrite a later successful result', async() => {
  let resolve: (value: ResponseStub) => void = () => {}
  fetchMock.mockReturnValueOnce(new Promise(yes => { resolve = yes }))
  const pending = adapter.snapToRoad(point)
  await jest.advanceTimersByTimeAsync(6001)
  expect(await pending).toBeNull()
  jest.advanceTimersByTime(5001)
  fetchMock.mockResolvedValue(response({ waypoints: [{ location: [-9.6, 30.5], distance: 50 }] }))
  expect(await adapter.snapToRoad(point)).toMatchObject({ latitude: 30.5 })
  resolve(response())
  await jest.advanceTimersByTimeAsync(0)
  expect(await adapter.snapToRoad(point)).toMatchObject({ latitude: 30.5 })
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('callers cannot mutate shared cached or coalesced result objects', async() => {
  const [one, two] = await Promise.all([adapter.snapToRoad(point), adapter.snapToRoad(point)])
  one!.latitude = 80
  expect(two!.latitude).toBe(30.421)
  expect((await adapter.snapToRoad(point))!.latitude).toBe(30.421)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('saturation is bounded and does not poison the skipped coordinate cache', async() => {
  let resolve: (value: ResponseStub) => void = () => {}
  fetchMock.mockReturnValue(new Promise(yes => { resolve = yes }))
  const pending = Array.from({ length: 16 }, (_, i) => adapter.snapToRoad({ ...point, latitude: 30 + i / 1000 }))
  const duplicate = adapter.snapToRoad({ ...point, latitude: 30 })
  const skipped = adapter.snapToRoad(point)
  expect(fetchMock).toHaveBeenCalledTimes(16)
  expect(await skipped).toBeNull()
  resolve(response())
  await Promise.all([...pending, duplicate])
  fetchMock.mockResolvedValue(response())
  expect(await adapter.snapToRoad(point)).not.toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(17)
})

test('timing out an uncancelable read does not free a physical request slot prematurely', async() => {
  let resolve: (value: ResponseStub) => void = () => {}
  fetchMock.mockReturnValue(new Promise(yes => { resolve = yes }))
  const pending = Array.from({ length: 16 }, (_, i) => adapter.snapToRoad({ ...point, latitude: 30 + i / 1000 }))
  await jest.advanceTimersByTimeAsync(6001)
  expect(await Promise.all(pending)).toEqual(Array(16).fill(null))
  const skipped = adapter.snapToRoad(point)
  expect(fetchMock).toHaveBeenCalledTimes(16)
  expect(await skipped).toBeNull()
  resolve(response())
  await jest.advanceTimersByTimeAsync(0)
  fetchMock.mockResolvedValue(response())
  expect(await adapter.snapToRoad(point)).not.toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(17)
})

test.each([
  undefined, null, {}, { latitude: null, longitude: -9.59 },
  { latitude: ' ', longitude: -9.59 }, { latitude: false, longitude: -9.59 },
  { latitude: NaN, longitude: -9.59 }, { latitude: 91, longitude: -9.59 },
  { latitude: 30.42, longitude: 181 }, { latitude: 30.42, longitude: Infinity },
])('does not request an invalid coordinate %p', async(candidate) => {
  expect(await adapter.snapToRoad(candidate as Parameters<Adapter['snapToRoad']>[0])).toBeNull()
  expect(fetchMock).not.toHaveBeenCalled()
})

test.each([
  { waypoints: [] }, { code: 'NoSegment', waypoints: body.waypoints },
  { waypoints: [{ location: [null, 30], distance: 100 }] },
  { waypoints: [{ location: [-9.59, false], distance: 100 }] },
  { waypoints: [{ location: [-190, 30], distance: 100 }] },
  { waypoints: [{ location: [-9.59, 91], distance: 100 }] },
  { waypoints: [{ location: [-9.59, 30], distance: null }] },
  { waypoints: [{ location: [-9.59, 30], distance: -1 }] },
  { waypoints: [{ location: [-9.59, 30], distance: Infinity }] },
])('does not put a malformed provider result on the map: %p', async(data) => {
  fetchMock.mockResolvedValue(response(data))
  expect(await adapter.snapToRoad(point)).toBeNull()
})

test('valid zero coordinates and zero distance are preserved', async() => {
  fetchMock.mockResolvedValue(response({ waypoints: [{ location: [0, 0], distance: 0 }] }))
  expect(await adapter.snapToRoad({ latitude: 0, longitude: 0 })).toEqual({ latitude: 0, longitude: 0, roadDistanceMeters: 0, source: 'osrm' })
})

test('an HTTP failure and invalid JSON retain best-effort reachability without an automatic retry', async() => {
  fetchMock.mockResolvedValueOnce({ ok: false, json: async() => null })
    .mockResolvedValueOnce({ ok: true, json: async() => { throw Error('JSON') } })
  expect(await adapter.isReachable(point)).toBe(true)
  expect(await adapter.isReachable({ ...point, latitude: 31 })).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(jest.getTimerCount()).toBe(0)
})

test('the generator retains metadata and chooses the nearest candidate before snapping', async() => {
  fetchMock.mockResolvedValueOnce(response({ waypoints: [{ location: [-9.5, 30.5], distance: 150 }] }))
    .mockResolvedValueOnce(response({ waypoints: [{ location: [-9.6, 30.6], distance: 100 }] }))
  const generate = jest.fn((i: number) => ({ latitude: 30 + i / 10, longitude: -9.59, label: `candidate-${i}` }))
  expect(await adapter.ensureReachablePoint(generate, { maxAttempts: 2 })).toEqual({
    point: { latitude: 30.6, longitude: -9.6, label: 'candidate-1' },
    roadDistanceMeters: 100, snapped: true, attempts: 2, source: 'snapped',
  })
})

test('the generator keeps the original point when a road is already nearby or the provider is unavailable', async() => {
  fetchMock.mockResolvedValueOnce(response({ waypoints: [{ location: [-9.591, 30.421], distance: 25 }] }))
    .mockRejectedValueOnce(Error('offline'))
  const original = { ...point, label: 'pickup' }
  expect(await adapter.ensureReachablePoint(() => original)).toMatchObject({ point: original, source: 'reachable', snapped: false, attempts: 1 })
  const other = { ...point, latitude: 31, label: 'destination' }
  expect(await adapter.ensureReachablePoint(() => other)).toMatchObject({ point: other, source: 'fallback', snapped: false, attempts: 1 })
})
