import { useMemo } from 'react'
import { platformInterface } from '../../compositionRoot'
import { usePlatformRuntime } from '../../usePlatformRuntime'
import { useRegisteredSurface } from '../useRegisteredSurface'
import type { PassengerUiFacts } from './PassengerPresentation'
import { PASSENGER_SIMPLE_SURFACE_ID } from './PassengerSurface'

export function usePassengerSurface(facts: PassengerUiFacts) {
  const runtimeState = usePlatformRuntime()
  useRegisteredSurface(PASSENGER_SIMPLE_SURFACE_ID)

  return useMemo(
    () => platformInterface.passengerSurface.resolve(facts),
    [
      facts.selectedOrder,
      facts.submittedOrderId,
      facts.isCreatingAnotherOrder,
      facts.selectedDriver,
      runtimeState.snapshot,
    ],
  )
}
