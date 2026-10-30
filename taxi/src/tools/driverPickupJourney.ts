import {useEffect,useState} from 'react'
import {EBookingDriverState} from '../types/types'

export type PickupStage = 'depart'|'arrive'|'board'
export function driverPickupStage(state:EBookingDriverState|undefined,departed:boolean):PickupStage|null {
  if(state===EBookingDriverState.Performer)return departed?'arrive':'depart'
  if(state===EBookingDriverState.Arrived)return 'board'
  return null
}

/** Departing changes navigation only. Arrived is published only at the pickup. */
export async function performPickupStage(stage:PickupStage,actions:{
  atPickup:boolean,depart:()=>void,arrive:()=>Promise<void>,board:()=>Promise<void>|void,
}):Promise<boolean>{
  if(stage==='depart'){actions.depart();return true}
  if(!actions.atPickup)return false
  if(stage==='arrive')await actions.arrive()
  else await actions.board()
  return true
}

const key=(owner:string)=>`taxi.driver.departures.${owner}`
const departureEvent='taxi:driver-departure'
export function readDriverDepartures(owner:string):string[]{
  if(!owner)return []
  try{const value=JSON.parse(sessionStorage.getItem(key(owner))||'[]');return Array.isArray(value)?value.filter(id=>typeof id==='string').slice(-100):[]}catch{return []}
}
export function rememberDriverDeparture(owner:string,ids:readonly string[],id:string):string[]{
  const next=Array.from(new Set([...ids,id])).slice(-100)
  try{if(owner)sessionStorage.setItem(key(owner),JSON.stringify(next))}catch{}
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(departureEvent,{detail:owner}))
  return next
}
export function useDriverDepartures(owner:string){
  const [state,setState]=useState(()=>({owner,ids:readDriverDepartures(owner)}))
  useEffect(()=>{if(state.owner!==owner)setState({owner,ids:readDriverDepartures(owner)})},[owner,state.owner])
  useEffect(()=>{
    const refresh=(event:Event)=>{if((event as CustomEvent).detail===owner)setState({owner,ids:readDriverDepartures(owner)})}
    window.addEventListener(departureEvent,refresh)
    return ()=>window.removeEventListener(departureEvent,refresh)
  },[owner])
  const ids=state.owner===owner?state.ids:[]
  const depart=(id:string)=>{
    const next=rememberDriverDeparture(owner,readDriverDepartures(owner),id)
    setState({owner,ids:next})
  }
  return {ids,depart}
}

const copy={
  ru:{board:'Подтвердить посадку',near:'Подтвердите прибытие рядом с точкой посадки (до 100 м).',location:'Ожидаем координаты водителя. Включите геолокацию.',failed:'Действие не подтверждено. Проверьте состояние заказа перед повтором.'},
  en:{board:'Confirm pickup',near:'Confirm arrival within 100 m of the pickup point.',location:'Waiting for driver location. Enable location access.',failed:'Action not confirmed. Check the order status before retrying.'},
  fr:{board:'Confirmer la prise en charge',near:'Confirmez votre arrivée à moins de 100 m du départ.',location:'Position du chauffeur indisponible. Activez la localisation.',failed:'Action non confirmée. Vérifiez le trajet avant de réessayer.'},
  ar:{board:'تأكيد الركوب',near:'أكد الوصول ضمن 100 متر من نقطة الانطلاق.',location:'في انتظار موقع السائق. فعّل تحديد الموقع.',failed:'لم يتم تأكيد الإجراء. تحقق من حالة الرحلة قبل المحاولة مجدداً.'},
}
export function driverJourneyCopy(iso?:string){return copy[(iso?.split('-')[0]||'en') as keyof typeof copy]||copy.en}
