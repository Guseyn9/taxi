import {subscribeOrderWake} from './orderWake'
test('restores reads once when focus, reconnect and visibility arrive together; stops on cleanup',()=>{
 jest.useFakeTimers()
 const old=Object.getOwnPropertyDescriptor(document,'hidden')
 Object.defineProperty(document,'hidden',{configurable:true,value:false})
 const refresh=jest.fn(),stop=subscribeOrderWake(refresh)
 window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'))
 jest.advanceTimersByTime(100);expect(refresh).toHaveBeenCalledTimes(1)
 Object.defineProperty(document,'hidden',{configurable:true,value:true})
 window.dispatchEvent(new Event('online'));jest.runOnlyPendingTimers();expect(refresh).toHaveBeenCalledTimes(1)
 Object.defineProperty(document,'hidden',{configurable:true,value:false})
 document.dispatchEvent(new Event('visibilitychange'));jest.advanceTimersByTime(100);expect(refresh).toHaveBeenCalledTimes(2)
 stop();window.dispatchEvent(new Event('focus'));jest.runOnlyPendingTimers();expect(refresh).toHaveBeenCalledTimes(2)
 if(old)Object.defineProperty(document,'hidden',old);else delete document.hidden
 jest.useRealTimers()
})
