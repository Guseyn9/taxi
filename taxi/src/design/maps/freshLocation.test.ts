import {requestFreshLocation,requestInitialLocation,locationFailure} from './freshLocation'
it('every explicit action requests a new fix with bounded waiting and no cache',()=>{
 const geo={getCurrentPosition:jest.fn()},success=jest.fn(),failure=jest.fn()
 requestFreshLocation(geo,success,failure);requestFreshLocation(geo,success,failure)
 expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2)
 expect(geo.getCurrentPosition).toHaveBeenLastCalledWith(success,failure,{enableHighAccuracy:true,timeout:10000,maximumAge:0})
})
it.each(['granted','prompt'])('starts one initial browser request for %s permission',async (state:string)=>{
 const locate=jest.fn(),denied=jest.fn(),permissions={query:jest.fn().mockResolvedValue({state})}
 requestInitialLocation(permissions,locate,denied);await Promise.resolve()
 expect(permissions.query).toHaveBeenCalledWith({name:'geolocation'});expect(locate).toHaveBeenCalledTimes(1);expect(denied).not.toHaveBeenCalled()
})
it('does not request the sensor again when the browser remembers a denial',async()=>{
 const locate=jest.fn(),denied=jest.fn()
 requestInitialLocation({query:jest.fn().mockResolvedValue({state:'denied'})},locate,denied);await Promise.resolve()
 expect(locate).not.toHaveBeenCalled();expect(denied).toHaveBeenCalledTimes(1)
})
it('can start in browsers without Permissions API',()=>{
 const locate=jest.fn();requestInitialLocation(undefined,locate,jest.fn());expect(locate).toHaveBeenCalledTimes(1)
})
it('can start when permission preflight rejects',async()=>{
 const locate=jest.fn();requestInitialLocation({query:jest.fn().mockRejectedValue(new Error('unsupported'))},locate,jest.fn());await Promise.resolve();await Promise.resolve();expect(locate).toHaveBeenCalledTimes(1)
})
it('can start when a WebView throws during permission preflight',()=>{
 const locate=jest.fn();requestInitialLocation({query:jest.fn(()=>{throw new Error('unsupported')})},locate,jest.fn());expect(locate).toHaveBeenCalledTimes(1)
})
it('does not start a delayed request after its map has been detached',async()=>{
 let resolve!:(status:PermissionStatus)=>void;const locate=jest.fn(),denied=jest.fn()
 const query=jest.fn(()=>new Promise<PermissionStatus>(r=>{resolve=r}))
 const cancel=requestInitialLocation({query},locate,denied);cancel();resolve({state:'prompt'} as PermissionStatus);await Promise.resolve()
 expect(locate).not.toHaveBeenCalled();expect(denied).not.toHaveBeenCalled()
})
it('denied, unavailable and timeout give localized recovery directions',()=>{
 for(const code of [1,2,3])expect(locationFailure(code,'ru')).toMatch(/карте/)
 expect(locationFailure(1,'ru')).toMatch(/запрещён/)
 expect(locationFailure(3,'ru')).toMatch(/вовремя/)
})
it('explains a successful GPS fix outside the service region without pretending it is a denial',()=>{
 expect(locationFailure(4,'ru')).toMatch(/Марокко/);expect(locationFailure(4,'ru')).not.toMatch(/запрещён/)
})
