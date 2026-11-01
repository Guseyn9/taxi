/** Presentation acceptance only. Real locked form + markers, synthetic positions, no order commands. */
import React,{useEffect,useState,useRef} from 'react'
import {MapContainer,TileLayer,Polyline,Marker,useMap} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import VotingForm from '../pages/Passenger/VotingForm'
import SheetHandle from '../design/SheetHandle'
import SmoothRotatingMarker from '../components/SmoothRotatingMarker'
import {taxiPicture,DEFAULT_TAXI_COLOR} from '../design/maps/taxiPalette'
import {viewportPadding} from '../design/maps/RsaleBasemap'
import '../design/maps/maps.css'
import './map-priority-fixture.css'
const pickup:[number,number]=[30.4167,-9.6]
const paths:[number,number][][]=[[[30.414,-9.608],[30.4148,-9.606],[30.4153,-9.603],[30.4167,-9.6]],[[30.422,-9.603],[30.4205,-9.602],[30.4185,-9.602],[30.4167,-9.6]]]
function Camera(){const map=useMap();useEffect(()=>{
 const update=()=>{viewportPadding(map);map.invalidateSize();map.fitBounds(L.latLngBounds([...paths[0],...paths[1]]),{paddingTopLeft:[20,98],paddingBottomRight:[20,20],animate:false})}
 const sheet=map.getContainer().closest('.passenger')?.querySelector('.passenger__form-container')
 const observer=new ResizeObserver(()=>requestAnimationFrame(update));if(sheet)observer.observe(sheet)
 const id=requestAnimationFrame(update);return()=>{cancelAnimationFrame(id);observer.disconnect()}
},[map]);return null}
export default function MapPriorityFixture({order}:{order:any}){
 const [expanded,setExpanded]=useState(false),[collapsed,setCollapsed]=useState(false),[tick,setTick]=useState(0)
 const minRef=useRef<HTMLElement>(null),noSwipe=useRef<HTMLElement[]>([])
 useEffect(()=>{const timer=setInterval(()=>setTick(value=>(value+1)%4),4000);return()=>clearInterval(timer)},[])
 return <div className="qa-map-priority"><header>QA · отклики водителей <small>Тестовые данные · backend отключён</small></header><main className="passenger"><nav className="qa-map-priority__plaque">№QA-MAP · Голосование · Водителей: 2</nav><div className="map-container passenger__form-map-container"><div className="map-container__leaflet-host"><MapContainer className="map" center={pickup} zoom={15} zoomControl={false} style={{width:'100%',height:'100%'}}><TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='© OpenStreetMap contributors'/><Camera/>{paths.map((path,index)=><React.Fragment key={index}><Polyline positions={path} pathOptions={{color:index?'#16a34a':'#2563eb',weight:4}}/><SmoothRotatingMarker position={path[tick]} path={path} iconUrl={taxiPicture(DEFAULT_TAXI_COLOR)} iconSize={[48,48]} iconAnchor={[24,24]} speedKmh={35}/></React.Fragment>)}<Marker position={pickup} icon={L.divIcon({className:'qa-map-priority__pickup',html:'●',iconSize:[24,24]})}/></MapContainer></div></div><div className="passenger__form-container" data-sheet-collapsed={collapsed}><section className="passenger__draggable"><SheetHandle collapsed={collapsed} onChange={setCollapsed} iso="ru"/><div className="qa-map-priority__form" onClickCapture={event=>{if((event.target as Element).closest('button')){event.preventDefault();event.stopPropagation()}}}><VotingForm lockedOrder={order} lockedOrderId={order.b_id} isExpanded={expanded} setIsExpanded={setExpanded} syncFrom={()=>{}} syncTo={()=>{}} onSubmit={()=>{}} onLockedCancel={async()=>{}} onNewOrder={()=>{}} minimizedPartRef={minRef} noSwipeElementsRef={noSwipe}/></div></section></div></main></div>
}
