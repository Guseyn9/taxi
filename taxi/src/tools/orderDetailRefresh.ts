import {isEqual} from 'lodash'
import type {IOrder} from '../types/types'
import {EBookingDriverState} from '../types/types'

const optionValue=(value:unknown)=>{
 if(typeof value!=='string')return value
 try{return JSON.parse(value)}catch{return value}
}
const participants=(order:IOrder)=>(order.drivers??[])
 .filter(driver=>Number(driver.c_state)!==EBookingDriverState.Canceled)
 .map(driver=>({id:String(driver.u_id),car:String(driver.c_id??''),state:Number(driver.c_state),arrived:Boolean(driver.c_arrive_state),options:optionValue(driver.c_options)}))
 .sort((a,b)=>a.id.localeCompare(b.id))

/** A list change requests a fresh detail read; it never synthesizes a lifecycle transition.
 * GPS is deliberately excluded and handled by timestamped location projection.
 * The active endpoint omits canceled participants, unlike the detail endpoint.
 */
export function needsOrderDetailRefresh(detail:IOrder|null|undefined,partial:IOrder|null|undefined):boolean{
 if(!detail||!partial||String(detail.b_id)!==String(partial.b_id))return false
 const keys=['b_state','b_confirm_state','b_voting','b_cars_count','b_car_class','b_location_class','b_passengers_count','b_max_waiting','b_options'] as const
 if(keys.some(key=>partial[key]!==undefined&&!isEqual(optionValue(detail[key]),optionValue(partial[key]))))return true
 return !isEqual(participants(detail),participants(partial))
}
