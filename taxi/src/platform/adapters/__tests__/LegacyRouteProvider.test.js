import { backendGateway } from '../LegacyBackendGateway'
import { LegacyRouteProvider } from '../LegacyRouteProvider'

jest.mock('../LegacyBackendGateway', () => ({
  backendGateway: {
    makeRoutePoints: jest.fn(),
  },
}))

const FROM = { latitude: 55.7, longitude: 37.5, address: 'A' }
const TO = { latitude: 55.8, longitude: 37.6, address: 'B' }

describe('LegacyRouteProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  it('returns a usable legacy API route first', async() => {
    const route = {
      distance: 10,
      time: { hours: 0, minutes: 20 },
      points: [[55.7, 37.5], [55.75, 37.55], [55.8, 37.6]],
    }
    backendGateway.makeRoutePoints.mockResolvedValueOnce(route)

    await expect(new LegacyRouteProvider().makeRoutePoints(FROM, TO)).resolves.toEqual(route)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('uses the local road graph before the OSRM fallback', async() => {
    backendGateway.makeRoutePoints.mockRejectedValueOnce(new Error('offline'))
    const startNode = { id: 1, latitude: 55.71, longitude: 37.51 }
    const endNode = { id: 2, latitude: 55.79, longitude: 37.59 }
    const wayGraph = {
      findClosestNode: jest.fn()
        .mockReturnValueOnce([startNode, 10])
        .mockReturnValueOnce([endNode, 10]),
      findShortestPath: jest.fn().mockReturnValue([[startNode, endNode], 5000]),
    }

    const route = await new LegacyRouteProvider().makeRoutePoints(FROM, TO, wayGraph)

    expect(route.distance).toBe(5)
    expect(route.points).toHaveLength(4)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
