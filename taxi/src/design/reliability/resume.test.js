import {subscribeResume,readHealthMiddleware,readHealth} from './readHealth'
beforeEach(()=>jest.useFakeTimers());afterEach(()=>jest.useRealTimers())
test('foreground/online signals coalesce, hidden pages do not refresh and disposal removes events',()=>{
 let now=0;const refresh=jest.fn(),win=new EventTarget(),doc=new EventTarget();win.navigator={onLine:true};doc.visibilityState='visible'
 const stop=subscribeResume(refresh,win,doc,()=>now)
 for(const name of ['focus','pageshow','online'])win.dispatchEvent(new Event(name));jest.advanceTimersByTime(150);expect(refresh).toHaveBeenCalledTimes(1)
 doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));jest.advanceTimersByTime(1200);expect(refresh).toHaveBeenCalledTimes(1)
 now+=1200;doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));jest.advanceTimersByTime(150);expect(refresh).toHaveBeenCalledTimes(2)
 win.navigator.onLine=false;win.dispatchEvent(new Event('focus'));jest.advanceTimersByTime(1200);expect(refresh).toHaveBeenCalledTimes(2)
 stop();win.navigator.onLine=true;win.dispatchEvent(new Event('online'));jest.advanceTimersByTime(1200);expect(refresh).toHaveBeenCalledTimes(2)
})
test('read failure keeps previous timestamp, only a successful read clears stale state',()=>{
 const dispatch=readHealthMiddleware({})(action=>action)
 dispatch({type:'test/GET_ACTIVE_ORDERS_SUCCESS'});const time=readHealth().updatedAt
 dispatch({type:'test/GET_ACTIVE_ORDERS_FAIL'});expect(readHealth()).toMatchObject({failed:true,updatedAt:time})
 dispatch({type:'test/GET_ACTIVE_ORDERS_REQUEST'});expect(readHealth()).toMatchObject({failed:true,pending:true})
 dispatch({type:'test/GET_ACTIVE_ORDERS_SUCCESS'});expect(readHealth().failed).toBe(false)
})
