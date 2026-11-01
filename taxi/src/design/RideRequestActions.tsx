import React,{useEffect,useId,useState} from 'react'
import {CarFront,Users,HandCoins,HelpCircle,Loader2} from 'lucide-react'
import {Button} from '../components/ui/button'
import Overlay from '../components/modals/Overlay'
import {journeyCopy} from './journeyCopy'
import {bookingActionCopy} from './bookingActionCopy'
type Mode='order'|'vote'|'offer'
interface Props {
 mode:Mode;onChange:(mode:Mode)=>void;onSubmit:(mode:Mode)=>void
 disabled?:boolean;submitDisabled?:boolean;pending?:boolean;error?:string|null
 iso?:string;priceField?:React.ReactNode;allowedModes?:readonly Mode[]
}
/** A main action submits once; the separate help action never creates a booking. */
export function RideRequestActions({mode,onChange,onSubmit,disabled,submitDisabled,pending,error,iso,priceField,allowedModes=['order','vote','offer']}:Props){
 const copy=journeyCopy(iso)
 const details=bookingActionCopy(iso),hintId=useId()
 const [dialog,setDialog]=useState<{mode:Mode,price:boolean}|null>(null)
 useEffect(()=>{if(dialog&&!allowedModes.includes(dialog.mode))setDialog(null)},[dialog,allowedModes])
 const choices=[{mode:'order' as Mode,Icon:CarFront},{mode:'vote' as Mode,Icon:Users},{mode:'offer' as Mode,Icon:HandCoins}].filter(choice=>allowedModes.includes(choice.mode))
 const hint=(value:Mode)=>value==='offer'?copy.offerHint:value==='vote'?copy.voteHint:copy.orderHint
 const submit=(value:Mode)=>{
  if(disabled||submitDisabled||pending||!allowedModes.includes(value))return
  onChange(value);onSubmit(value)
 }
 return <div className="rs-booking-actions">
  <div className="rs-booking-actions__list" aria-label={copy.mode}>
   {choices.map(({mode:choice,Icon})=><div key={choice} className={`rs-booking-action${mode===choice?' rs-booking-action--preferred':''}`} data-mode={choice} data-disabled={Boolean(disabled||pending||submitDisabled)}>
    <Button type="button" data-testid={`passenger-order-mode-${choice}`} className="rs-booking-action__submit"
     aria-label={copy[choice]} aria-describedby={`${hintId}-${choice}`} aria-busy={Boolean(pending&&mode===choice)}
     disabled={disabled||pending||submitDisabled} onClick={()=>{
      if(choice==='offer'&&priceField){onChange('offer');setDialog({mode:choice,price:true})}
      else submit(choice)
     }}>{pending&&mode===choice?<Loader2 aria-hidden="true" size={20}/>:<Icon aria-hidden="true" size={20}/>}<span className="rs-booking-action__label">{copy[choice]}</span><small id={`${hintId}-${choice}`} className="rs-booking-action__detail">{details[choice]}</small></Button>
    <button type="button" className="rs-booking-action__help" aria-label={`${copy.help}: ${copy[choice]}`} data-testid={`passenger-order-help-${choice}`}
     aria-haspopup="dialog" onClick={()=>setDialog({mode:choice,price:false})}><HelpCircle size={18} aria-hidden="true"/></button>
   </div>)}
  </div>
  {error&&<p className="rs-request-error" role="alert">{error}</p>}
  {dialog&&<Overlay isOpen onClick={()=>setDialog(null)}><section className="modal rs-booking-help">
    <h2>{copy[dialog.mode]}</h2><p>{hint(dialog.mode)}</p>
    {dialog.price&&<div className="rs-request-price">{priceField}</div>}
    {error&&dialog.price&&<p role="alert">{error}</p>}
    <Button type="button" data-testid={dialog.price?'passenger-order-submit':'passenger-order-help-close'} disabled={dialog.price&&(disabled||pending||submitDisabled)}
     onClick={()=>dialog.price?submit(dialog.mode):setDialog(null)}>{pending?'…':dialog.price?copy.sendOffer:copy.close}</Button>
   </section></Overlay>}
 </div>
}
