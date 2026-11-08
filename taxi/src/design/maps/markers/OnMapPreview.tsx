import {useTaxiColor} from '../useTaxiColor'
import {taxiPicture} from '../taxiPalette'
import {useSelector} from 'react-redux'
import {clientOrderSelectors} from '../../../state/clientOrder'
import {getClassArtworkKind} from '../../../components/CarClassBadge'
import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { Marker, Polyline, Tooltip, useMap } from 'react-leaflet'
import { Play, Pause, X, RotateCcw } from 'lucide-react'
import SmoothRotatingMarker from '../../../components/SmoothRotatingMarker'
import { PASSENGER } from './assets'
import coordinates from './casablanca-route.json'
import './markers.css'

const route = coordinates as [number,number][]
const passenger = new L.Icon({iconUrl:PASSENGER,iconSize:[42,52],iconAnchor:[21,45]})
const lengths=route.map((point,i)=>i?L.latLng(route[i-1]).distanceTo(L.latLng(point)):0)
const length=lengths.reduce((sum,item)=>sum+item,0)
export function routePosition(progress:number):[number,number] {
  let remaining=Math.max(0,Math.min(1,progress))*length
  for(let i=1;i<route.length;i++){
    if(remaining<=lengths[i]){const f=lengths[i]?remaining/lengths[i]:0;return [route[i-1][0]+(route[i][0]-route[i-1][0])*f,route[i-1][1]+(route[i][1]-route[i-1][1])*f]}
    remaining-=lengths[i]
  }
  return route[route.length-1]
}
/** Isolated marker preview on the real map; never writes order, route or emulator state. */
export default function OnMapPreview({onCameraChange}:{onCameraChange?:()=>void}){
  const map=useMap()
  const selectedClass=useSelector(clientOrderSelectors.carClass)
  const vehicleKind=getClassArtworkKind(selectedClass)
  const vehicleColor=useTaxiColor(route[0],vehicleKind)
  const controls=useRef<HTMLDivElement>(null)
  const [active,setActive]=useState(false),[playing,setPlaying]=useState(false),[progress,setProgress]=useState(0)
  const [seekVersion,setSeekVersion]=useState(0)
  const camera=useRef<{center:L.LatLng,zoom:number}|null>(null)
  function framing(){
    const box=map.getContainer().getBoundingClientRect()
    const sheet=map.getContainer().closest('.passenger')?.querySelector('.passenger__form-container')?.getBoundingClientRect()
    const left=window.innerWidth>=900 && sheet?Math.max(54,Math.min(sheet.right-box.left+24,map.getSize().x-240)):54
    return {paddingTopLeft:L.point(left,map.getSize().y<350?80:54),paddingBottomRight:L.point(54,map.getSize().y<350?36:54),maxZoom:17,animate:false}
  }
  useEffect(()=>{if(controls.current){L.DomEvent.disableClickPropagation(controls.current);L.DomEvent.disableScrollPropagation(controls.current)}},[active])
  useEffect(()=>{
    if(!active || !playing)return
    let last=performance.now()
    const interval=window.setInterval(()=>{const now=performance.now(),delta=(now-last)/45000;last=now;setProgress(value=>Math.min(1,value+delta))},100)
    return()=>window.clearInterval(interval)
  },[active,playing])
  useEffect(()=>{if(progress>=1)setPlaying(false)},[progress])
  // Restore only the camera this preview changed, including on route unmount.
  useEffect(()=>()=>{if(camera.current && map.getContainer().isConnected){map.setView(camera.current.center,camera.current.zoom,{animate:false});camera.current=null}},[map])
  useEffect(()=>{
    if(!active)return
    const fit=()=>map.fitBounds(L.latLngBounds(route),framing())
    const frame=requestAnimationFrame(()=>{map.invalidateSize();fit()})
    map.on('resize',fit)
    return()=>{cancelAnimationFrame(frame);map.off('resize',fit)}
  },[active,map])
  function start(){onCameraChange?.();camera.current={center:map.getCenter(),zoom:map.getZoom()};setProgress(0);setActive(true);setPlaying(true);map.fitBounds(L.latLngBounds(route),framing())}
  useEffect(()=>{const open=()=>{if(!active)start()};window.addEventListener('taxi.ui.map-demo',open);return()=>window.removeEventListener('taxi.ui.map-demo',open)},[active,map])
  function close(){setPlaying(false);setActive(false);if(camera.current){map.setView(camera.current.center,camera.current.zoom,{animate:false});camera.current=null}}
  return <>
    <div ref={controls} className={`rs-map-marker-preview ${active?'rs-map-preview-active':''}`} data-map-preview={active?'active':'idle'}>
      {!active?<button type="button" onClick={start}><Play size={16}/>Тест такси</button>:<>
        <div className="rs-marker-preview-title"><b>Демо на карте</b><span>Casablanca · без заказа</span></div>
        <div className="rs-marker-preview-actions"><button type="button" aria-label={playing?'Пауза движения':'Продолжить движение'} onClick={()=>{if(progress===1){setSeekVersion(value=>value+1);setProgress(0);}setPlaying(!playing)}}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><button type="button" aria-label="Начать маршрут сначала" onClick={()=>{setSeekVersion(value=>value+1);setProgress(0);setPlaying(false)}}><RotateCcw size={18}/></button><button type="button" aria-label="Закрыть тест движения" onClick={close}><X size={18}/></button></div>
        <label>Маршрут <output>{Math.round(progress*100)}%</output><input aria-label="Положение такси на карте" type="range" min="0" max="100" step=".1" value={progress*100} onChange={e=>{setSeekVersion(value=>value+1);setPlaying(false);setProgress(Number(e.target.value)/100)}}/></label>
      </>}
    </div>
    {active && <>
      <Polyline positions={route} pathOptions={{color:'#b51218',weight:5,opacity:.8}}/>
      <Marker position={route[route.length-1]} icon={passenger} alt="Пассажир · демо"><Tooltip direction="top" offset={[0,-40]}>Пассажир · демо</Tooltip></Marker>
      <SmoothRotatingMarker key={seekVersion} position={routePosition(progress)} iconUrl={taxiPicture(vehicleColor,'top',vehicleKind)} className="smooth-rotating-marker rs-taxi-marker rs-demo-taxi" path={route} speedKmh={80} zIndexOffset={2000}><Tooltip direction="top" offset={[0,-26]}>Такси · демо</Tooltip></SmoothRotatingMarker>
    </>}
  </>
}
