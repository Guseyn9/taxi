import {notifyNativeStartup} from './nativeStartup'
test('one native START per bridge despite rerenders and StrictMode replay',()=>{
 const bridge={postMessage:jest.fn()}
 notifyNativeStartup();notifyNativeStartup(bridge);notifyNativeStartup(bridge);notifyNativeStartup(bridge)
 expect(bridge.postMessage).toHaveBeenCalledTimes(1)
 expect(JSON.parse(bridge.postMessage.mock.calls[0][0])).toEqual({type:'SYSTEM',message:'START'})
 const replacement={postMessage:jest.fn()};notifyNativeStartup(replacement)
 expect(replacement.postMessage).toHaveBeenCalledTimes(1)
})
