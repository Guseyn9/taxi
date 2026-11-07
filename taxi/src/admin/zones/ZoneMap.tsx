import React,{useEffect,useRef,useState} from 'react'
import {Maximize2,Minimize2} from 'lucide-react'
import L from 'leaflet'
import {MapContainer,Polyline,Polygon,Circle,Marker,useMapEvents,useMap} from 'react-leaflet'
import {Coordinate,ZoneKind,coordinate} from './model'
import {closedBoundary} from './geometry'
import {geometryCopy} from './geometryCopy'
import {MOROCCO_VIEW} from '../../design/maps/morocco'
import ZoneBasemap from './ZoneBasemap'
import {zoneCopy} from './copy'
function Click({onPoint}:{onPoint:(point:Coordinate)=>void}){useMapEvents({click:e=>onPoint([e.latlng.lat,e.latlng.lng])});return null}
function ResizeMap(){
 const map=useMap()
 useEffect(()=>{
  let frame=0
  const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const center=map.getCenter(),zoom=map.getZoom();map.invalidateSize({pan:false});map.setView(center,zoom,{animate:false})})})
  observer.observe(map.getContainer())
  return()=>{observer.disconnect();cancelAnimationFrame(frame)}
 },[map])
 return null
}
function InitialView({points,center,radius}:{points:Coordinate[],center:Coordinate|null,radius:number}){
 const map=useMap(),applied=useRef(false)
 useEffect(()=>{
  if(applied.current)return
  applied.current=true
  if(points.length>1)map.fitBounds(L.latLngBounds(points),{padding:[40,40],maxZoom:16,animate:false})
  else if(center&&coordinate(center)&&Number.isFinite(radius)&&radius>0)map.fitBounds(L.latLng(center).toBounds(radius*2),{padding:[40,40],maxZoom:16,animate:false})
 },[map,points,center,radius])
 return null
}
interface Props {
 points:Coordinate[];center:Coordinate|null;radius:number;kind:ZoneKind;onPoint:(point:Coordinate)=>void;label:string;iso?:string;disabled?:boolean;selectedVertex?:number|null
 onMoveVertex?:(index:number,point:Coordinate)=>void;onInsertVertex?:(after:number,point:Coordinate)=>void;onSelectVertex?:(index:number)=>void
 onDeleteVertex?:()=>void;canDeleteVertex?:boolean;onRadiusChange?:(radius:number)=>void
}
function handleIcon(text:string,selected=false,midpoint=false){return L.divIcon({className:`zone-handle${selected?' zone-handle--selected':''}${midpoint?' zone-handle--insert':''}`,html:`<span>${text}</span>`,iconSize:[40,40],iconAnchor:[20,20]})}
export default function ZoneMap({points,center,radius,kind,onPoint,label,iso,disabled=false,selectedVertex,onMoveVertex,onInsertVertex,onSelectVertex,onDeleteVertex,canDeleteVertex,onRadiusChange}:Props){
 const [fullscreen,setFullscreen]=useState(false),host=useRef<HTMLDivElement>(null),toggle=useRef<HTMLAnchorElement>(null)
 useEffect(()=>{
  if(!fullscreen)return
  const page=host.current?.closest('.zone-page') as HTMLElement|null,oldBody=document.body.style.overflow,oldPage=page?.style.overflow
  document.body.style.overflow='hidden';if(page)page.style.overflow='hidden'
  toggle.current?.focus({preventScroll:true})
  const keyboard=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();setFullscreen(false)}
   if(event.key==='Tab'){
    const items=Array.from(host.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),[tabindex="0"]')||[]).filter(x=>x.getClientRects().length)
    const first=items[0],last=items[items.length-1]
    if(!items.includes(document.activeElement as HTMLElement)||(!event.shiftKey&&document.activeElement===last)){event.preventDefault();first?.focus()}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
   }
  }
  window.addEventListener('keydown',keyboard)
  return()=>{document.body.style.overflow=oldBody;if(page)page.style.overflow=oldPage||'';window.removeEventListener('keydown',keyboard);toggle.current?.focus({preventScroll:true})}
 },[fullscreen])
 const copy=geometryCopy(iso),safePoints=points.filter(coordinate),closed=closedBoundary(points)
 const vertices=points.map((point,index)=>({point,index})).filter(({point,index})=>coordinate(point)&&(!closed||index<points.length-1))
 const initial=center&&coordinate(center)?center:safePoints[0]||[30.4278,-9.5981] as Coordinate
 return <div className="zone-map-shell"><div ref={host} className={`zone-map${fullscreen?' zone-map--fullscreen':''}`} role={fullscreen?'dialog':'region'} aria-modal={fullscreen||undefined} aria-label={label} data-fullscreen={fullscreen}>
  <MapContainer key={kind} center={initial} zoom={11} minZoom={5} maxBounds={MOROCCO_VIEW} attributionControl={false} style={{height:'100%',width:'100%'}}>
   <ZoneBasemap iso={iso}/>
   <ResizeMap/>
   <InitialView points={safePoints} center={center} radius={radius}/>
   <Click onPoint={p=>{if(!disabled)onPoint(p)}}/>
   {kind==='polygon'?<>
    {closed?<Polygon positions={safePoints} pathOptions={{color:'#b51218',fillOpacity:.12}}/>:<Polyline positions={safePoints} color="#b51218"/>}
    {vertices.map(({point,index})=><Marker key={`vertex-${index}`} position={point} icon={handleIcon(String(index+1),selectedVertex===index)} title={`${copy.vertex} ${index+1}`} alt={`${copy.vertex} ${index+1}`} draggable={!disabled&&Boolean(onMoveVertex)} bubblingMouseEvents={false}
     eventHandlers={{click:()=>{if(!disabled)onSelectVertex?.(index)},dragend:e=>{if(disabled)return;const p=e.target.getLatLng();onMoveVertex?.(index,[p.lat,p.lng])}}}/>)}
    {!disabled&&onInsertVertex&&safePoints.length===points.length&&points.length<5000&&points.slice(0,-1).map((p,index)=>{
     const q=points[index+1],midpoint:Coordinate=[(p[0]+q[0])/2,(p[1]+q[1])/2]
     return <Marker key={`insert-${index}`} position={midpoint} icon={handleIcon('+',false,true)} title={`${copy.insert} ${index+1}`} alt={`${copy.insert} ${index+1}`} bubblingMouseEvents={false} zIndexOffset={-100}
      eventHandlers={{click:()=>onInsertVertex(index,midpoint)}}/>
    })}
   </>:center&&coordinate(center)?<>
    {Number.isFinite(radius)&&radius>0&&<Circle center={center} radius={radius} pathOptions={{color:'#b51218'}}/>}
    <Marker position={center} icon={handleIcon('⊕')} title={copy.center} alt={copy.center} draggable={!disabled} bubblingMouseEvents={false} eventHandlers={{dragend:e=>{if(disabled)return;const p=e.target.getLatLng();onPoint([p.lat,p.lng])}}}/>
   </>:null}
  </MapContainer>
  {/* Viewing controls stay available when the form fieldset is locked. */}
  <a ref={toggle} href="#" role="button" className="zone-map-expand" aria-label={fullscreen?copy.collapse:copy.expand} title={fullscreen?copy.collapse:copy.expand} aria-pressed={fullscreen} onClick={e=>{e.preventDefault();setFullscreen(x=>!x)}} onKeyDown={e=>{if(e.key===' '){e.preventDefault();setFullscreen(x=>!x)}}}>{fullscreen?<><Minimize2 size={20}/><span>{copy.collapse}</span></>:<Maximize2 size={22}/>}</a>
  {fullscreen&&<div className="zone-map-editor-tools">
   {kind==='polygon'&&onDeleteVertex&&<button type="button" disabled={disabled||!canDeleteVertex} onClick={onDeleteVertex}>{copy.remove}</button>}
   {kind==='circle'&&onRadiusChange&&<input type="range" aria-label={zoneCopy(iso).radius} disabled={disabled} min={1} max={Math.max(10000,Math.ceil(radius/1000)*1000)} value={Math.max(1,radius)} onChange={e=>onRadiusChange(Number(e.target.value))}/>}
  </div>}
 </div></div>
}
