import {useEffect,useState} from 'react'
import {pendingOffer,markPendingOffer,pendingOfferEvent,recoverOffer} from './pendingOffer'
import {passengerGateway} from '../platform/adapters/LegacyPassengerGateway'
import {isOfferOrder,setStoredChoiceOrderMode} from '../tools/driverOffer'
import {terminalBooking} from '../design/reliability/rideData'
export function usePendingOffer(owner:unknown,id:any,onRecovered:()=>void) {
 const [revision,change]=useState(0)
 useEffect(()=>{const update=()=>change(x=>x+1);window.addEventListener(pendingOfferEvent,update);window.addEventListener('storage',update);return()=>{window.removeEventListener(pendingOfferEvent,update);window.removeEventListener('storage',update)}},[])
 const pending=pendingOffer(owner,id)
 useEffect(()=>{
  if(!pending)return
  let active=true,timer:ReturnType<typeof setTimeout>
  const check=async()=>{
   const state=await recoverOffer({read:()=>passengerGateway.getOrder(id),isOffer:isOfferOrder,isTerminal:terminalBooking})
   if(!active)return
   if(state==='verified'||state==='terminal') {
    // Set the confirmed mode before unblocking the presentation.
    if(state==='verified')setStoredChoiceOrderMode(id,'offer')
    markPendingOffer(owner,id,false);onRecovered()
   } else timer=setTimeout(check,5000)
  }
  check()
  return()=>{active=false;clearTimeout(timer)}
 },[owner,id,pending,revision]) // One sequential read at a time; never replay create/cancel.
 return pending
}
