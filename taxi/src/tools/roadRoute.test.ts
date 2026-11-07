import { makeLocalRoutePoints, makeOsrmRoutePoints, isUsableRouteInfo } from './roadRoute'
import { PackedWayGraph, packArea } from '../graph/packed'
import { LegacyRouteProvider } from '../platform/adapters/LegacyRouteProvider'
import { backendGateway } from '../platform/adapters/LegacyBackendGateway'

jest.mock('../platform/adapters/LegacyBackendGateway', () => ({ backendGateway: { makeRoutePoints: jest.fn() } }))
const from = { latitude: 30.41, longitude: -9.59 }
const to = { latitude: 30.42, longitude: -9.59 }
const nodes = [{ ...from, id: 1 }, { ...to, id: 2 }]
const area = { id: 0, nodes, ways: [{ id: 10, segments: [{ nodeId: 1, weight: 0 }, { nodeId: 2, weight: 1200 }] }] }
const response = { routes: [{ distance: 1200, duration: 180, geometry: { coordinates: [[-9.59, 30.41], [-9.59, 30.415], [-9.59, 30.42]] } }] }
beforeEach(() => { jest.clearAllMocks(); global.fetch = jest.fn() })

it('routes valid zero coordinates and rejects missing, nonfinite and out-of-range coordinates', async () => {
  ;(fetch as any).mockResolvedValue({ ok: true, json: async () => response })
  expect(await makeOsrmRoutePoints({ latitude: 0, longitude: 0 } as any, to as any)).not.toBeNull()
  for (const point of [{latitude: null, longitude: -9}, {latitude: NaN, longitude: -9}, {latitude: 91, longitude: -9}, {latitude: 30, longitude: 181}])
    expect(await makeOsrmRoutePoints(point as any, to as any)).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['connection', 'body'])('terminates a stalled OSRM %s, including providers that ignore abort', async (phase: 'connection' | 'body') => {
  jest.useFakeTimers()
  ;(fetch as any).mockImplementation(() => phase === 'body' ? Promise.resolve({ ok: true, json: () => new Promise(() => {}) }) : new Promise(() => {}))
  try {
    const result = makeOsrmRoutePoints(from as any, to as any)
    const rejected = expect(result).rejects.toMatchObject({ code: 'ROUTE_QUERY_TIMEOUT' })
    await jest.advanceTimersByTimeAsync(10001); await rejected
    expect((fetch as any).mock.calls[0][1].signal.aborted).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  } finally { jest.useRealTimers() }
})

it('uses the real packed graph inside its coverage and sends out-of-area points to OSRM', async () => {
  const graph = new PackedWayGraph(packArea(area as any))
  expect(makeLocalRoutePoints(from as any, to as any, graph)?.distance).toBe(1.2)
  const outsideFrom = { latitude: 33.57, longitude: -7.58 }, outsideTo = { latitude: 34.02, longitude: -6.83 }
  expect(graph.findClosestNode(outsideFrom.latitude, outsideFrom.longitude)[0]).toBeUndefined()
  expect(makeLocalRoutePoints(outsideFrom as any, outsideTo as any, graph)).toBeNull()
  ;(backendGateway.makeRoutePoints as any).mockRejectedValue(new Error('ORS unavailable'))
  ;(fetch as any).mockResolvedValue({ ok: true, json: async () => response })
  expect(await new LegacyRouteProvider().makeRoutePoints(outsideFrom as any, outsideTo as any, graph)).not.toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('rejects remote graph nodes even when an adapter reports a misleading snap distance', () => {
  const graph = { findClosestNode: jest.fn().mockReturnValueOnce([nodes[0], 0]).mockReturnValueOnce([nodes[1], 0]), findShortestPath: jest.fn() }
  expect(makeLocalRoutePoints({latitude: 33.57,longitude:-7.58} as any, {latitude:34.02,longitude:-6.83} as any, graph as any)).toBeNull()
  expect(graph.findShortestPath).not.toHaveBeenCalled()
})

it('includes short endpoint snaps and rejects impossible or malformed routes', async () => {
  const graph = new PackedWayGraph(packArea(area as any))
  const route = makeLocalRoutePoints({latitude:30.4099,longitude:-9.59} as any, {latitude:30.4201,longitude:-9.59} as any, graph)
  expect(route?.distance).toBeGreaterThan(1.2)
  const fake = {findClosestNode:jest.fn().mockReturnValueOnce([nodes[0],0]).mockReturnValueOnce([nodes[1],0]),findShortestPath:()=>[nodes,1]}
  expect(makeLocalRoutePoints(from as any,to as any,fake as any)).toBeNull()
  ;(fetch as any).mockResolvedValue({ok:true,json:async()=>({routes:[{...response.routes[0],distance:NaN}]})})
  expect(await makeOsrmRoutePoints(from as any,to as any)).toBeNull()
  expect(isUsableRouteInfo({distance:1,points:[[91,0],[0,0]]} as any)).toBe(false)
})
