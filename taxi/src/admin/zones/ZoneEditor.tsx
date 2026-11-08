import React,{useEffect,useState,useId} from 'react'
import {Zone,ZoneKind,Coordinate,zoneLocales,zonePayload,validateZone,zoneKind,coordinate,zoneNumber} from './model'
import {zoneCopy} from './copy'
import ZoneMap from './ZoneMap'
import {closedBoundary,moveVertex,insertVertex,removeVertex,canRemoveVertex,parseZonePoints} from './geometry'
import {geometryCopy} from './geometryCopy'
export default function ZoneEditor({zone,iso,busy,blocked,onDirty,onSave,onCancel}:{zone:Zone,iso?:string,busy:boolean,blocked:boolean,onDirty:(dirty:boolean)=>void,onSave:(zone:Zone,kind:ZoneKind)=>void,onCancel:()=>void}){
 const copy=zoneCopy(iso),[draft,setDraft]=useState(zone),[kind,setKind]=useState<ZoneKind>(zoneKind(zone)),[text,setText]=useState(JSON.stringify(zone.coordinates?.[0]||[],null,2)),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false)
 const advanced=(zone.coordinates?.length||0)>1
 const editingCopy=geometryCopy(iso),[selectedVertex,setSelectedVertex]=useState<number|null>(null)
 useEffect(()=>{setSelectedVertex(null);setDraft(zone);setKind(zoneKind(zone));setText(JSON.stringify(zone.coordinates?.[0]||[],null,2));setError('');setConfirmed(false);onDirty(false)},[zone])
 function update(next:Zone){setDraft(next);setError('');setConfirmed(false);onDirty(true)}
 const parsedPoints=parseZonePoints(text),points=parsedPoints||[],geometryErrorId=useId()
 const geometry=(next:Coordinate[])=>{setText(JSON.stringify(next,null,2));setConfirmed(false);setError('');onDirty(true)}
 const locked=busy||blocked||advanced
 const mapLocked=locked||(kind==='polygon'&&parsedPoints===null)
 const latitude=zoneNumber(draft.json?.lat),longitude=zoneNumber(draft.json?.lng),radius=zoneNumber(draft.json?.radius)||0
 const center=latitude!==null&&longitude!==null&&coordinate([latitude,longitude])?[latitude,longitude] as Coordinate:null
 function submit(e:React.FormEvent){e.preventDefault();if(locked||!confirmed)return;let next=draft
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
   <p>{kind==='polygon'?editingCopy.polygonHint:editingCopy.circleHint}</p>
   <ZoneMap key={zone.id||'new'} kind={kind} points={points} center={center} radius={radius} label={copy.geometry} iso={iso} disabled={mapLocked} selectedVertex={selectedVertex}
    canDeleteVertex={selectedVertex!==null&&canRemoveVertex(points,selectedVertex)}
    onDeleteVertex={()=>{if(!locked&&selectedVertex!==null){geometry(removeVertex(points,selectedVertex));setSelectedVertex(null)}}}
    onRadiusChange={radius=>{if(!locked)update({...draft,json:{...draft.json,radius}})}}
    onSelectVertex={index=>{if(!locked)setSelectedVertex(index)}}
    onMoveVertex={(index,p)=>{if(!mapLocked){geometry(moveVertex(points,index,p));setSelectedVertex(index)}}}
    onInsertVertex={(index,p)=>{if(!mapLocked){geometry(insertVertex(points,index,p));setSelectedVertex(index+1)}}}
    onPoint={p=>{if(mapLocked)return;if(kind==='circle')update({...draft,json:{...draft.json,lat:p[0],lng:p[1]}});else {const closed=closedBoundary(points);geometry(closed?[...points.slice(0,-1),p,points[0]]:[...points,p])}}}/>
   {kind==='polygon'?<><div className="zone-tools"><button type="button" disabled={!points.length} onClick={()=>{geometry(points.slice(0,-1));setSelectedVertex(null)}}>{copy.undo}</button><button type="button" disabled={points.length<3||closedBoundary(points)} onClick={()=>{if(points.length)geometry([...points,points[0]])}}>{copy.close}</button><button type="button" disabled={selectedVertex===null||!canRemoveVertex(points,selectedVertex)} onClick={()=>{if(selectedVertex!==null){geometry(removeVertex(points,selectedVertex));setSelectedVertex(null)}}}>{editingCopy.remove}</button><button type="button" disabled={!points.length} onClick={()=>{geometry([]);setSelectedVertex(null)}}>{copy.clear}</button></div><label>{copy.geometry}<textarea name="zone-geometry" aria-invalid={parsedPoints===null} aria-describedby={parsedPoints===null?geometryErrorId:undefined} rows={6} value={text} spellCheck={false} onChange={e=>{setText(e.target.value);setSelectedVertex(null);onDirty(true);setConfirmed(false);setError('')}}/></label>{parsedPoints===null&&<p id={geometryErrorId} role="alert" className="zone-error">{editingCopy.inputError}</p>}</>:<><label>{copy.radius}<input type="range" name="zone-radius-slider" min={1} max={Math.max(10000,Math.ceil(radius/1000)*1000)} step={1} value={Math.max(1,radius||1)} onChange={e=>update({...draft,json:{...draft.json,radius:Number(e.target.value)}})}/></label><div className="zone-name-grid">{(['lat','lng','radius'] as const).map(key=><label key={key}>{copy[key]}<input name={`zone-${key}`} inputMode="decimal" value={String(draft.json?.[key]??'')} onChange={e=>update({...draft,json:{...draft.json,[key]:e.target.value}})}/></label>)}</div></>}
   <p>{copy.review}</p><label className="zone-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{copy.confirm}</label>
  </fieldset>
  {advanced&&<p role="alert">{copy.advanced}</p>}
  {error&&<p className="zone-error" role="alert">{error}</p>}
  <div className="zone-tools"><button type="submit" disabled={busy||blocked||advanced||!confirmed}>{busy?copy.loading:copy.save}</button><button type="button" disabled={busy} onClick={onCancel}>{copy.cancel}</button></div>
 </form>
}
