import {isOfferOrder,isVotingOrder,setStoredChoiceOrderMode} from './driverOffer'
import {passengerRequestMode} from './passengerRequestMode'
import {IOrder} from '../types/types'
jest.mock('../siteConstants',()=>({__esModule:true,default:{BOOKING_LOCATION_CLASSES:[{id:'city',kind:1},{id:'intercity',kind:2}],CAR_CLASSES:{grand:{booking_location_classes:['intercity']}},BOOKING_COMMENTS:{}}}))
jest.mock('./rawLog',()=>({writeRawLog:jest.fn()}))
const order=(props:Record<string,unknown>)=>({b_id:'mode-regression',...props} as IOrder)
beforeEach(()=>localStorage.clear())
it('never infers Offer from a Grand/intercity quote, even with zero price or zero cars',()=>{
 for(const price of [0,150])for(const count of [0,1]){
  const value=order({b_location_class:'intercity',b_car_class:'grand',b_cars_count:count,b_options:{customer_price:price}})
  expect(isOfferOrder(value)).toBe(false);expect(passengerRequestMode({order:value})).toBe('order')
 }
})
it('does not reinterpret comments, translated text or the Universal invitation flag as public booking modes',()=>{
 for(const props of [{b_custom_comment:'Не голосование'},{b_options:{note:'voting pickup'}},{b_only_offer:true}]){
  expect(isOfferOrder(order(props))).toBe(false);expect(isVotingOrder(order(props))).toBe(false)
 }
})
it('uses the persisted server mode on another browser and overrides stale local selection',()=>{
 setStoredChoiceOrderMode('mode-regression','order')
 const value=order({b_cars_count:1,b_options:{offer_mode:'OFFER',customer_price:22.5}})
 expect(passengerRequestMode({order:value})).toBe('offer')
 localStorage.clear();expect(passengerRequestMode({order:value})).toBe('offer')
 setStoredChoiceOrderMode('mode-regression','offer')
 expect(isOfferOrder(order({order_mode:'ORDER'}))).toBe(false)
})
it('retains the explicit voting service and only uses draft history when the server supplies no mode',()=>{
 expect(isVotingOrder(order({b_voting:false,b_services:[5]}))).toBe(true)
 setStoredChoiceOrderMode('mode-regression','voting')
 expect(isVotingOrder(order({}))).toBe(true)
 expect(isVotingOrder(order({b_voting:false}))).toBe(false)
})
