import type { IWayGraph } from '../../tools/maps'
import type { IAddressPoint, IRouteInfo } from '../../types/types'
import { backendGateway } from './LegacyBackendGateway'

/** Route provider preserving the legacy ORS -> local graph -> OSRM strategy. */
export class LegacyRouteProvider {
  async makeRoutePoints(
    from: IAddressPoint,
    to: IAddressPoint,
    wayGraph?: IWayGraph,
  ): Promise<IRouteInfo> {
    try {
      const apiRoute = await backendGateway.makeRoutePoints(from, to)
      if (isUsableRouteInfo(apiRoute))
        return apiRoute
    } catch {
      // Continue with providers that do not require the legacy route API.
    }

    const localRoute = makeLocalRoutePoints(from, to, wayGraph)
    if (isUsableRouteInfo(localRoute))
      return localRoute

    try {
      const osrmRoute = await makeOsrmRoutePoints(from, to)
      if (isUsableRouteInfo(osrmRoute))
        return osrmRoute
    } catch (error) {
      console.error(error)
    }

    throw new Error('Route by roads is not available')
  }
}

async function makeOsrmRoutePoints(
  from: IAddressPoint,
  to: IAddressPoint,
): Promise<IRouteInfo | null> {
  if (!from.latitude || !from.longitude || !to.latitude || !to.longitude)
    return null

  const url = [
    'https://router.project-osrm.org/route/v1/driving/',
    `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`,
    '?overview=full&geometries=geojson',
  ].join('')
  const response = await fetch(url)
  if (!response.ok)
    return null

  const data = await response.json()
  const route = data?.routes?.[0]
  const coordinates = route?.geometry?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2)
    return null

  const durationSeconds = Number(route.duration) || 0
  const hours = Math.floor(durationSeconds / 3600)
  const minutes = Math.max(1, Math.round((durationSeconds - hours * 3600) / 60))

  return {
    distance: parseFloat(((Number(route.distance) || 0) / 1000).toFixed(2)),
    time: { hours, minutes },
    points: coordinates.map((item: [number, number]) => [item[1], item[0]]),
  }
}

function isUsableRouteInfo(route: IRouteInfo | null | undefined): route is IRouteInfo {
  return Boolean(
    route &&
    Array.isArray(route.points) &&
    route.points.length > 2 &&
    route.points.every(point =>
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]),
    ),
  )
}

function makeLocalRoutePoints(
  from: IAddressPoint,
  to: IAddressPoint,
  wayGraph?: IWayGraph,
): IRouteInfo | null {
  if (!wayGraph || !from.latitude || !from.longitude || !to.latitude || !to.longitude)
    return null

  const [startNode] = wayGraph.findClosestNode(from.latitude, from.longitude)
  const [endNode] = wayGraph.findClosestNode(to.latitude, to.longitude)
  if (!startNode || !endNode)
    return null

  const [path, distanceMeters] = wayGraph.findShortestPath(startNode.id, endNode.id)
  if (path.length < 2 || !Number.isFinite(distanceMeters))
    return null

  const minutes = Math.max(1, Math.round(distanceMeters / 1000 / 35 * 60))
  return {
    distance: parseFloat((distanceMeters / 1000).toFixed(2)),
    time: {
      hours: Math.floor(minutes / 60),
      minutes: minutes % 60,
    },
    points: [
      [from.latitude, from.longitude],
      ...path.map(node => [node.latitude, node.longitude] as [number, number]),
      [to.latitude, to.longitude],
    ],
  }
}

export const legacyRouteProvider = new LegacyRouteProvider()
