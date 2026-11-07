/** Local transport compatibility fixture; never included by the public QA entry. */
import axios from 'axios'
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'

function Fixture(){
 const [result,setResult]=useState(''),[busy,setBusy]=useState(false)
 const run=async(name:string)=>{
  setBusy(true);setResult('')
  try{
   const peer=new URL(new URLSearchParams(window.location.search).get('peer')||window.location.origin)
   if(peer.hostname!=='127.0.0.1'||window.location.hostname!=='127.0.0.1'||peer.protocol!=='http:')throw Error('This fixture only permits loopback HTTP')
   document.cookie='XSRF-TOKEN=synthetic-csrf-probe; path=/; SameSite=Strict'
   let value:unknown
   if(name==='same')value=(await axios.get('/echo')).data
   if(name==='cross')value=(await axios.get(peer.origin+'/echo',{withCredentials:true})).data
   if(name==='cross-default')value=(await axios.get(peer.origin+'/echo')).data
   if(name==='form'){
    const form=new FormData();form.append('u_name','Марокко + café');form.append('zero','0');form.append('flag','false')
    value=(await axios.post('/echo',form,{headers:{'Content-Type':'application/x-www-form-urlencoded'}})).data
   }
   if(name==='json'){
    const first=(await axios.post('/echo',{coordinates:[[-9.598,30.4206]],value:0},{headers:{Authorization:'Bearer synthetic-provider-only'}})).data
    const second=(await axios.get('/echo')).data;value={first,second}
   }
   if(name==='params')value=(await axios.get('/echo',{params:{q:'Марокко + %00',tag:['A/B','café']}})).data
   if(name==='failure'){
    try{await axios.get('/failure');value={unexpectedSuccess:true}}catch(error:any){value={status:error.response?.status,isAxiosError:axios.isAxiosError(error)}}
   }
   if(name==='timeout'){
    try{await axios.get('/slow',{timeout:60});value={unexpectedSuccess:true}}catch(error:any){value={code:error.code,isAxiosError:axios.isAxiosError(error)}}
   }
   setResult(JSON.stringify({case:name,value}))
  }catch(error:any){setResult(JSON.stringify({case:name,error:error.message}))}
  finally{setBusy(false)}
 }
 return <main><h1>Local HTTP compatibility test</h1><p>Loopback endpoints only. Synthetic values. No bookings.</p>{['same','cross','cross-default','form','json','params','failure','timeout'].map(name=><button key={name} type="button" data-testid={'probe-'+name} onClick={()=>void run(name)} disabled={busy}>{name}</button>)}<pre data-testid="probe-result">{result}</pre></main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
