import React,{useRef,useState} from 'react'
import Overlay from '../components/modals/Overlay'
import {t,TRANSLATION} from '../localization'
import type {IOrder} from '../types/types'
import {isBoardingCodeAccepted,normalizeBoardingCode} from '../tools/driverBoarding'

export function BoardingCodeDialog({expected,onConfirm,onClose}:{expected:unknown,onConfirm:(code:string)=>Promise<void>,onClose:()=>void}){
 const [code,setCode]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false)
 const inFlight=useRef(false)
 const close=()=>{if(!inFlight.current)onClose()}
 return <Overlay isOpen onClick={close}><section className="modal pilot-boarding-modal"><h2>{t(TRANSLATION.CLIENT_BOARDING_CODE)}</h2>
 <form onSubmit={async event=>{
  event.preventDefault();if(inFlight.current)return
  const entered=normalizeBoardingCode(code)
  // The driver's vehicle number is not a passenger PIN. Unknown PINs are checked by the server.
  if(!isBoardingCodeAccepted(expected,entered)){setError(t(TRANSLATION.WRONG_BOARDING_CODE));return}
  inFlight.current=true;setPending(true);setError('')
  try{await onConfirm(entered);onClose()}catch(error){setError(t(String((error as any)?.message||'').includes('wrong driver code')?TRANSLATION.WRONG_BOARDING_CODE:TRANSLATION.ERROR))}finally{inFlight.current=false;setPending(false)}
 }}><label>{t(TRANSLATION.CLIENT_BOARDING_CODE)}<input data-testid="driver-boarding-code-input" aria-label={t(TRANSLATION.CLIENT_BOARDING_CODE)} value={code} onInput={event=>setCode(event.currentTarget.value)} type="text" inputMode="text" maxLength={32} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={pending}/></label>
 {error&&<p role="alert">{error}</p>}<button type="submit" data-testid="driver-boarding-confirm" disabled={pending}>{pending?t(TRANSLATION.LOADING):t(TRANSLATION.DRIVER_VOTING_CONFIRM_CODE)}</button></form></section></Overlay>
}
export function useBoardingGate(){
 const [request,setRequest]=useState<{expected:unknown,submit:(code:string)=>Promise<void>}|null>(null)
 return {requestBoarding:async(order:IOrder,submit:(code:string)=>Promise<void>,_resolveExpected?:()=>Promise<string>)=>{
  if(!order.b_voting && !order.b_driver_code){await submit('');return}
  setRequest({expected:order.b_driver_code,submit})
 },boardingDialog:request?<BoardingCodeDialog expected={request.expected} onConfirm={request.submit} onClose={()=>setRequest(null)}/>:null}
}
