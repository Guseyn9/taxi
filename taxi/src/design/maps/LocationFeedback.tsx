import React from 'react'
import {MapPin, X} from 'lucide-react'
import {serviceText} from '../serviceText'
import {locationFailure} from './freshLocation'
import './location-feedback.css'
const copy={
 ru:{outside:'Вы за пределами Марокко',title:'Не удалось найти вас',blocked:'Доступ к геопозиции закрыт',message:'Выберите место посадки на карте или разрешите доступ в настройках браузера.',pick:'Выбрать на карте',retry:'Повторить запрос',busy:'Определяем…',close:'Закрыть сообщение',settings:'Как разрешить доступ',help:'Откройте настройки сайта рядом с адресом → Геолокация → Разрешить. Затем повторите запрос. Если доступ закрыт для самого браузера, проверьте настройки устройства.'},
 en:{outside:'You are outside Morocco',title:'Could not locate you',blocked:'Location access is blocked',message:'Choose your pickup on the map or allow location in browser settings.',pick:'Choose on map',retry:'Try again',busy:'Locating…',close:'Dismiss',settings:'How to allow location',help:'Open site settings next to the address → Location → Allow. Then try again. If the browser itself is blocked, check device settings.'},
 fr:{outside:'Vous êtes hors du Maroc',title:'Position introuvable',blocked:'Accès à la position bloqué',message:'Choisissez le départ sur la carte ou autorisez la position dans le navigateur.',pick:'Choisir sur la carte',retry:'Réessayer',busy:'Localisation…',close:'Fermer',settings:'Comment autoriser la position',help:'Ouvrez les paramètres du site près de l’adresse → Position → Autoriser. Réessayez ensuite. Si le navigateur est bloqué, vérifiez les paramètres de l’appareil.'},
 ar:{outside:'أنت خارج المغرب',title:'تعذر تحديد موقعك',blocked:'الوصول للموقع محظور',message:'اختر نقطة الانطلاق على الخريطة أو اسمح بالموقع في إعدادات المتصفح.',pick:'اختر على الخريطة',retry:'حاول مجدداً',busy:'جارٍ تحديد الموقع…',close:'إغلاق',settings:'كيفية السماح بالموقع',help:'افتح إعدادات الموقع بجانب العنوان ثم الموقع ثم السماح، وحاول مجدداً. إذا كان المتصفح محظوراً، تحقق من إعدادات الجهاز.'}
}
export default function LocationFeedback({code,iso,busy,onAllow,onClose,onPickMap}:{code:number,iso?:string,busy:boolean,onAllow:()=>void,onClose:()=>void,onPickMap?:()=>void}){
 const lang=(iso||'en').split('-')[0] as keyof typeof copy, labels=serviceText(copy[lang]||copy.en,'location_feedback')
 return <div className="map-location-feedback" role="status" dir={lang==='ar'?'rtl':undefined}>
  <div className="map-location-feedback__heading"><MapPin size={20} aria-hidden="true"/><strong>{code===1?labels.blocked:code===4?labels.outside:labels.title}</strong>
   <button type="button" className="map-location-feedback__close" aria-label={labels.close} onClick={onClose}><X size={18}/></button>
  </div>
  {code!==1&&<p>{locationFailure(code,iso)}</p>}
  <div className="map-location-feedback__actions">
   {onPickMap&&<button type="button" className="map-location-feedback__pick" onClick={onPickMap}>{labels.pick}</button>}
   <button type="button" className="map-location-feedback__allow" disabled={busy} aria-busy={busy} onClick={onAllow}>{busy?labels.busy:labels.retry}</button>
  </div>
  {code===1&&<details><summary>{labels.settings}</summary><p>{labels.message} {labels.help}</p></details>}
 </div>
}
