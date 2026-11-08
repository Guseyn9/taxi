import React,{useEffect,useState} from 'react'
import L from 'leaflet'
import {useMap} from 'react-leaflet'
import {maplibreGL} from '@maplibre/maplibre-gl-leaflet'
import {setWorkerUrl,setWorkerCount} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {createMapStyle,MAP_ATTRIBUTION} from '../../design/maps/rsale-style'
import {observeMapRenderer} from '../../diagnostics/mapRendererHealth'
import {t} from '../../localization'
setWorkerUrl('/maps/maplibre-gl-worker.mjs')
setWorkerCount(2)
/** The same Drive Morocco vector style as the passenger map; no trip controls or Redux bootstrap. */
export default function ZoneBasemap({iso}:{iso?:string}){
 const map=useMap(),[status,setStatus]=useState('loading'),[revision,setRevision]=useState(0)
 const locale=iso?.split('-')[0]||'fr'
 useEffect(()=>{
  let disposed=false,vector:L.MaplibreGL|undefined,fallback:L.TileLayer|undefined,detach:(()=>void)|undefined,failureTimer:number|undefined
  const attribution=L.control.attribution({position:'bottomright',prefix:false}).addTo(map)
  attribution.addAttribution(MAP_ATTRIBUTION);setStatus('loading')
  const activateFallback=()=>{
   if(disposed||fallback)return
   window.clearTimeout(timer)
   detach?.();detach=undefined
   if(vector&&map.hasLayer(vector))map.removeLayer(vector)
   vector=undefined;attribution.removeAttribution(MAP_ATTRIBUTION)
   fallback=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{noWrap:true,attribution:'© OpenStreetMap contributors'}).addTo(map)
   setStatus('fallback')
  }
  const timer=window.setTimeout(activateFallback,20000)
  try{
   const options:Parameters<typeof maplibreGL>[0]&{padding:number}={style:createMapStyle(locale),attributionControl:false,renderWorldCopies:false,padding:.05}
   vector=maplibreGL(options).addTo(map)
   const renderer=vector.getMaplibreMap(),releaseHealth=observeMapRenderer(renderer,activateFallback)
   const sourceFailure=(event:any)=>{if(event.sourceId==='basemap'&&failureTimer===undefined)failureTimer=window.setTimeout(()=>{failureTimer=undefined;activateFallback()},0)}
   renderer.on('error',sourceFailure)
   detach=()=>{releaseHealth();renderer.off('error',sourceFailure)}
   renderer.once('load',()=>{if(!disposed&&!fallback){window.clearTimeout(timer);setStatus('ready')}})
  }catch{window.clearTimeout(timer);activateFallback()}
  return()=>{disposed=true;window.clearTimeout(timer);if(failureTimer!==undefined)window.clearTimeout(failureTimer);detach?.();if(vector&&map.hasLayer(vector))map.removeLayer(vector);if(fallback&&map.hasLayer(fallback))map.removeLayer(fallback);attribution.remove()}
 },[map,locale,revision])
 return <div className="zone-map-status" data-testid="zone-map-status" data-renderer={status==='fallback'?'raster-fallback':'maplibre'} data-status={status} role="status">
  {status==='loading'&&t('loading',{fallback:'Loading map…'})}
  {status==='fallback'&&<button type="button" onClick={()=>setRevision(x=>x+1)}>{t('retry',{fallback:'Retry map'})}</button>}
 </div>
}
