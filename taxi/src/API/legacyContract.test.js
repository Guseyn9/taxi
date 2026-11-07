import {offerBookingOptions,bookingOptionAssignment,performerOptions} from './legacyContract'
test('Offer keeps one-car semantics and an explicit persistent mode',()=>{
 expect(offerBookingOptions(150)).toEqual({customer_price:150,offer_mode:'OFFER'})
 for(const price of [0,-1,'',NaN,Infinity])expect(()=>offerBookingOptions(price)).toThrow()
})
test('option edits use the backend operator contract and preserve zero',()=>{
 expect(bookingOptionAssignment('customer_price',0)).toEqual([['=',['customer_price'],0]])
})
test('the same driver ETA and comment travel inside persisted c_options',()=>{
 expect(performerOptions(180,'5 минут','  Приеду к входу  ')).toEqual({performers_price:180,driver_offer_eta:'5 минут',driver_offer_comment:'Приеду к входу'})
 expect(performerOptions(0)).toEqual({performers_price:0})
})
