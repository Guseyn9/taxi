import moment from 'moment'
import {withLiveDriverLocations} from './liveDriverLocations'
const at=(seconds:number)=>moment.utc('2026-11-03T12:00:00Z').add(seconds,'seconds')
const detail:any={b_id:'42',b_state:2,b_start_address:'Full address',drivers:[{u_id:'7',c_id:'car',c_state:5,c_options:{performers_price:180},c_latitude:30.42,c_longitude:-9.6,l_datetime:at(0)}]}
const partial=(overrides:any={})=>({b_id:'42',b_state:1,drivers:[{u_id:'7',c_state:3,c_latitude:30.4242,c_longitude:-9.596,l_datetime:at(10),...overrides}]} as any)
it('newer list GPS updates a detailed order without replacing lifecycle, fare or route fields',()=>{
 const updated=withLiveDriverLocations(detail,partial())!
 expect(updated).not.toBe(detail)
 expect(updated.b_state).toBe(2);expect(updated.b_start_address).toBe('Full address')
 expect(updated.drivers![0]).toMatchObject({c_id:'car',c_state:5,c_options:{performers_price:180},c_latitude:30.4242,c_longitude:-9.596})
 expect(detail.drivers[0].c_latitude).toBe(30.42)
})
it('stale, undated or invalid list coordinates never replace detail GPS',()=>{
 for(const fields of [{l_datetime:at(-1)},{l_datetime:undefined},{c_latitude:NaN},{c_longitude:181},{c_latitude:null}])
  expect(withLiveDriverLocations(detail,partial(fields))).toBe(detail)
})
it('never uses a different booking or driver position',()=>{
 expect(withLiveDriverLocations(detail,{...partial(),b_id:'43'})).toBe(detail)
 expect(withLiveDriverLocations(detail,partial({u_id:'8'}))).toBe(detail)
 expect(withLiveDriverLocations(detail,{b_id:'42',drivers:[]} as any)).toBe(detail)
})
it('partial-only records and known detail remain stable when the other source is absent',()=>{
 const list=partial();expect(withLiveDriverLocations(undefined,list)).toBe(list)
 expect(withLiveDriverLocations(detail,undefined)).toBe(detail)
 expect(withLiveDriverLocations(undefined,undefined)).toBeUndefined()
})
