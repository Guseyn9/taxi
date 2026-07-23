/**
 * Shared "where is the driver right now" channel.
 *
 * The driver map resolves the marker position from several sources (route
 * emulator > backend coords > browser GPS), but that resolution lived only
 * inside pages/Driver/Map.tsx. The order-details surfaces (CardModal, the Order
 * page) needed the same answer to tell whether the driver reached the pickup,
 * and were falling back to the Redux `geoposition` — raw device GPS, which never
 * moves during an emulator run. So the map marker could sit on the pickup point
 * while the card still believed the driver was far away.
 *
 * The map publishes its resolved position here and the cards read it, mirroring
 * the window-event bus the rest of the emulator UI already uses.
 */

import { useEffect, useState } from 'react'

import { distanceBetweenEarthCoordinates } from './utils'

export type TDriverPosition = [number, number]

/** A driver counts as "at the pickup" within this radius. */
export const PICKUP_ARRIVAL_RADIUS_METERS = 100

/** Same threshold for the dropoff — it flips the trip button to "Завершить поездку". */
export const DESTINATION_ARRIVAL_RADIUS_METERS = 100

const DRIVER_POSITION_EVENT = 'driverPositionChanged'

let currentDriverPosition: TDriverPosition | null = null

export function publishDriverPosition(position: TDriverPosition | null) {
  const unchanged = Boolean(
    currentDriverPosition && position &&
    currentDriverPosition[0] === position[0] &&
    currentDriverPosition[1] === position[1],
  )
  if (unchanged || (!currentDriverPosition && !position))
    return

  currentDriverPosition = position
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(DRIVER_POSITION_EVENT, { detail: position }))
}

export function getDriverPosition() {
  return currentDriverPosition
}

export function subscribeDriverPosition(listener: (position: TDriverPosition | null) => void) {
  if (typeof window === 'undefined')
    return () => {}

  const handler = (event: Event) =>
    listener((event as CustomEvent<TDriverPosition | null>).detail ?? null)

  window.addEventListener(DRIVER_POSITION_EVENT, handler)
  return () => window.removeEventListener(DRIVER_POSITION_EVENT, handler)
}

export function useDriverPosition() {
  const [position, setPosition] = useState(getDriverPosition)
  useEffect(() => subscribeDriverPosition(setPosition), [])
  return position
}

function isWithinRadius(
  position: TDriverPosition | null | undefined,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  radiusMeters: number,
) {
  if (!position || !latitude || !longitude)
    return false

  const distanceMeters = distanceBetweenEarthCoordinates(
    position[0],
    position[1],
    latitude,
    longitude,
  ) * 1000

  return distanceMeters <= radiusMeters
}

/**
 * Distance checks against the order's endpoints, shared by the map buttons and
 * the order-details cards so they cannot disagree about where the driver is.
 */
export function isAtPickupPoint(
  position: TDriverPosition | null | undefined,
  pickupLatitude?: number | null,
  pickupLongitude?: number | null,
) {
  return isWithinRadius(position, pickupLatitude, pickupLongitude, PICKUP_ARRIVAL_RADIUS_METERS)
}

export function isAtDestinationPoint(
  position: TDriverPosition | null | undefined,
  destinationLatitude?: number | null,
  destinationLongitude?: number | null,
) {
  return isWithinRadius(
    position,
    destinationLatitude,
    destinationLongitude,
    DESTINATION_ARRIVAL_RADIUS_METERS,
  )
}
