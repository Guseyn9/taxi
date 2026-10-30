import React from 'react'
import {MapContainer,TileLayer,Polyline,Polygon,Circle,CircleMarker,useMapEvents} from 'react-leaflet'
import {Coordinate,ZoneKind,coordinate} from './model'
import {MOROCCO_VIEW} from '../../design/maps/morocco'
function Click({onPoint}:{onPoint:(point:Coordinate)=>void}){useMapEvents({click:e=>onPoint([e.latlng.lat,e.latlng.lng])});return null}
export default function ZoneMap({points,center,radius,kind,onPoint,label}:{points:Coordinate[],center:Coordinate|null,radius:number,kind:ZoneKind,onPoint:(point:Coordinate)=>void,label:string}){
 const safePoints=points.filter(coordinate)
 const initial=center&&coordinate(center)?center:safePoints[0]||[30.4278,-9.5981] as Coordinate
 return <div className="zone-map" role="region" aria-label={label}>
  <MapContainer key={kind} center={initial} zoom={11} minZoom={5} maxBounds={MOROCCO_VIEW} style={{height:'100%',width:'100%'}}>
   <TileLayer attribution='© OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
   <Click onPoint={onPoint}/>
   {kind==='polygon'?<>{safePoints.length>3&&JSON.stringify(safePoints[0])===JSON.stringify(safePoints[safePoints.length-1])?<Polygon positions={safePoints} pathOptions={{color:'#5b2dda',fillOpacity:.12}}/>:<Polyline positions={safePoints} color="#5b2dda"/>}{safePoints.map((p,i)=><CircleMarker key={i} center={p} radius={4} pathOptions={{color:'#5b2dda'}}/>)}</>:center&&coordinate(center)&&Number.isFinite(radius)&&radius>0?<Circle center={center} radius={radius} pathOptions={{color:'#5b2dda'}}/>:null}
  </MapContainer>
 </div>
}
