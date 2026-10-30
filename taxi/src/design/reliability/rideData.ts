import {EBookingDriverState, EBookingStates} from '../../types/types'
export function numericAmount(value:unknown):number|undefined {
 for(let depth=0;Array.isArray(value)&&depth<4;depth++){if(value.length!==1)return undefined;value=value[0]}
 if(typeof value!=='number' && (typeof value!=='string'||!value.trim()))return undefined
 const amount=Number(value);return Number.isFinite(amount)&&amount>=0?amount:undefined
}
function object(value:any):any {if(typeof value==='string'){try{return object(JSON.parse(value))}catch{return {}}}return value&&typeof value==='object'?value:{}}
/** Read the quoted amount; never derive a quote from another driver's unselected bid. */
export function quotedFare(order:any,confirmedId?:unknown):{value:number;customer:boolean}|undefined {
 if(!order)return undefined
 const options=object(order.b_options),model=object(options.pricingModel)
 const assigned=(order.drivers||[]).filter((driver:any)=>[3,4,5,6].includes(Number(driver.c_state)))
 const chosen=confirmedId!=null?(order.drivers||[]).find((d:any)=>String(d.u_id)===String(confirmedId)&&Number(d.c_state)!==2):undefined
 const driver=chosen||(assigned.length===1?assigned[0]:undefined),offer=object(driver?.c_options),nested=object(offer.driver_offer||offer.offer)
 const values=[{value:model.price,final:model.calculationType==='complete'}, {value:order.b_price,final:terminalBooking(order)},
  {value:offer.performers_price},{value:offer.driver_offer_price},{value:nested.price},{value:driver?.c_price},
  {value:options.customer_price,customer:true},{value:order.b_price_estimate}]
 for(const candidate of values){const amount=numericAmount(candidate.value);if(amount!==undefined&&(amount>0||candidate.final))return {value:amount,customer:Boolean(candidate.customer)}}
 return undefined
}
export function terminalBooking(order:any):boolean {
 return [EBookingStates.Completed,EBookingStates.Canceled].includes(Number(order?.b_state))||Boolean(order?.b_completed||order?.b_canceled)
}
export function assignedDriver(order:any):any {
 return (order?.drivers||[]).find((d:any)=>[EBookingDriverState.Performer,EBookingDriverState.Arrived,EBookingDriverState.Started].includes(Number(d.c_state)))
}
/** An actual started trip is not a candidate, even on a newly signed-in device. */
export function startedTripDriver(order:any):any {
 const drivers=(order?.drivers||[]).filter((d:any)=>Number(d.c_state)===EBookingDriverState.Started)
 return !terminalBooking(order)&&drivers.length===1?drivers[0]:undefined
}
export function canExpireSearch(order:any):boolean {
 return Number(order?.b_state)===EBookingStates.Processing&&!startedTripDriver(order)
}
export function orderCurrency(order:any,fallback:string):string {
 const value=String(order?.b_currency||fallback).trim().toUpperCase()
 return /^[A-Z]{3}$/.test(value)?value:fallback
}
export function displayFare(value:unknown,currency:string,locale?:string,estimated=false):string {
 const amount=numericAmount(value)
 if(amount===undefined)return '—'
 try{return new Intl.NumberFormat(locale||undefined,{style:'currency',currency,currencyDisplay:'code',maximumFractionDigits:2}).format(amount).replace(/^/,estimated?'≈ ':'')}catch{return `${estimated?'≈ ':''}${amount} ${currency}`}
}
