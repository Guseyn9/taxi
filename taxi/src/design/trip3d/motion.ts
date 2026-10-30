export const ROUTE: [number, number][] = [[-16, 8], [-8, 8], [-8, -5], [6, -5], [6, 6], [16, 6]]
export const PICKUP_DISTANCE = 8
export const TOTAL_DISTANCE = 56
export const DURATION = 32
export function sampleRoute(distance: number) {
  let remaining = Math.max(0, Math.min(TOTAL_DISTANCE, distance))
  for (let i = 1; i < ROUTE.length; i++) {
    const [x, z] = ROUTE[i - 1], [nx, nz] = ROUTE[i]
    const length = Math.hypot(nx - x, nz - z)
    if (remaining <= length || i === ROUTE.length - 1) {
      const f = Math.min(1, remaining / length)
      return { x: x + (nx - x) * f, z: z + (nz - z) * f, angle: Math.atan2(nx - x, nz - z) }
    }
    remaining -= length
  }
  return { x: -16, z: 8, angle: Math.PI / 2 }
}
export function tripFrame(seconds: number) {
  const time = Math.max(0, Math.min(DURATION, seconds))
  const distance = time < 6 ? time / 6 * PICKUP_DISTANCE : time < 9 ? PICKUP_DISTANCE : PICKUP_DISTANCE + (time - 9) / 23 * (TOTAL_DISTANCE - PICKUP_DISTANCE)
  const phase = time < 6 ? 0 : time < 9 ? 1 : time < DURATION ? 2 : 3
  return { ...sampleRoute(distance), distance, phase, boarded: time >= 9 && time < DURATION }
}
