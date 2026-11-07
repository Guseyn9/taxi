import {getRequiredCarClassKind} from '../index'
jest.mock('../../../siteConstants',()=>({__esModule:true,default:{CAR_CLASSES:{50:{id:'50'},51:{id:'51',name:'Grand'}}}}))
jest.mock('../../../localization',()=>({TRANSLATION:{CAR_CLASSES:{50:'PETTI'}},t:value=>value}))
jest.mock('../../../tools/driverOffer',()=>({isIntercityOrderLocationClass:value=>value==='intercity'}))
test('city Offer does not imply GRAND; localized PETTI class is respected',()=>{
 expect(getRequiredCarClassKind({b_car_class:50,b_location_class:'city',b_cars_count:0})).toBe('petit')
 expect(getRequiredCarClassKind({b_location_class:'city',b_cars_count:0})).toBe('petit')
 expect(getRequiredCarClassKind({b_location_class:'intercity'})).toBe('grand')
 expect(getRequiredCarClassKind({b_car_class:51,b_location_class:'city'})).toBe('grand')
})
