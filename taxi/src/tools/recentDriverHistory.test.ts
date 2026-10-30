import {retainDriverHistory,mergeDriverHistory} from './recentDriverHistory'
import reducer from '../state/orders/reducer'
import {ActionTypes} from '../state/orders/constants'
import {IOrder} from '../types/types'
const booking=(id:string,state:number)=>({b_id:id,b_state:1,drivers:[{u_id:'driver',c_state:state}]} as IOrder)
it('retains only server-confirmed terminal participation, never disappearance or another driver',()=>{
  expect(retainDriverHistory(null,'driver',booking('active',3))).toBeNull()
  expect(retainDriverHistory(null,'other',booking('canceled',2))).toBeNull()
  const recent=retainDriverHistory(null,'driver',booking('canceled',2))
  expect(mergeDriverHistory(null,recent,'driver')?.map(o=>o.b_id)).toEqual(['canceled'])
  expect(mergeDriverHistory(null,recent,'other')).toBeNull()
})
it('keeps both cancellations, deduplicates, limits memory, prefers archive and clears on logout',()=>{
  let state=reducer(undefined,{type:'init'} as any)
  for(let n=0;n<55;n++)state=reducer(state,{type:ActionTypes.RETAIN_DRIVER_HISTORY,payload:{owner:'driver',order:booking(String(n),2)}})
  expect(state.recentDriverHistory?.orders).toHaveLength(50)
  const archived={...booking('54',6),b_state:4} as IOrder
  const merged=mergeDriverHistory([archived],state.recentDriverHistory,'driver')!
  expect(merged).toHaveLength(50)
  expect(merged.find(o=>o.b_id==='54')).toBe(archived)
  expect(merged.some(o=>o.b_id==='53')).toBe(true)
  state=reducer(state,{type:ActionTypes.CLEAR} as any)
  expect(state.recentDriverHistory).toBeNull()
})
it('sorts confirmed history by booking creation, not the order of polling responses',()=>{
  const old={...booking('old',2),b_created:new Date('2026-10-29T10:00:00Z')} as any
  const latest={...booking('latest',2),b_created:new Date('2026-10-30T10:00:00Z')} as any
  const recent=retainDriverHistory(null,'driver',old)
  expect(mergeDriverHistory([latest],recent,'driver')?.map(order=>order.b_id)).toEqual(['latest','old'])
})
