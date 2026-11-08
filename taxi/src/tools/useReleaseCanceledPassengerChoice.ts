import {useEffect, useRef} from 'react'
import {EBookingDriverState, EBookingStates, IOrder, IUser} from '../types/types'
import {clearPassengerConfirmedChoice} from './driverOffer'
import {passengerGateway} from '../platform/adapters/LegacyPassengerGateway'

/** Only an explicit cancellation in a returned-to-search order releases a choice.
 * A missing driver list in an incomplete read is not a cancellation. */
export function isCanceledPassengerChoice(order: IOrder | null | undefined, driverId: IUser['u_id'] | null) {
  return Boolean(driverId && Number(order?.b_state) === EBookingStates.Processing &&
    order?.drivers?.some(driver => String(driver.u_id) === String(driverId) &&
      Number(driver.c_state) === EBookingDriverState.Canceled))
}

export function useReleaseCanceledPassengerChoice(order: IOrder | null | undefined, driverId: IUser['u_id'] | null, release: (value: null) => void) {
  const canceled = isCanceledPassengerChoice(order, driverId)
  const orderId = order?.b_id
  const missing = Boolean(driverId && Number(order?.b_state) === EBookingStates.Processing &&
    Array.isArray(order?.drivers) && !order?.drivers?.some(driver => String(driver.u_id) === String(driverId)))
  const pending = useRef<{key: string; promise: Promise<IOrder | null>} | null>(null)
  useEffect(() => {
    let active = true
    const confirmedCancellation = () => {
      if (!active || !orderId) return
      clearPassengerConfirmedChoice(orderId, driverId)
      release(null)
    }
    if (canceled && orderId) {
      confirmedCancellation()
    } else if (missing && orderId) {
      // The active list omits canceled drivers. Query the complete booking:
      // absence alone must not undo a successful choice during a delayed poll.
      const key = `${orderId}:${driverId}`
      const promise = pending.current?.key === key ? pending.current.promise : passengerGateway.getOrder(orderId)
      if (pending.current?.key !== key) {
        pending.current = {key, promise}
        void promise.finally(() => {
          if (pending.current?.promise === promise) pending.current = null
        }).catch(() => {})
      }
      void promise.then(snapshot => {
        if (isCanceledPassengerChoice(snapshot, driverId)) confirmedCancellation()
      }).catch(() => { /* A failed read is not proof of cancellation. */ })
    }
    return () => { active = false }
  }, [canceled, missing, orderId, driverId, release, order])
  // Do not wait for a window event or a second render to show other candidates.
  return canceled ? null : driverId
}
