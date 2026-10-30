jest.mock('../../state/user',()=>({userSelectors:{}}))
jest.mock('../../state',()=>({__esModule:true,default:{getState:jest.fn()}}))
import {apiMethod} from '../../tools/api'
test('offline actions fail before a network command and are never queued for replay',async()=>{
 const original=Object.getOwnPropertyDescriptor(navigator,'onLine'),request=jest.fn(),method=apiMethod(request,{authRequired:false})
 try{Object.defineProperty(navigator,'onLine',{value:false,configurable:true});await expect(method('create')).rejects.toThrow('Network unavailable');expect(request).not.toHaveBeenCalled()}
 finally{if(original)Object.defineProperty(navigator,'onLine',original);else delete navigator.onLine}
})
