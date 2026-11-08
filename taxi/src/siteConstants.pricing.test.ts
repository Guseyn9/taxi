import constants from './siteConstants'
const previous=(window as any).data
afterEach(()=>{(window as any).data=previous;constants.recalculate()})
it('uses the declared per-km default independently of the call-out fee',()=>{
 ;(window as any).data={site_constants:{courier_call_rate:{value:'40'}}} as any
 constants.recalculate();expect(Number(constants.COURIER_CALL_RATE)).toBe(40);expect(Number(constants.COURIER_FARE_PER_1_KM)).toBe(2.5)
 ;(window as any).data={site_constants:{courier_fare_per_1_km:{value:'3.75'}}} as any
 constants.recalculate();expect(Number(constants.COURIER_FARE_PER_1_KM)).toBe(3.75)
})
