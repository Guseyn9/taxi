import {formatEstimatedFare} from './fareDisplay'
test('displayed estimates keep the fractional fare supplied by the service',()=>{
 expect(formatEstimatedFare(12.5,'en')).toBe('12.5')
 expect(formatEstimatedFare('12.50','fr')).toBe('12,5')
 expect(formatEstimatedFare(0)).toBe('0')
})
test('missing or invalid estimates are never displayed as a made-up amount',()=>{
 for(const value of [undefined,null,'',Infinity,-1,'wrong'])expect(formatEstimatedFare(value)).toBe('—')
})
