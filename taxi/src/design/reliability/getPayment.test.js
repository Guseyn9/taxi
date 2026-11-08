import {getPayment} from '../../tools/utils'
import {quotedFare} from './rideData'
jest.mock('../../siteConstants',()=>({__esModule:true,default:{ENABLE_CUSTOMER_PRICE:false,START_OF_NIGHT_TIME:'22:00',END_OF_NIGHT_TIME:'06:00',CAR_CLASSES:{petit:{courier_call_rate:10,courier_fare_per_1_km:2.5}},COURIER_CALL_RATE:10,COURIER_FARE_PER_1_KM:2.5},CURRENCY:{NAME:'GHS',SIGN:'GH₵'}}))
jest.mock('../../localization',()=>({t:v=>v,TRANSLATION:{KM:'km'}}))
jest.mock('../../tools/driverOffer',()=>({getPassengerConfirmedChoice:()=>null}))
test('actual shared fare function shows 22.5 from the order and keeps the original draft calculation',()=>{
 expect(getPayment({b_id:1,b_price_estimate:22.5,b_options:{pricingModel:{price:0}}}).value).toBe(22.5)
 expect(getPayment(null,null,1,undefined,'petit').value).toBe(12.5)
 const order={drivers:[{u_id:10,c_state:1,c_options:{performers_price:50}},{u_id:20,c_state:1,c_options:{performers_price:80}}],b_price_estimate:22.5}
 expect(quotedFare(order).value).toBe(22.5);expect(quotedFare(order,20).value).toBe(80)
})
