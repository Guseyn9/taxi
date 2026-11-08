// Extent of the bundled Agadir road data, not the extent of the service tenant.
export const LOCAL_GRAPH_BOUNDS = { south: 30.3498039, north: 30.4909875, west: -9.6742791, east: -9.4905058 }
export function isWithinLocalGraph([latitude, longitude]: readonly number[]): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= LOCAL_GRAPH_BOUNDS.south && latitude <= LOCAL_GRAPH_BOUNDS.north &&
    longitude >= LOCAL_GRAPH_BOUNDS.west && longitude <= LOCAL_GRAPH_BOUNDS.east
}
