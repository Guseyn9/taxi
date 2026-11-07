import {addToFormData} from '../tools/api'
jest.mock('../state/user',()=>({userSelectors:{}}))
jest.mock('../state',()=>({__esModule:true,default:{getState:jest.fn()}}))
test('preserves meaningful zero and false while keeping null/undefined/empty omission',()=>{
 const data=addToFormData(new FormData(),{price:0,enabled:false,count:1,missing:null,unset:undefined,empty:''})
 expect(data.get('price')).toBe('0');expect(data.get('enabled')).toBe('false');expect(data.get('count')).toBe('1')
 expect(data.has('missing')).toBe(false);expect(data.has('unset')).toBe(false);expect(data.has('empty')).toBe(false)
})
