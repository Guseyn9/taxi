import {getDriverFreeSeats,canDriverTakeOrderBySeats} from './driverCapacity'
import {EBookingDriverState,ICar,IOrder} from '../types/types'
import {driverOrderMode,signedProfit} from '../design/driverOrderPresentation'
const driver='driver-local-test'
const car={seats:4} as ICar
const order=(id:string,seats:number,state=EBookingDriverState.Started)=>({b_id:id,b_passengers_count:seats,b_cars_count:1,drivers:[{u_id:driver,c_state:state}]} as IOrder)
it('keeps three independent customers separate while reserving the same three seats as one family',()=>{
 const separate=[order('a',1),order('b',1),order('c',1)]
 const family=[order('family',3)]
 expect(getDriverFreeSeats(car,separate,driver)).toBe(1)
 expect(getDriverFreeSeats(car,family,driver)).toBe(1)
 expect(new Set(separate.map(o=>o.b_id)).size).toBe(3)
 const afterOneFinished=separate.map(o=>o.b_id==='b'?order('b',1,EBookingDriverState.Finished):o)
 expect(getDriverFreeSeats(car,afterOneFinished,driver)).toBe(2)
 expect(afterOneFinished.filter(o=>o.drivers?.[0].c_state===EBookingDriverState.Started).map(o=>o.b_id)).toEqual(['a','c'])
})
it('retains existing trips when the car is full but rejects new customers that do not fit',()=>{
 const trips=[order('a',2),order('b',2)]
 const free=getDriverFreeSeats(car,trips,driver)
 expect(free).toBe(0)
 expect(trips.every(o=>canDriverTakeOrderBySeats(o,free,driver))).toBe(true)
 expect(canDriverTakeOrderBySeats({...order('new',1),drivers:[]},free,driver)).toBe(false)
})
it('does not collapse different request types or turn missing profit into zero',()=>{
 expect(driverOrderMode({...order('a',1),b_voting:true})).toBe('voting')
 expect(driverOrderMode({...order('b',1),b_cars_count:1,b_options:{offer_mode:'OFFER'}})).toBe('offer')
 expect(driverOrderMode(order('c',1))).toBe('order')
 expect(signedProfit(undefined,'MAD','en')).toBe('—')
 expect(signedProfit(-3,'MAD','en')).toContain('3')
 expect(signedProfit(0,'MAD','en')).not.toBe('—')
})
