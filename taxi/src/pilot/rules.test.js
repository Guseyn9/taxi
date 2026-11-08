import { serverPickupEta,validOfferPrice,orderMatchesCar } from './rules'

test('canonical server ETA wins over old offer metadata; arrays and serialized options work',()=>{
 expect(serverPickupEta({c_pickup_time:'5 минут',c_options:{driver_offer_eta:'15 минут'}})).toBe('5 минут')
 expect(serverPickupEta({c_data:JSON.stringify({c_pickup_time:['5 min']}),c_options:{driver_offer_eta:'15 min'}})).toBe('5 min')
 expect(serverPickupEta({c_options:JSON.stringify({driver_offer:{eta:'10 min'}})})).toBe('10 min')
 expect(serverPickupEta({})).toBe('')
})
test('zero, empty, negative and nonfinite offers cannot be submitted',()=>{
 for(const value of [0,'0','',null,undefined,-1,NaN,Infinity,'n/a'])expect(validOfferPrice(value)).toBe(false)
 expect(validOfferPrice('150')).toBe(true)
})
test('incompatible ready orders are hidden but missing metadata is not treated as mismatch',()=>{
 expect(orderMatchesCar({b_car_class:'GRAND'},{cc_id:'PETIT'})).toBe(false)
 expect(orderMatchesCar({b_car_class:'PETIT'},{cc_id:'PETIT'})).toBe(true)
 expect(orderMatchesCar({b_car_class:1},{cc_id:'1'})).toBe(true)
 expect(orderMatchesCar({},{})).toBe(true)
})
test('unrestricted class 0 requests stay visible to concrete cars without weakening explicit class matching',()=>{
 expect(orderMatchesCar({b_car_class:0},{cc_id:'1'})).toBe(true)
 expect(orderMatchesCar({b_car_class:'0'},{cc_id:'2'})).toBe(true)
 expect(orderMatchesCar({b_car_class:'1'},{cc_id:0})).toBe(false)
 expect(orderMatchesCar({b_car_class:'GRAND'},{cc_id:'PETIT'})).toBe(false)
})
