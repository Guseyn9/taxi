import {needsOrderDetailRefresh} from './orderDetailRefresh'
const order=(drivers:any[]=[],patch:object={})=>({b_id:'42',b_state:1,drivers,...patch} as any)
const driver=(state=1,options:any={performers_price:180.5})=>({u_id:'7',c_id:'8',c_state:state,c_options:options,c_arrive_state:false})
it('requests detail when a first response or new offer terms arrive',()=>{
 expect(needsOrderDetailRefresh(order(),order([driver()]))).toBe(true)
 expect(needsOrderDetailRefresh(order([driver()]),order([driver(1,{performers_price:190.75})]))).toBe(true)
})
it('requests detail for selection, arrival, cancellation and booking confirmation',()=>{
 expect(needsOrderDetailRefresh(order([driver(1)]),order([driver(3)]))).toBe(true)
 expect(needsOrderDetailRefresh(order([driver(3)]),order([driver(3)] ,{b_state:3}))).toBe(true)
 expect(needsOrderDetailRefresh(order([], {b_confirm_state:false}),order([], {b_confirm_state:true}))).toBe(true)
 expect(needsOrderDetailRefresh(order([driver(3)]),order([{...driver(3),c_arrive_state:true}]))).toBe(true)
})
it('does not request another detail for canceled entries omitted by the list',()=>{
 expect(needsOrderDetailRefresh(order([driver(2)]),order())).toBe(false)
 expect(needsOrderDetailRefresh(order([driver(2),{...driver(),u_id:'9'}]),order([{...driver(),u_id:'9'}]))).toBe(false)
})
it('ignores ordering, JSON representation, profile and GPS-only changes',()=>{
 const a=driver(),b={...driver(),u_id:'9'}
 expect(needsOrderDetailRefresh(order([a,b]),order([{...b,c_latitude:30,l_datetime:'new'}, {...a,c_options:JSON.stringify(a.c_options),u_name:'new'}]))).toBe(false)
})
it('requires matching snapshots and does not mutate them',()=>{
 const full=order([driver()]),partial=order([driver(3)])
 const before=JSON.stringify([full,partial]);expect(needsOrderDetailRefresh(full,partial)).toBe(true)
 expect(JSON.stringify([full,partial])).toBe(before)
 expect(needsOrderDetailRefresh(undefined,partial)).toBe(false)
 expect(needsOrderDetailRefresh(full,{...partial,b_id:'43'})).toBe(false)
})
