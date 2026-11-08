import { backendGateway } from '../platform/adapters/LegacyBackendGateway'
import { makeOsrmRoutePoints, makeLocalRoutePoints, isUsableRouteInfo } from './roadRoute'
import { IAddressPoint, IRouteInfo } from '../types/types'
import { IWayGraph } from './maps'

/**
 * Shared road-route geometry helpers.
 *
 * Extracted from pages/Driver/Map.tsx so the geometry mechanism (API →
 * local wayGraph → OSRM) can be reused outside React — notably by the
 * driver route emulator, which receives it as an injected `routeProvider`
 * and stays fully independent of the concrete routing backend.
 */

/**
 * Build a by-roads route between two points with graceful fallbacks:
 * backend API → local way graph → public OSRM. Throws only when every
 * source fails to produce a usable polyline.
 */
export async function makeRoutePointsSafe(
  from: IAddressPoint,
  to: IAddressPoint,
  wayGraph?: IWayGraph,
): Promise<IRouteInfo> {
  try {
    const apiRoute = await backendGateway.makeRoutePoints(from, to)
    if (isUsableRouteInfo(apiRoute))
      return apiRoute
  } catch (error) {
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

export { makeOsrmRoutePoints, makeLocalRoutePoints, isUsableRouteInfo } from './roadRoute'
