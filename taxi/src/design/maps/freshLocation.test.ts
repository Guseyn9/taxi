import {requestFreshLocation,locationFailure} from './freshLocation'
it('every explicit action requests a new fix with bounded waiting and no cache',()=>{
 const geo={getCurrentPosition:jest.fn()},success=jest.fn(),failure=jest.fn()
 requestFreshLocation(geo,success,failure);requestFreshLocation(geo,success,failure)
 expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2)
 expect(geo.getCurrentPosition).toHaveBeenLastCalledWith(success,failure,{enableHighAccuracy:true,timeout:10000,maximumAge:0})
})
it('denied, unavailable and timeout give localized recovery directions',()=>{
 for(const code of [1,2,3])expect(locationFailure(code,'ru')).toMatch(/карте/)
 expect(locationFailure(1,'ru')).toMatch(/запрещён/)
 expect(locationFailure(3,'ru')).toMatch(/вовремя/)
})
