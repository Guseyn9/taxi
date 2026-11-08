import type {IOrder} from '../types/types'
import {getTimestamp} from './reliableTime'

/** Detail reads retain route/profile fields; list polling can carry newer GPS. */
export function withLiveDriverLocations(detail:IOrder|null|undefined,partial:IOrder|null|undefined):IOrder|null|undefined{
 if(!detail)return partial
 if(!partial || String(detail.b_id)!==String(partial.b_id) || !detail.drivers?.length)return detail
 let changed=false
 const drivers=detail.drivers.map(driver=>{
  const live=partial.drivers?.find(item=>String(item.u_id)===String(driver.u_id))
  const newer=getTimestamp(live?.l_datetime),known=getTimestamp(driver.l_datetime)
  if(!live || !newer || (known!==null && known!==undefined && newer<=known))return driver
  const lat=live.c_latitude,lng=live.c_longitude
  if(typeof lat!=='number' || typeof lng!=='number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180)return driver
  changed=true
  return {...driver,c_latitude:lat,c_longitude:lng,l_datetime:live.l_datetime}
 })
 return changed?{...detail,drivers}:detail
}
