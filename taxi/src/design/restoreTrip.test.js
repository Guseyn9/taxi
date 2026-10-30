import {tripToRestore} from './restoreTrip'
import {EBookingDriverState as State} from '../types/types'
test('an ongoing trip wins over another unanswered request or assigned pickup',()=>{
 const pending={b_id:1,drivers:[]},pickup={b_id:2,drivers:[{c_state:State.Performer}]},started={b_id:3,drivers:[{c_state:State.Started}]}
 const orders=[pending,pickup,started];expect(tripToRestore(orders)).toBe(started);expect(orders[0]).toBe(pending)
 expect(tripToRestore([pending])).toBeNull();expect(tripToRestore(null)).toBeNull()
})
