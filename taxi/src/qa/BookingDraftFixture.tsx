/** Real booking form and reducers, deterministic local state. No live configuration or orders. */
import '../pages/Passenger/styles.scss'
import React,{useMemo,useRef,useState} from 'react'
import {Provider} from 'react-redux'
import {createStore} from 'redux'
import SITE_CONSTANTS from '../siteConstants'
import rootReducer from '../state/rootReducer'
import runtimeStore from '../state'
import {EStatuses} from '../types/types'
import VotingForm from '../pages/Passenger/VotingForm'
import SheetHandle from '../design/SheetHandle'
const from={latitude:30.4167,longitude:-9.6,address:'Avenue Hassan II, Agadir'}
const to={latitude:30.425,longitude:-9.615,address:'Marina, Agadir'}
export default function BookingDraftFixture(){
 const [expanded,setExpanded]=useState(false),[collapsed,setCollapsed]=useState(false)
 const bodyRef=useRef<HTMLElement>(null),noSwipe=useRef<HTMLElement[]>([])
 const store=useMemo(()=>{
  ;(window as any).data={car_classes:{1:{name:'PETIT',seats:4,courier_call_rate:10,booking_location_classes:['city','intercity']},2:{name:'GRAND',seats:6,courier_call_rate:10,booking_location_classes:['city','intercity']}},booking_location_classes:{city:{alias:'city',upper:0},intercity:{alias:'countries_list',upper:1}}}
  SITE_CONSTANTS.recalculate()
  const base=runtimeStore.getState()
  return createStore((state:ReturnType<typeof runtimeStore.getState>={...base,config:base.config.set('status',EStatuses.Success),user:base.user.set('user',null),clientOrder:base.clientOrder.set('carClass','1').set('locationClass','city').set('from',null).set('to',null).set('phone',null)},action:any)=>{
   if(action.type==='QA_DRAFT_STATE'){
    const stage=action.payload
    return {...state,clientOrder:state.clientOrder.set('from',stage==='empty'?null:from).set('to',stage==='empty'?null:to)
      .set('fromPolygons',['qa-city']).set('toPolygons',['qa-city']).set('fromLoading',false).set('toLoading',false)
      .set('fromZoneStatus',stage==='error'?'error':stage==='checking'?'checking':'ready').set('toZoneStatus','ready')
      .set('phone',stage==='phone'?null:212612345678)}
   }
   return rootReducer(state,action)
  })
 },[])
 return <Provider store={store}><style>{`.qa-draft-tools{position:fixed;inset:0 0 auto;z-index:2000;display:flex;gap:8px;padding:8px;background:white;flex-wrap:wrap;min-height:48px}.qa-draft-tools *{font:600 11px/16px Manrope,sans-serif}.qa-draft-tools button{min-height:32px;padding:4px 8px;border:1px solid #ddd;border-radius:6px;background:#fff}#root .qa-draft{position:absolute;inset:60px 0 0;height:calc(100dvh - 88px)!important;top:88px!important;margin:0!important;width:100%;overflow:hidden}.qa-map-placeholder{position:absolute;inset:0;display:grid;place-items:center;padding:20px;background:repeating-linear-gradient(45deg,#f4e6df,#f4e6df 1px,#faf3ef 1px,#faf3ef 32px);color:#77645f;font:500 12px/18px Manrope,sans-serif}.qa-draft .passenger__form-map-container{position:absolute;inset:0}`}</style><div className="qa-draft-tools"><b>QA · форма · без backend</b>{['empty','checking','error','phone','ready'].map(value=><button key={value} onClick={()=>store.dispatch({type:'QA_DRAFT_STATE',payload:value})}>{value}</button>)}</div><main className="passenger qa-draft"><div className="passenger__form-map-container"><div className="qa-map-placeholder">Область карты · локальная проверка компоновки</div></div><div className="passenger__form-container" data-sheet-collapsed={collapsed}><section className="passenger__draggable"><SheetHandle iso="ru" collapsed={collapsed} onChange={value=>{setCollapsed(value);if(value)setExpanded(false)}}/><VotingForm isExpanded={expanded} setIsExpanded={setExpanded} syncFrom={()=>{}} syncTo={()=>{}} onSubmit={()=>{}} minimizedPartRef={bodyRef} noSwipeElementsRef={noSwipe}/></section></div></main></Provider>
}
