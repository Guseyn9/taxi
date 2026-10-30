import {EBookingDriverState,IOrder} from '../types/types'
import {terminalBooking} from './reliability/rideData'
const KEY='taxi.ui.selected-trip'
export function rememberTrip(owner:unknown,id:unknown):void {
 try{if(!owner)return;if(id===null||id===undefined)sessionStorage.removeItem(`${KEY}:${owner}`);else sessionStorage.setItem(`${KEY}:${owner}`,String(id))}catch{/* Storage is optional. */}
}
export function rememberedTrip(owner:unknown):string|null {try{return owner?sessionStorage.getItem(`${KEY}:${owner}`):null}catch{return null}}
/** A terminal booking cannot be resurrected by an old driver's Started state. */
export function tripToRestore(orders:IOrder[]|null,selectedId?:string|null):IOrder|null {
 const rank=(order:IOrder)=>Math.max(0,...(order.drivers||[]).map(driver=>Number(driver.c_state)===EBookingDriverState.Started?3:Number(driver.c_state)===EBookingDriverState.Arrived?2:Number(driver.c_state)===EBookingDriverState.Performer?1:0))
 const active=(orders||[]).filter(order=>!terminalBooking(order))
 const running=active.filter(order=>rank(order)>0).sort((a,b)=>rank(b)-rank(a))[0]
 return running||active.find(order=>selectedId!=null&&String(order.b_id)===String(selectedId))||null
}
