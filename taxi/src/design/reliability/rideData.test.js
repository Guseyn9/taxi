import {quotedFare,displayFare,orderCurrency,startedTripDriver,canExpireSearch} from './rideData'
import {tripToRestore,rememberTrip,rememberedTrip} from '../restoreTrip'
test('uses server quotes instead of a different local tariff or placeholder zero',()=>{
 expect(quotedFare({b_price_estimate:22.5,b_options:{customer_price:0,pricingModel:{price:0}}}).value).toBe(22.5)
 expect(quotedFare({b_price_estimate:22.5,drivers:[{c_state:3,c_options:{performers_price:'30'}}]}).value).toBe(30)
 expect(quotedFare({b_price_estimate:22.5,drivers:[{c_state:1,c_options:{performers_price:100}}]}).value).toBe(22.5)
 expect(quotedFare({b_options:{pricingModel:{price:0,calculationType:'complete'}}}).value).toBe(0)
 expect(quotedFare({b_options:{pricingModel:{price:''}}})).toBeUndefined()
 expect(displayFare('','GHS')).toBe('—');expect(displayFare(22.5,orderCurrency({b_currency:'GHS'},'MAD'),'en')).toContain('22.50')
})
test('does not restore completed or cancelled bookings with stale driver state',()=>{
 const dead={b_id:1,b_state:4,drivers:[{c_state:5}]},cancel={...dead,b_id:2,b_state:'3'},pending={b_id:3,b_state:1,drivers:[]}
 expect(tripToRestore([dead,cancel,pending])).toBeNull();expect(tripToRestore([dead,cancel,pending],'3')).toBe(pending)
 rememberTrip('1419',3);expect(rememberedTrip('1419')).toBe('3');expect(rememberedTrip('1420')).toBeNull();rememberTrip('1419',null);expect(rememberedTrip('1419')).toBeNull()
})

test('normalizes a single amount wrapped in an array by the legacy API, without coercing ambiguous values',()=>{
 expect(quotedFare({b_options:{customer_price:[150]}}).value).toBe(150)
 expect(quotedFare({b_options:{customer_price:[]}})).toBeUndefined()
 expect(quotedFare({b_options:{customer_price:[150,180]}})).toBeUndefined()
 expect(displayFare(12.5,'GHS','en',true)).toMatch(/^≈ /)
})
test('restores only a unique started driver and never expires an approved or running booking',()=>{
 const started={u_id:'1420',c_state:5},pending={b_state:1,drivers:[{c_state:1}]}
 expect(startedTripDriver({...pending,drivers:[started]})).toBe(started)
 expect(startedTripDriver({...pending,drivers:[started,{...started,u_id:'other'}]})).toBeUndefined()
 expect(startedTripDriver({b_state:4,drivers:[started]})).toBeUndefined()
 expect(startedTripDriver({b_state:2,drivers:[{c_state:3}]})).toBeUndefined()
 expect(canExpireSearch(pending)).toBe(true)
 expect(canExpireSearch({b_state:2,drivers:[]})).toBe(false)
 expect(canExpireSearch({...pending,drivers:[started]})).toBe(false)
})
