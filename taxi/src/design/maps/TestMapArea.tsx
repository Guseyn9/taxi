import React,{useState} from 'react'
import {t} from '../../localization'
import {moroccoCities} from './morocco'
import {savedMapArea} from './passengerCamera'
export const TEST_MAP_AREA_EVENT='taxi.ui.test-map-area'
export function selectTestMapArea(value:string){
 if(value!=='morocco'&&!moroccoCities.some(city=>city.id===value))return false
 try{localStorage.setItem('taxi.ui.map-area',value)}catch{}
 window.dispatchEvent(new CustomEvent(TEST_MAP_AREA_EVENT,{detail:value}))
 return true
}
/** Camera-only test aid. It never writes geolocation, service polygons or vehicle livery. */
export default function TestMapArea(){
 const [value,setValue]=useState(savedMapArea)
 return <label className="test-map-area">{t('test_map_area',{fallback:'Test map location'})}
 <select value={value} onChange={event=>{if(selectTestMapArea(event.target.value))setValue(event.target.value)}}>
  <option value="morocco">{t('morocco',{fallback:'Morocco'})}</option>
  {moroccoCities.map(city=><option key={city.id} value={city.id}>{city.name}</option>)}
 </select></label>
}
