import { useEffect, useMemo, useState } from 'react'
import { isFreshDevicePosition, LOCATION_MAX_AGE_MS } from './locationFreshness'

/** One acquired fix feeds the publisher and the map; no independent GPS sampler. */
export function useDevicePosition(position?: GeolocationPosition): [number, number] | null {
  const [clock, setClock] = useState(0)
  useEffect(() => {
    if (!isFreshDevicePosition(position)) return
    const timer = setTimeout(() => setClock(value => value + 1),
      Math.max(0, position.timestamp + LOCATION_MAX_AGE_MS - Date.now() + 1))
    return () => clearTimeout(timer)
  }, [position])
  return useMemo(() => isFreshDevicePosition(position) ?
    [position.coords.latitude, position.coords.longitude] : null, [position, clock])
}
