import { useEffect, useMemo, useRef, useState } from 'react'
import { ITripStop } from './driverTripPlan'
import { IReachablePoint, snapToRoad, REACHABLE_ROAD_METERS } from './mapReachability'
import { writeRawLog } from './rawLog'

export interface ISnappedOrderPoints {
  start: [number, number] | null
  destination: [number, number] | null
}

interface ISnapTask {
  id: string
  start: IReachablePoint | null
  destination: IReachablePoint | null
}

interface ISnapTaskResult {
  points: ISnappedOrderPoints
  retryable: boolean
}

function samePair(a: [number, number] | null, b: [number, number] | null): boolean {
  return a === b || Boolean(a && b && a[0] === b[0] && a[1] === b[1])
}

function readPoint(latitude: unknown, longitude: unknown): IReachablePoint | null {
  const present = (value: unknown) => typeof value === 'number' ||
    (typeof value === 'string' && value.trim() !== '')
  if (!present(latitude) || !present(longitude)) return null
  const lat = Number(latitude), lng = Number(longitude)
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180 ?
    { latitude: lat, longitude: lng } :
    null
}

// Only booked coordinates participate, never the moving driver's position or metadata.
function tasksSignature(stops: readonly ITripStop[]): string {
  const tasks = new Map<string, ISnapTask>()
  stops.forEach(({ order, orderId }) => tasks.set(String(orderId), {
    id: String(orderId),
    start: readPoint(order.b_start_latitude, order.b_start_longitude),
    destination: readPoint(order.b_destination_latitude, order.b_destination_longitude),
  }))
  return JSON.stringify(Array.from(tasks.values()).sort((a, b) => a.id.localeCompare(b.id)))
}

async function snapOrderPoints(task: ISnapTask): Promise<ISnapTaskResult> {
  // One unavailable point must not discard the other point or another order.
  const nearest = (point: IReachablePoint | null) => point ?
    Promise.resolve().then(() => snapToRoad(point)).catch(() => null) :
    Promise.resolve(null)
  const [startSnap, destinationSnap] = await Promise.all([
    nearest(task.start), nearest(task.destination),
  ])
  const start = startSnap && startSnap.roadDistanceMeters > REACHABLE_ROAD_METERS ?
    [startSnap.latitude, startSnap.longitude] as [number, number] :
    null
  const destination = destinationSnap && destinationSnap.roadDistanceMeters > REACHABLE_ROAD_METERS ?
    [destinationSnap.latitude, destinationSnap.longitude] as [number, number] :
    null
  if (start || destination) {
    writeRawLog('DRIVER_DEMO_ORDER_OFFROAD', {
      source: 'driver-map', screen: 'Driver/Map', orderId: task.id,
      startRoadDistanceMeters: startSnap?.roadDistanceMeters ?? null,
      destinationRoadDistanceMeters: destinationSnap?.roadDistanceMeters ?? null,
      snappedStart: Boolean(start), snappedDestination: Boolean(destination),
    })
  }
  return {
    points: { start, destination },
    retryable: Boolean((task.start && !startSnap) || (task.destination && !destinationSnap)),
  }
}

/** Only emulator coordinates may be adjusted; real bookings keep their exact points. */
export function useDemoOrderPoints(enabled: boolean, stops: readonly ITripStop[], retryNonce = 0) {
  const signature = tasksSignature(stops)
  // Decode our own coordinate snapshot so effect dependencies express the entire input.
  const tasks = useMemo(() => JSON.parse(signature) as ISnapTask[], [signature])
  const requests = useRef(new Map<string, Promise<ISnapTaskResult>>())
  const [results, setResults] = useState<Record<string, { key: string, points: ISnappedOrderPoints }>>({})
  useEffect(() => {
    if (!enabled) {
      requests.current.clear()
      setResults(previous => Object.keys(previous).length ? {} : previous)
      return
    }
    const keys = new Set(tasks.map(task => JSON.stringify(task)))
    // Bound retained work to the current plan; finished orders must not accumulate.
    requests.current.forEach((_, key) => { if (!keys.has(key)) requests.current.delete(key) })
    setResults(previous => {
      const entries = Object.entries(previous).filter(([, value]) => keys.has(value.key))
      return entries.length === Object.keys(previous).length ? previous : Object.fromEntries(entries)
    })
    let current = true
    tasks.forEach(task => {
      const key = JSON.stringify(task)
      let request = requests.current.get(key)
      if (!request) {
        request = snapOrderPoints(task)
        requests.current.set(key, request)
      }
      // A new plan subscribes to existing in-flight work rather than marking it done.
      request.then(({ points, retryable }) => {
        // A provider miss is not a completed road calculation. Let a later plan
        // update or the existing stalled-route recovery try it again. The road
        // adapter's negative TTL still bounds HTTP traffic during an outage.
        if (retryable && requests.current.get(key) === request) requests.current.delete(key)
        if (!current) return
        setResults(previous => previous[task.id]?.key === key &&
          samePair(previous[task.id].points.start, points.start) &&
          samePair(previous[task.id].points.destination, points.destination) ?
          previous :
          {
            ...previous, [task.id]: { key, points },
          })
      })
    })
    return () => { current = false }
  }, [enabled, tasks, retryNonce])
  return useMemo(() => {
    const points: Record<string, ISnappedOrderPoints> = {}
    if (enabled) tasks.forEach(task => {
      const result = results[task.id]
      if (result?.key === JSON.stringify(task) && (result.points.start || result.points.destination))
        points[task.id] = result.points
    })
    return points
  }, [enabled, tasks, results])
}
