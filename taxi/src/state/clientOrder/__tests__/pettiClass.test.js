import SITE_CONSTANTS from '../../../siteConstants'
import {carClassAllowedForRoute} from '../util'
const before=window.data
beforeEach(()=>{
 window.data={car_classes:{51:{name:'GRAND',seats:6,booking_location_classes:['city','intercity']},55:{name:'PETTI',seats:4,booking_location_classes:['city','intercity']}},booking_location_classes:{city:{alias:'city',upper:0},intercity:{alias:'countries_list',upper:1}}}
 SITE_CONSTANTS.recalculate()
})
afterEach(()=>{window.data=before;SITE_CONSTANTS.recalculate()})
it('prefers the configured PETTI city class even when Grand appears first and Petit is not ID 1',()=>{
 expect(SITE_CONSTANTS.DEFAULT_CAR_CLASS).toBe('55')
})
it('PETTI obeys the same route restriction as Petit, while Grand remains available',()=>{
 const from={latitude:30.42,longitude:-9.6},near={latitude:30.43,longitude:-9.61},far={latitude:31.6,longitude:-8}
 expect(carClassAllowedForRoute(SITE_CONSTANTS.CAR_CLASSES[55],['a'],['a'],from,near)).toBe(true)
 expect(carClassAllowedForRoute(SITE_CONSTANTS.CAR_CLASSES[55],['a'],['b'],from,far)).toBe(false)
 expect(carClassAllowedForRoute(SITE_CONSTANTS.CAR_CLASSES[51],['a'],['b'],from,far)).toBe(true)
})
