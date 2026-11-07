import type { IWayGraph } from '../../tools/maps'
import type { IAddressPoint, IRouteInfo } from '../../types/types'
import { backendGateway } from './LegacyBackendGateway'
import { isUsableRouteInfo, makeLocalRoutePoints, makeOsrmRoutePoints } from '../../tools/roadRoute'

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

export const legacyRouteProvider = new LegacyRouteProvider()
