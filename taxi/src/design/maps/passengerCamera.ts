import {isInMoroccoView,moroccoCities,MOROCCO_CENTER,MOROCCO_ZOOM} from './morocco'
export function savedMapArea(){
  try{const id=localStorage.getItem('taxi.ui.map-area');return moroccoCities.some(city=>city.id===id)?id!:'morocco'}catch{return 'morocco'}
}
/** Seed the camera before tiles load, without replacing an explicit point or GPS. */
export function passengerInitialCamera(explicit:[number,number]|undefined,saved:[number,number]|null,hasOrder:boolean){
  if(explicit)return {center:explicit,zoom:15,overview:false}
  if(isInMoroccoView(saved))return {center:saved!,zoom:15,overview:false}
  const city=!hasOrder?moroccoCities.find(city=>city.id===savedMapArea()):null
  if(city)return {center:[city.position[0],city.position[1]] as [number,number],zoom:13,overview:false}
  return {center:MOROCCO_CENTER,zoom:MOROCCO_ZOOM,overview:!hasOrder}
}
