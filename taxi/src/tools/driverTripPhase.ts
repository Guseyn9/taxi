/**
 * Shared "what is the driver doing right now" channel.
 *
 * The driver map already publishes WHERE the driver is (see driverPosition.ts).
 * The client emulator additionally needs to know WHEN in the trip he is and
 * WHERE he is heading, so a generated same-way ("попутный") order can appear at
 * a chosen moment and — more importantly — actually lie on his way. Without the
 * target the emulator could only scatter the pickup around the driver, and half
 * of the generated companions would sit behind him.
 *
 * Deliberately tiny: one snapshot, published by the map, read by whoever wants
 * to time something against the trip. A `null` phase means the driver is not
 * driving anywhere right now (no trip, or parked waiting for «Поехал») — the
 * moment when a same-way order makes no sense at all.
 */

import { useEffect, useState } from 'react'

export type TDriverTripPhase =
  /** Едет за пассажиром: ближайшая точка поездки — посадка. */
  | 'to-pickup'
  /** Везёт пассажира: ближайшая точка поездки — высадка. */
  | 'to-dropoff'

export interface IDriverTripSnapshot {
  phase: TDriverTripPhase | null
  /** Точка, к которой водитель сейчас едет (ближайшая точка плана). */
  target: [number, number] | null
}

const DRIVER_TRIP_EVENT = 'driverTripChanged'

const EMPTY_TRIP: IDriverTripSnapshot = { phase: null, target: null }

let currentTrip: IDriverTripSnapshot = EMPTY_TRIP

function isSameTrip(a: IDriverTripSnapshot, b: IDriverTripSnapshot) {
  return a.phase === b.phase &&
    a.target?.[0] === b.target?.[0] &&
    a.target?.[1] === b.target?.[1]
}

export function publishDriverTrip(trip: IDriverTripSnapshot) {
  const next = trip.phase ? trip : EMPTY_TRIP
  if (isSameTrip(currentTrip, next))
    return

  currentTrip = next
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(DRIVER_TRIP_EVENT, { detail: next }))
}

export function getDriverTrip(): IDriverTripSnapshot {
  return currentTrip
}

export function getDriverTripPhase(): TDriverTripPhase | null {
  return currentTrip.phase
}

export function subscribeDriverTrip(listener: (trip: IDriverTripSnapshot) => void) {
  if (typeof window === 'undefined')
    return () => {}

  const handler = (event: Event) =>
    listener((event as CustomEvent<IDriverTripSnapshot>).detail ?? EMPTY_TRIP)

  window.addEventListener(DRIVER_TRIP_EVENT, handler)
  return () => window.removeEventListener(DRIVER_TRIP_EVENT, handler)
}

export function useDriverTrip() {
  const [trip, setTrip] = useState(getDriverTrip)
  useEffect(() => subscribeDriverTrip(setTrip), [])
  return trip
}

/** Человекочитаемое название фазы — для логов эмулятора. */
export function getDriverTripPhaseLabel(phase: TDriverTripPhase | null): string {
  if (phase === 'to-pickup')
    return 'до посадки'
  if (phase === 'to-dropoff')
    return 'после посадки'

  return 'вне поездки'
}
