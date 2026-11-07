import {isAtDestinationPoint,isAtPickupPoint} from './driverPosition'
import {ETripStopKind,ITripStop} from './driverTripPlan'

/** Road routing may snap to a different entrance. Arrival belongs to the booked point. */
export function isAtBookedStop(position:[number,number]|null,stop:ITripStop|null):boolean {
  if (!stop) return false
  const pickup=stop.kind===ETripStopKind.Pickup
  const latitude=Number(pickup?stop.order.b_start_latitude:stop.order.b_destination_latitude)
  const longitude=Number(pickup?stop.order.b_start_longitude:stop.order.b_destination_longitude)
  return pickup?isAtPickupPoint(position,latitude,longitude):isAtDestinationPoint(position,latitude,longitude)
}
