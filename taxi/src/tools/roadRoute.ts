import type { IAddressPoint, IRouteInfo } from '../types/types'
import type { IWayGraph } from './maps'
import { calculateDistance } from './maps'
import { withHttpDeadline } from '../platform/adapters/httpDeadline'

// Small endpoint snapping is allowed; a local graph is never a country-wide fallback.
export const MAX_LOCAL_ROUTE_SNAP_METERS = 100
export const ROUTE_QUERY_TIMEOUT_MS = 10000

export function validRoutePoint(point: IAddressPoint | null | undefined): point is IAddressPoint & { latitude: number, longitude: number } {
  if (!point) return false
  return Number.isFinite(point.latitude) && Math.abs(point.latitude!) <= 90 &&
    Number.isFinite(point.longitude) && Math.abs(point.longitude!) <= 180
}

export function isUsableRouteInfo(route: IRouteInfo | null | undefined): route is IRouteInfo {
  return Boolean(route && Number.isFinite(route.distance) && route.distance >= 0 &&
    Array.isArray(route.points) && route.points.length >= 2 && route.points.every(point =>
      Array.isArray(point) && validRoutePoint({ latitude: point[0], longitude: point[1] } as IAddressPoint)))
}

export async function makeOsrmRoutePoints(from: IAddressPoint, to: IAddressPoint): Promise<IRouteInfo | null> {
  if (!validRoutePoint(from) || !validRoutePoint(to)) return null
  const url = `https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`
  const data = await withHttpDeadline(async signal => {
    const response = await fetch(url, { signal })
    return response.ok ? response.json() : null
  }, ROUTE_QUERY_TIMEOUT_MS, 'ROUTE_QUERY_TIMEOUT')
  const route = data?.routes?.[0]
  const coordinates = route?.geometry?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2 ||
    !Number.isFinite(route.distance) || route.distance < 0 ||
    !Number.isFinite(route.duration) || route.duration < 0) return null
  const durationMinutes = Math.max(1, Math.round(route.duration / 60))
  const result: IRouteInfo = {
    distance: Number((route.distance / 1000).toFixed(2)),
    time: { hours: Math.floor(durationMinutes / 60), minutes: durationMinutes % 60 },
    points: coordinates.map((point: [number, number]) => [point[1], point[0]]),
  }
  return isUsableRouteInfo(result) ? result : null
}

export function makeLocalRoutePoints(from: IAddressPoint, to: IAddressPoint, graph?: IWayGraph): IRouteInfo | null {
  if (!graph || !validRoutePoint(from) || !validRoutePoint(to)) return null
  const [start, startDistance] = graph.findClosestNode(from.latitude!, from.longitude!)
  const [end, endDistance] = graph.findClosestNode(to.latitude!, to.longitude!)
  if (!start || !end || !validRoutePoint(start as IAddressPoint) || !validRoutePoint(end as IAddressPoint)) return null
  // Validate actual node positions as well as the graph's reported distances.
  const startSnap = calculateDistance([from.latitude!, from.longitude!], [start.latitude, start.longitude])
  const endSnap = calculateDistance([to.latitude!, to.longitude!], [end.latitude, end.longitude])
  if ([startDistance, endDistance, startSnap, endSnap].some(distance =>
    !Number.isFinite(distance) || distance < 0 || distance > MAX_LOCAL_ROUTE_SNAP_METERS)) return null
  const [path, distance] = graph.findShortestPath(start.id, end.id)
  if (path.length < 2 || !Number.isFinite(distance) || distance < 0 ||
    path[0].id !== start.id || path[path.length - 1].id !== end.id) return null
  const distanceMeters = distance + startSnap + endSnap
  const directDistance = calculateDistance([from.latitude!, from.longitude!], [to.latitude!, to.longitude!])
  if (distanceMeters + 1 < directDistance) return null
  const minutes = Math.max(1, Math.round(distanceMeters / 1000 / 35 * 60))
  const result: IRouteInfo = {
    distance: Number((distanceMeters / 1000).toFixed(2)),
    time: { hours: Math.floor(minutes / 60), minutes: minutes % 60 },
    points: [[from.latitude!, from.longitude!], ...path.map(node => [node.latitude, node.longitude] as [number, number]), [to.latitude!, to.longitude!]],
  }
  return isUsableRouteInfo(result) ? result : null
}
