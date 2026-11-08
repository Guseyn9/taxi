import {bookingCreationNeedsReview,markBookingCreationReview} from './bookingCreationReview'
jest.mock('../config',()=>({__esModule:true,default:{API_URL:'https://tenant.example.test/api/v1'}}))
afterEach(()=>{markBookingCreationReview('one',false);markBookingCreationReview('two',false);jest.restoreAllMocks();sessionStorage.clear()})
test('an uncertain create survives a screen reload and is scoped to its owner',()=>{
 markBookingCreationReview('one',true)
 expect(bookingCreationNeedsReview('one')).toBe(true);expect(bookingCreationNeedsReview('two')).toBe(false)
 jest.isolateModules(()=>{const fresh=require('./bookingCreationReview');expect(fresh.bookingCreationNeedsReview('one')).toBe(true)})
 expect([...Object.values(sessionStorage)]).toEqual(['1'])
 markBookingCreationReview('one',false);expect(bookingCreationNeedsReview('one')).toBe(false)
})
test('storage refusal still keeps the in-page review guard',()=>{
 jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked')})
 markBookingCreationReview('two',true);expect(bookingCreationNeedsReview('two')).toBe(true)
})
