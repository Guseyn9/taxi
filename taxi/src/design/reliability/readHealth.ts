import type {Middleware} from 'redux'
import { readChannels, subscribeReadChannels } from '../../diagnostics/readChannels'
export type ReadHealth={failed:boolean;pending:boolean;updatedAt:number;authRetry?:boolean}
let state:ReadHealth={failed:false,pending:false,updatedAt:0}
const listeners=new Set<()=>void>()
export function markAuthRetry(value:boolean){update({...state,authRetry:value})}
export const readHealth=()=>{
 const channels=readChannels(),timestamps=[state.updatedAt,...channels.map(value=>value.updatedAt)].filter(value=>value>0)
 return {...state,failed:state.failed||channels.some(value=>value.failed),pending:state.pending||channels.some(value=>value.pending),updatedAt:timestamps.length?Math.min(...timestamps):0}
}
export const subscribeReadHealth=(listener:()=>void)=>{listeners.add(listener);const stop=subscribeReadChannels(listener);return()=>{listeners.delete(listener);stop()}}
function update(next:ReadHealth){state=next;listeners.forEach(listener=>listener())}
export const readHealthMiddleware:Middleware=()=>next=>action=>{
 const result=next(action),type=String((action as any)?.type||'')
 if(/\/GET_ACTIVE_ORDERS_REQUEST$/.test(type))update({...state,pending:true})
 if(/\/GET_ACTIVE_ORDERS_SUCCESS$/.test(type))update({failed:false,pending:false,updatedAt:Date.now()})
 if(/\/GET_ACTIVE_ORDERS_FAIL$/.test(type))update({...state,pending:false,failed:true})
 if(/\/LOGOUT_START$|\/LOGIN_START$/.test(type))update({failed:false,pending:false,updatedAt:0})
 return result
}
/** Coalesce browser resume signals. This only requests reads; never replay a user command. */
export function subscribeResume(refresh:()=>void,windowTarget:Window=window,documentTarget:Document=document,now:()=>number=Date.now):()=>void {
 let timer:ReturnType<typeof setTimeout>|undefined,last=-Infinity
 const resume=()=>{
  if(windowTarget.navigator.onLine===false||documentTarget.visibilityState==='hidden')return
  if(timer)clearTimeout(timer)
  timer=setTimeout(()=>{timer=undefined;if(now()-last<1000)return;last=now();refresh()},150)
 }
 windowTarget.addEventListener('online',resume);windowTarget.addEventListener('focus',resume);windowTarget.addEventListener('pageshow',resume);documentTarget.addEventListener('visibilitychange',resume)
 return()=>{if(timer)clearTimeout(timer);windowTarget.removeEventListener('online',resume);windowTarget.removeEventListener('focus',resume);windowTarget.removeEventListener('pageshow',resume);documentTarget.removeEventListener('visibilitychange',resume)}
}
