import {isInMoroccoView} from './morocco'
export function validMapPoint(value:unknown):value is [number,number]{return Array.isArray(value)&&value.length===2&&value.every(v=>typeof v==='number'&&Number.isFinite(v))&&Math.abs(value[0])<=90&&Math.abs(value[1])<=180}
/** Passive GPS must never take the camera away from a chosen route or out of the service region. */
export function canAutoCenter(point:[number,number],accuracy:number,protectedView:boolean):boolean {
 return validMapPoint(point)&&isInMoroccoView(point)&&Number.isFinite(accuracy)&&accuracy>=0&&accuracy<=200&&!protectedView
}
function cameraPoint(value:any):[number,number]|undefined {
 if(validMapPoint(value))return value
 const point=[value?.lat??value?.latitude,value?.lng??value?.longitude]
 return validMapPoint(point)?point:undefined
}
export function initialDriverCamera(...points:unknown[]):[number,number]|undefined {return points.map(cameraPoint).find(point=>point&&isInMoroccoView(point))}
