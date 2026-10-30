// Viewport presets only, not order locations or administrative boundary claims.
export const MOROCCO_CENTER: [number, number] = [31.8, -7.15]
export const MOROCCO_VIEW: [[number, number], [number, number]] = [[27.6, -13.3], [35.95, -1.0]]
export const MOROCCO_ZOOM = 6
// Tile source order is [west, south, east, north], unlike Leaflet's [lat,lng].
// This bounds the display region; booking eligibility remains a server concern.
export const MOROCCO_TILE_BOUNDS: [number, number, number, number] = [-13.3, 27.6, -1, 35.95]
export const MOROCCO_MAX_ZOOM = 19
export function moroccoMinimumZoom(viewportFitZoom: number) {
  return Number.isFinite(viewportFitZoom) ? Math.min(MOROCCO_MAX_ZOOM,Math.max(MOROCCO_ZOOM,Math.ceil(viewportFitZoom))) : MOROCCO_ZOOM
}
export const moroccoCities = [
  { id: 'casablanca', name: 'Casablanca', position: [33.5731, -7.5898] },
  { id: 'rabat', name: 'Rabat', position: [34.0209, -6.8416] },
  { id: 'marrakech', name: 'Marrakech', position: [31.6295, -7.9811] },
  { id: 'tangier', name: 'Tanger', position: [35.7595, -5.834] },
  { id: 'fes', name: 'Fès', position: [34.0331, -5.0003] },
  { id: 'agadir', name: 'Agadir', position: [30.4278, -9.5981] },
] as const
export function isInMoroccoView(point?: [number, number] | null) {
  return Boolean(point && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[0] >= 27.6 && point[0] <= 35.95 && point[1] >= -13.3 && point[1] <= -1)
}
/** Delayed tile loading must not replace a camera moved by GPS or the user. */
export function canApplyInitialOverview(overviewRequested: boolean, cameraChanged: boolean) {
  return overviewRequested && !cameraChanged
}
