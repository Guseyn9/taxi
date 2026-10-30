import {calculatedProfit,profitPercentiles} from './profitPresentation'
jest.mock('../siteConstants',()=>({__esModule:true,default:{},CURRENCY:{NAME:'GHS'}}))
it('excludes fare-based fallback from display ranks and preserves zero and negative calculated values',()=>{
 const orders=[{b_id:'unknown',b_price_estimate:99999,b_passengers_count:6},{b_id:'zero',profit:0},{b_id:'loss',profit:-3},{b_id:'gain',profit:10}]
 expect(calculatedProfit(orders[0])).toBeUndefined()
 expect(calculatedProfit({profit:NaN})).toBeUndefined()
 expect(calculatedProfit(orders[1])).toBe(0)
 const buckets=profitPercentiles(orders)
 expect(buckets.unknown).toBeUndefined()
 expect(buckets.loss).toBeLessThan(buckets.zero)
 expect(buckets.zero).toBeLessThan(buckets.gain)
})
