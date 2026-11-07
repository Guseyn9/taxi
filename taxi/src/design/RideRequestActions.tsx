import React,{useEffect,useId,useState} from 'react'
import {CarFront,Users,HandCoins,Info,Loader2} from 'lucide-react'
import {Button} from '../components/ui/button'
import Overlay from '../components/modals/Overlay'
import {journeyCopy} from './journeyCopy'
import {bookingActionCopy} from './bookingActionCopy'
type Mode='order'|'vote'|'offer'
interface Props {
 mode:Mode;onChange:(mode:Mode)=>void;onSubmit:(mode:Mode)=>void
 disabled?:boolean;submitDisabled?:boolean;pending?:boolean;error?:string|null;blockedReason?:string
 iso?:string;priceField?:React.ReactNode;allowedModes?:readonly Mode[]
}
/** A main action submits once; the separate help action never creates a booking. */
export function RideRequestActions({mode,onChange,onSubmit,disabled,submitDisabled,pending,error,blockedReason,iso,priceField,allowedModes=['order','vote','offer']}:Props){
 const copy=journeyCopy(iso)
 const details=bookingActionCopy(iso),hintId=useId()
 const [dialog,setDialog]=useState<{mode:Mode|null,price:boolean}|null>(null)
 useEffect(()=>{if(dialog?.mode&&!allowedModes.includes(dialog.mode))setDialog(null)},[dialog,allowedModes])
 const choices=[{mode:'order' as Mode,Icon:CarFront},{mode:'vote' as Mode,Icon:Users},{mode:'offer' as Mode,Icon:HandCoins}].filter(choice=>allowedModes.includes(choice.mode))
 const hint=(value:Mode)=>value==='offer'?copy.offerHint:value==='vote'?copy.voteHint:copy.orderHint
 const submit=(value:Mode)=>{
  if(disabled||submitDisabled||pending||!allowedModes.includes(value))return
  onChange(value);onSubmit(value)
 }
 return <div className="rs-booking-actions">
  {blockedReason&&<p id={`${hintId}-blocked`} className="rs-booking-blocked" role="status">{blockedReason}</p>}
  <button type="button" className="rs-booking-actions__help" data-testid="passenger-order-help"
   aria-label={copy.mode} aria-haspopup="dialog" aria-expanded={Boolean(dialog&&!dialog.price)} onClick={()=>setDialog({mode:null,price:false})}>
   <Info size={18} aria-hidden="true"/><span>{copy.mode}</span>
  </button>
  <div className="rs-booking-actions__list" aria-label={copy.mode}>
   {choices.map(({mode:choice,Icon})=><div key={choice} className={`rs-booking-action${mode===choice?' rs-booking-action--preferred':''}`} data-mode={choice} data-disabled={Boolean(disabled||pending||submitDisabled)}>
    <Button type="button" data-testid={`passenger-order-mode-${choice}`} className="rs-booking-action__submit"
     aria-label={copy[choice]} aria-describedby={`${hintId}-${choice}${blockedReason?` ${hintId}-blocked`:''}`} aria-busy={Boolean(pending&&mode===choice)}
     disabled={disabled||pending||submitDisabled} onClick={()=>{
      if(choice==='offer'&&priceField){onChange('offer');setDialog({mode:choice,price:true})}
      else submit(choice)
     }}>{pending&&mode===choice?<Loader2 aria-hidden="true" size={20}/>:<Icon aria-hidden="true" size={20}/>}<span className="rs-booking-action__label">{copy[choice]}</span><small id={`${hintId}-${choice}`} className="rs-booking-action__detail">{details[choice]}</small></Button>
   </div>)}
  </div>
  {error&&<p className="rs-request-error" role="alert">{error}</p>}
  {dialog&&<Overlay isOpen onClick={()=>setDialog(null)}><section className="modal rs-booking-help">
    <h2>{dialog.mode?copy[dialog.mode]:copy.mode}</h2>
    {dialog.mode?<p>{hint(dialog.mode)}</p>:<div className="rs-booking-help__methods">{choices.map(({mode:choice,Icon})=><section key={choice}>
      <Icon size={24} aria-hidden="true"/><div><h3>{copy[choice]}</h3><p>{hint(choice)}</p></div>
    </section>)}</div>}
    {dialog.price&&<div className="rs-request-price">{priceField}</div>}
    {error&&dialog.price&&<p role="alert">{error}</p>}
    <Button type="button" data-testid={dialog.price?'passenger-order-submit':'passenger-order-help-close'} disabled={dialog.price&&(disabled||pending||submitDisabled)}
     onClick={()=>dialog.price&&dialog.mode?submit(dialog.mode):setDialog(null)}>{pending&&dialog.price?'…':dialog.price?copy.sendOffer:copy.close}</Button>
   </section></Overlay>}
 </div>
}
