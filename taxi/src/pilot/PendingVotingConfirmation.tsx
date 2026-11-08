import React,{useEffect,useRef,useState} from 'react'
import type {IOrder} from '../types/types'
import {t,TRANSLATION} from '../localization'
import {passengerGateway} from '../platform/adapters/LegacyPassengerGateway'
import {getApiErrorMessage} from '../tools/apiMessages'
import {terminalBooking} from '../design/reliability/rideData'
import './pending-voting.css'

/** Recover the second step of creation using the existing booking ID. */
export default function PendingVotingConfirmation({order,onUpdated}:{order:IOrder,onUpdated:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false)
 const pending=useRef(false),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 if(!order.b_voting || order.b_confirm_state!==false || terminalBooking(order) || confirmed)return null
 const confirm=async()=>{
  if(pending.current)return
  pending.current=true;setBusy(true);setError('')
  try{
   await passengerGateway.confirmOrder(order.b_id)
   if(mounted.current){setConfirmed(true);onUpdated()}
  }catch(failure){if(mounted.current)setError(getApiErrorMessage(failure))}
  finally{pending.current=false;if(mounted.current)setBusy(false)}
 }
 return <section className="pending-voting" data-testid="voting-confirmation-pending" aria-busy={busy}>
  <p role="status">{t('voting_confirmation_pending')}</p>
  {error&&<p role="alert">{error}</p>}
  <button type="button" data-testid="voting-confirmation-retry" onClick={confirm} disabled={busy}>{t(busy?TRANSLATION.LOADING:'voting_confirmation_retry')}</button>
 </section>
}
