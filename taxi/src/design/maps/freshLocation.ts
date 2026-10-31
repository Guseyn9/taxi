/** Explicit location actions always ask the browser for a fresh fix, never a saved point. */
export function requestFreshLocation(geo: Pick<Geolocation,'getCurrentPosition'>, success: PositionCallback, error: PositionErrorCallback) {
  geo.getCurrentPosition(success,error,{enableHighAccuracy:true,timeout:10000,maximumAge:0})
}
/** Startup preflight never loops a remembered denial. User retries remain explicit. */
export function requestInitialLocation(permissions:Pick<Permissions,'query'>|undefined,locate:()=>void,denied:()=>void) {
 let cancelled=false
 const start=()=>{if(!cancelled)locate()}
 try {
  if(permissions?.query)permissions.query({name:'geolocation'}).then(status=>{
   if(cancelled)return
   if(status.state==='denied')denied()
   else start()
  }).catch(start)
  else start()
 } catch {start()}
 return ()=>{cancelled=true}
}
export function locationFailure(code:number,iso?:string) {
 const lang=(iso||'en').split('-')[0]
 if(code===4){const outside:Record<string,string>={ru:'Сервис работает в Марокко. Выберите место посадки на карте.',en:'The service operates in Morocco. Choose your pickup on the map.',fr:'Le service est disponible au Maroc. Choisissez le départ sur la carte.',ar:'الخدمة متاحة في المغرب. اختر نقطة الانطلاق على الخريطة.'};return outside[lang]||outside.en}
 const messages:Record<string,string[]>={
  ru:['Местоположение недоступно. Выберите точку на карте.','Доступ к геопозиции запрещён. Разрешите его в настройках браузера или выберите точку на карте.','Не удалось определить местоположение. Повторите запрос или выберите точку на карте.','GPS не ответил вовремя. Повторите запрос или выберите точку на карте.'],
  en:['Location unavailable. Choose a point on the map.','Location access is blocked. Allow it in browser settings or choose a point on the map.','Could not locate you. Retry or choose a point on the map.','Location timed out. Retry or choose a point on the map.'],
  fr:['Position indisponible. Choisissez un point sur la carte.','Accès à la position bloqué. Autorisez-le dans le navigateur ou utilisez la carte.','Position introuvable. Réessayez ou utilisez la carte.','Délai GPS dépassé. Réessayez ou utilisez la carte.'],
  ar:['الموقع غير متاح. اختر نقطة على الخريطة.','الوصول للموقع محظور. اسمح به في المتصفح أو اختر نقطة على الخريطة.','تعذر تحديد الموقع. حاول مجدداً أو استخدم الخريطة.','انتهت مهلة الموقع. حاول مجدداً أو استخدم الخريطة.']}
 return (messages[lang]||messages.en)[code>=1&&code<=3?code:0]
}
