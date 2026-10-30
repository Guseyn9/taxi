import React,{useState} from 'react'
import {locationFailure} from './freshLocation'
const copy:Record<string,{allow:string,retry:string,busy:string,close:string,help:string}>={
 ru:{allow:'Разрешить геолокацию',retry:'Попробовать снова',busy:'Определяем…',close:'Закрыть сообщение',help:'Если окно разрешения не появилось: откройте настройки сайта рядом с адресом → Геолокация → Разрешить. Затем нажмите «Попробовать снова». Если доступ закрыт для самого браузера, разрешите его в настройках устройства.'},
 en:{allow:'Allow location',retry:'Try again',busy:'Locating…',close:'Dismiss',help:'If no permission prompt appears, open site settings next to the address → Location → Allow. Then try again. If location is blocked for the browser itself, allow it in device settings.'},
 fr:{allow:'Autoriser la position',retry:'Réessayer',busy:'Localisation…',close:'Fermer',help:'Si aucune demande apparaît, ouvrez les paramètres du site près de l’adresse → Position → Autoriser. Réessayez ensuite. Si le navigateur est bloqué, autorisez-le dans les paramètres de l’appareil.'},
 ar:{allow:'السماح بالموقع',retry:'حاول مجدداً',busy:'جارٍ تحديد الموقع…',close:'إغلاق',help:'إذا لم يظهر طلب الإذن، افتح إعدادات الموقع بجانب العنوان ثم الموقع ثم السماح، وحاول مجدداً. إذا كان المتصفح محظوراً، اسمح له في إعدادات الجهاز.'}
}
export default function LocationFeedback({code,iso,busy,onAllow,onClose}:{code:number,iso?:string,busy:boolean,onAllow:()=>void,onClose:()=>void}){
 const [attempted,setAttempted]=useState(false)
 const labels=copy[(iso||'en').split('-')[0]]||copy.en
 return <div className="map-location-feedback" role="status">
  <div className="map-location-feedback__content">
   <p>{locationFailure(code,iso)}</p>
   <button type="button" className="map-location-feedback__allow" disabled={busy} aria-busy={busy} onClick={()=>{setAttempted(true);onAllow()}}>{busy?labels.busy:code===1&&!attempted?labels.allow:labels.retry}</button>
   {attempted&&code===1&&!busy&&<p className="map-location-feedback__help">{labels.help}</p>}
  </div>
  <button type="button" className="map-location-feedback__close" aria-label={labels.close} onClick={onClose}>×</button>
 </div>
}
