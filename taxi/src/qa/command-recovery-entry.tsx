/** Isolated protocol fixture. Built only by the local recovery browser test. */
import React,{useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import runtimeStore from '../state'
import {ActionTypes as ConfigActions} from '../state/config/constants'
import DriverCommandRecoveryNotice,{useDriverCommandRecovery} from '../components/DriverCommandRecoveryNotice'
import {commandNeedsRecovery} from '../platform/adapters/DriverCommandRecovery'
import {DriverMapGateway,DRIVER_MAP_EVENTS} from '../platform/adapters/DriverMapGateway'
import {CommandStatusDriverCommandCompletionWaiter} from '../platform/adapters/DriverCommandCompletionWaiter'
import {FsmCommandStatusTransport} from '../platform/adapters/FsmCommandStatusTransport'
import {FsmTaxiCommandTransport} from '../platform/adapters/FsmTaxiCommandTransport'
import {saveSessionTokens,getSessionRecoveryId} from '../security/sessionTokens'
import '../components/Layout/styles.scss'

runtimeStore.dispatch({type:ConfigActions.SET_LANGUAGE,payload:{id:1,iso:'ru',name:'Русский'}})
saveSessionTokens({token:'synthetic-protocol-test',u_hash:'synthetic-protocol-test'})
const listeners=new Set<(event:any)=>void>(),handlers=new Set<(action:any)=>Promise<void>>()
const runtime:any={getSnapshot:()=>null,subscribe:(listener:any)=>{listeners.add(listener);return()=>listeners.delete(listener)},publish:(event:any)=>listeners.forEach(listener=>listener(event)),registerHandler:(handler:any)=>{handlers.add(handler);return()=>handlers.delete(handler)},dispatch:async(action:any)=>{for(const handler of Array.from(handlers))await handler(action)}}
const waiter=new CommandStatusDriverCommandCompletionWaiter(new FsmCommandStatusTransport({apiUrl:window.location.origin}),1800,100)
const gateway=new DriverMapGateway(runtime,new FsmTaxiCommandTransport({apiUrl:window.location.origin}),3000,waiter,{scope:()=>({userId:'1420',service:window.location.origin,sessionId:getSessionRecoveryId()!})})
function Fixture(){
 const [state,setState]=useState('Загружается'),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const records=useDriverCommandRecovery(gateway.recovery,'1420')
 const blocked=records.some(item=>item.orderId==='42'&&commandNeedsRecovery(item))
 const refresh=()=>fetch('/test/order').then(response=>response.json()).then(value=>setState(value.state))
 useEffect(()=>{const stop=gateway.subscribe(event=>{if(event.type===DRIVER_MAP_EVENTS.RecoveryChecked)void refresh()});gateway.setRecoveryIdentity('1420');const unmount=gateway.mount();void refresh();return()=>{stop();unmount()}},[])
 const start=async()=>{setBusy(true);setMessage('');try{await gateway.start('42');await refresh()}catch{setMessage('Результат ещё не получен. Проверьте состояние действия.')}finally{setBusy(false)}}
 return <main className="layout"><header className="test-header"><strong>taxi<span>.</span></strong><span>Водитель · локальная проверка</span></header><DriverCommandRecoveryNotice controller={gateway.recovery} userId="1420" iso="ru"/><section className="test-content"><div className="test-order"><p>Заказ №42</p><h1>Поездка в Агадире</h1><p data-testid="order-state">{state}</p><dl><dt>Откуда</dt><dd>Avenue Hassan II</dd><dt>Куда</dt><dd>Place Al Amal</dd></dl><button data-testid="start-command" onClick={start} disabled={busy||blocked}>Начать поездку</button>{message&&<p role="status">{message}</p>}</div><div className="test-map" aria-label="Область карты">Изолированный тест протокола<br/>без заказов на рабочем сервере</div></section><style>{`*{box-sizing:border-box}body{margin:0;font-family:Manrope,Arial,sans-serif;color:#181818}.test-header{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;gap:12px;border-bottom:1px solid #e4e4e4;font-size:13px;min-height:64px}.test-header strong{font-size:30px}.test-header strong span{color:#b80f19}.test-content{display:flex;flex:1;min-height:0;background:#f5f4f2;overflow:auto;padding:20px;gap:20px}.test-order{background:white;border:1px solid #e4e4e4;border-radius:24px;padding:24px;max-width:400px;align-self:flex-start;flex:1}.test-order h1{font-size:24px;line-height:1.25}.test-order p{font-size:14px;line-height:1.5}.test-order dt{font-size:13px;color:#666;margin-top:20px}.test-order dd{margin:4px 0 0;font-weight:700}.test-order button{min-height:48px;background:#b80f19;color:white;border:0;border-radius:14px;padding:12px 18px;font:700 14px Manrope,Arial,sans-serif;width:100%;margin-top:20px}.test-order button:disabled{background:#e4d7d7;color:#574b49}.test-map{flex:1;border-radius:24px;background:#e4e9e6;display:grid;place-content:center;color:#4c5950;text-align:center;padding:20px;font-size:14px;line-height:1.5}@media(max-width:600px){.test-content{padding:12px;flex-direction:column;gap:12px}.test-order{max-width:none;width:100%;padding:20px}.test-header{padding:12px;font-size:11px}.test-map{min-height:100px}}`}</style></main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
