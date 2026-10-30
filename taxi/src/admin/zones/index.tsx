import React,{useEffect,useRef,useState} from 'react'
import {connect,ConnectedProps} from 'react-redux'
import {IRootState} from '../../state'
import {userSelectors} from '../../state/user'
import {configSelectors} from '../../state/config'
import {modalsActionCreators} from '../../state/modals'
import {EUserRoles} from '../../types/types'
import Layout from '../../components/Layout'
import {Zone,ZoneKind,zoneLabel} from './model'
import {readZoneCatalog,saveZone} from './gateway'
import {zoneCopy} from './copy'
import ZoneEditor from './ZoneEditor'
import './zones.css'
const connector=connect((s:IRootState)=>({user:userSelectors.user(s),iso:configSelectors.language(s)?.iso}),{login:modalsActionCreators.setLoginModal})
export function ZoneAdminScreen({user,iso,login}:ConnectedProps<typeof connector>){
 const copy=zoneCopy(iso),allowed=Number(user?.u_role)===EUserRoles.Administrator
 const [zones,setZones]=useState<Zone[]>([]),[selected,setSelected]=useState<Zone|null>(null),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[dirty,setDirty]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState('')
 const generation=useRef(0),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++}},[])
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
 async function reload(){const request=++generation.current;setLoading(true);setMessage('');try{const items=await readZoneCatalog();if(!mounted.current||request!==generation.current)return;setZones(items);setSelected(null);setDirty(false);setUncertain(false)}catch{if(mounted.current&&request===generation.current)setMessage(copy.error)}finally{if(mounted.current&&request===generation.current)setLoading(false)}}
 useEffect(()=>{generation.current++;setZones([]);setSelected(null);setDirty(false);setUncertain(false);setSaving(false);if(allowed)reload()},[allowed,user?.u_id])
 function choose(zone:Zone){if(dirty){setMessage(copy.dirty);return}setSelected(zone);setMessage('')}
 async function save(zone:Zone,kind:ZoneKind){
  if(!allowed||saving||uncertain)return
  if(zones.some(item=>item.var===zone.var&&String(item.id)!==String(zone.id))){setMessage(copy.identifier);return}
  const request=++generation.current
  const current=()=>mounted.current&&request===generation.current
  setSaving(true);setMessage('')
  try{
   await saveZone(zone,kind)
   if(!current())return
   setDirty(false);setSelected(null);setMessage(copy.saved)
   const items=await readZoneCatalog()
   if(current())setZones(items)
  }catch{if(current()){setUncertain(true);setMessage(copy.unknown)}}
  finally{if(current())setSaving(false)}
 }

 return <Layout><section className="zone-page" dir={iso?.startsWith('ar')?'rtl':undefined}><header><h1>{copy.title}</h1><p>{copy.intro}</p></header>
  {!allowed?<div className="zone-access"><p>{copy.access}</p>{!user&&<button type="button" onClick={()=>login(true)}>{copy.login}</button>}</div>:<>
   <div className="zone-tools"><button type="button" disabled={loading||saving||(dirty&&!uncertain)} onClick={reload}>{loading?copy.loading:copy.reload}</button><button type="button" disabled={loading||saving||uncertain} onClick={()=>choose({var:'',coordinates:[]})}>{copy.newZone}</button></div>
   {message&&<p role="status" aria-live="polite" className={uncertain?'zone-error':''}>{message}</p>}
   <div className="zone-workspace"><nav aria-label={copy.list}>{!zones.length&&!loading&&<p>{copy.empty}</p>}{zones.map(zone=><button type="button" key={zone.id} disabled={saving||loading||uncertain} aria-current={selected?.id===zone.id?'true':undefined} onClick={()=>choose(zone)}><strong>{zoneLabel(zone,iso)}</strong><small>{zone.var} · №{zone.id}</small></button>)}</nav>
   {selected?<ZoneEditor key={selected.id||'new'} zone={selected} iso={iso} busy={saving} blocked={uncertain} onDirty={setDirty} onSave={save} onCancel={()=>{setSelected(null);setDirty(false)}}/>:<p>{copy.edit}</p>}</div>
  </>}
 </section></Layout>
}
export default connector(ZoneAdminScreen)
