import React from 'react'
import {CarFront,Users,HandCoins} from 'lucide-react'
import {Button} from '../components/ui/button'
import {journeyCopy} from './journeyCopy'
type Mode='order'|'vote'|'offer'
export function RideRequestActions({mode,onChange,onSubmit,disabled,submitDisabled,pending,error,iso,priceField}:{mode:Mode,onChange:(mode:Mode)=>void,onSubmit:(mode:Mode)=>void,disabled?:boolean,submitDisabled?:boolean,pending?:boolean,error?:string|null,iso?:string,priceField?:React.ReactNode}){
 const copy=journeyCopy(iso)
 const choices=[{mode:'order' as Mode,Icon:CarFront},{mode:'vote' as Mode,Icon:Users},{mode:'offer' as Mode,Icon:HandCoins}]
 const hint=mode==='offer'?copy.offerHint:mode==='vote'?copy.voteHint:copy.orderHint
 const action=mode==='offer'?copy.sendOffer:mode==='vote'?copy.sendVote:copy.sendOrder
 return <div className="rs-request-actions">
  <fieldset className="rs-request-modes" disabled={disabled||pending}><legend className="sr-only">{copy.mode}</legend>
   {choices.map(({mode:choice,Icon})=><label key={choice} className={`rs-request-mode${mode===choice?' rs-request-mode--selected':''}`}>
    <input type="radio" name="ride-request-mode" data-testid={`passenger-order-mode-${choice}`} value={choice} checked={mode===choice} onChange={()=>onChange(choice)}/>
    <Icon aria-hidden="true" size={18}/><span>{copy[choice]}</span>
   </label>)}
  </fieldset>
  <div className="rs-request-context">
   {mode==='offer'&&priceField ? <>{priceField}<p className="sr-only" id="ride-request-hint">{hint}</p></> : <p className="rs-request-hint" id="ride-request-hint">{hint}</p>}
  </div>
  {error&&<p className="rs-request-error" role="alert">{error}</p>}
  <Button type="button" className="rs-request-submit" data-testid="passenger-order-submit" aria-describedby="ride-request-hint" disabled={disabled||submitDisabled||pending} onClick={()=>onSubmit(mode)}>{pending?'…':action}</Button>
 </div>
}
