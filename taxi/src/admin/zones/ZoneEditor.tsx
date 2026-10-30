import React,{useEffect,useState} from 'react'
import {Zone,ZoneKind,Coordinate,zoneLocales,zonePayload,validateZone,zoneKind,coordinate} from './model'
import {zoneCopy} from './copy'
import ZoneMap from './ZoneMap'
export default function ZoneEditor({zone,iso,busy,blocked,onDirty,onSave,onCancel}:{zone:Zone,iso?:string,busy:boolean,blocked:boolean,onDirty:(dirty:boolean)=>void,onSave:(zone:Zone,kind:ZoneKind)=>void,onCancel:()=>void}){
 const copy=zoneCopy(iso),[draft,setDraft]=useState(zone),[kind,setKind]=useState<ZoneKind>(zoneKind(zone)),[text,setText]=useState(JSON.stringify(zone.coordinates?.[0]||[],null,2)),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false)
 const advanced=(zone.coordinates?.length||0)>1
 useEffect(()=>{setDraft(zone);setKind(zoneKind(zone));setText(JSON.stringify(zone.coordinates?.[0]||[],null,2));setError('');setConfirmed(false);onDirty(false)},[zone])
 function update(next:Zone){setDraft(next);setError('');setConfirmed(false);onDirty(true)}
 let points:Coordinate[]=[];try{const parsed=JSON.parse(text);if(Array.isArray(parsed))points=parsed}catch{}
 const geometry=(next:Coordinate[])=>{setText(JSON.stringify(next,null,2));setConfirmed(false);setError('');onDirty(true)}
 const center=coordinate([Number(draft.json?.lat),Number(draft.json?.lng)])?[Number(draft.json?.lat),Number(draft.json?.lng)] as Coordinate:null
 function submit(e:React.FormEvent){e.preventDefault();let next=draft
  if(kind==='polygon'){try{next={...draft,coordinates:[JSON.parse(text)]}}catch{setError(copy.invalidPolygon);return}}
  const invalid=validateZone(next,kind)
  if(invalid){setError(invalid==='identifier'?copy.identifier:invalid==='circle'?copy.invalidCircle:copy.invalidPolygon);return}
  if(!confirmed)return
  onSave(zonePayload(next,kind),kind)
 }
 return <form className="zone-editor" onSubmit={submit} aria-label={copy.edit}>
  <fieldset disabled={busy||blocked||advanced}>
   <legend>{zone.id?`№${zone.id}`:copy.newZone}</legend>
   <label>{copy.name}<input name="zone-var" required value={draft.var} autoComplete="off" spellCheck={false} onChange={e=>update({...draft,var:e.target.value})}/></label>
   <div className="zone-name-grid">{zoneLocales.map(locale=><label key={locale}>{locale.toUpperCase()}<input name={`zone-${locale}`} value={String(draft[locale]||'')} dir="auto" autoComplete="off" onChange={e=>update({...draft,[locale]:e.target.value})}/></label>)}</div>
   <label>{copy.polygon} / {copy.circle}<select disabled={Boolean(zone.id)} value={kind} onChange={e=>{setKind(e.target.value as ZoneKind);setConfirmed(false);onDirty(true)}}><option value="polygon">{copy.polygon}</option><option value="circle">{copy.circle}</option></select></label>
   <p>{copy.mapHint}</p>
   <ZoneMap key={`${zone.id||'new'}-${zone.var}`} kind={kind} points={points} center={center} radius={Number(draft.json?.radius)||0} label={copy.geometry}
    onPoint={p=>{if(busy||blocked||advanced)return;if(kind==='circle')update({...draft,json:{...draft.json,lat:p[0],lng:p[1]}});else {const closed=points.length>3&&JSON.stringify(points[0])===JSON.stringify(points[points.length-1]);geometry(closed?[...points.slice(0,-1),p,points[0]]:[...points,p])}}}/>
   {kind==='polygon'?<><div className="zone-tools"><button type="button" disabled={!points.length} onClick={()=>geometry(points.slice(0,-1))}>{copy.undo}</button><button type="button" disabled={points.length<3||JSON.stringify(points[0])===JSON.stringify(points[points.length-1])} onClick={()=>{if(points.length)geometry([...points,points[0]])}}>{copy.close}</button><button type="button" disabled={!points.length} onClick={()=>geometry([])}>{copy.clear}</button></div><label>{copy.geometry}<textarea name="zone-geometry" rows={6} value={text} spellCheck={false} onChange={e=>{setText(e.target.value);onDirty(true);setConfirmed(false);setError('')}}/></label></>:<div className="zone-name-grid">{(['lat','lng','radius'] as const).map(key=><label key={key}>{copy[key]}<input name={`zone-${key}`} inputMode="decimal" value={String(draft.json?.[key]??'')} onChange={e=>update({...draft,json:{...draft.json,[key]:e.target.value}})}/></label>)}</div>}
   <p>{copy.review}</p><label className="zone-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{copy.confirm}</label>
  </fieldset>
  {advanced&&<p role="alert">{copy.advanced}</p>}
  {error&&<p className="zone-error" role="alert">{error}</p>}
  <div className="zone-tools"><button type="submit" disabled={busy||blocked||advanced||!confirmed}>{busy?copy.loading:copy.save}</button><button type="button" disabled={busy} onClick={onCancel}>{copy.cancel}</button></div>
 </form>
}
