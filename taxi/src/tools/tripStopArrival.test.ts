import {isAtBookedStop} from './tripStopArrival'
import {ETripStopKind,ITripStop} from './driverTripPlan'
it('finishes at the requested destination even when routing snapped to a remote road',()=>{
 const stop={kind:ETripStopKind.Dropoff,lat:30.43,lng:-9.55,order:{b_destination_latitude:30.430914,b_destination_longitude:-9.540939}} as ITripStop
 expect(isAtBookedStop([30.430914,-9.540939],stop)).toBe(true)
 expect(isAtBookedStop([30.43,-9.55],stop)).toBe(false)
 expect(isAtBookedStop(null,stop)).toBe(false)
})
it('uses the same canonical pickup gate as the order card and rejects invalid coordinates',()=>{
 const stop={kind:ETripStopKind.Pickup,lat:30.45,lng:-9.56,order:{b_start_latitude:30.4206,b_start_longitude:-9.598}} as ITripStop
 expect(isAtBookedStop([30.4206,-9.598],stop)).toBe(true)
 expect(isAtBookedStop([30.45,-9.56],stop)).toBe(false)
 expect(isAtBookedStop([30.4206,-9.598],{...stop,order:{}} as ITripStop)).toBe(false)
})
