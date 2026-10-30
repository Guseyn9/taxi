import {useEffect,useState} from 'react'
import {savedMapArea} from './passengerCamera'
import {taxiColor,DEFAULT_TAXI_COLOR} from './taxiPalette'
export function useTaxiColor(point?:readonly number[]|null){
 const [city,setCity]=useState(savedMapArea)
 useEffect(()=>{const update=()=>setCity(savedMapArea());window.addEventListener('taxi.ui.map-area-changed',update);window.addEventListener('storage',update);return()=>{window.removeEventListener('taxi.ui.map-area-changed',update);window.removeEventListener('storage',update)}},[])
 return taxiColor({city,point,palette:DEFAULT_TAXI_COLOR})
}
