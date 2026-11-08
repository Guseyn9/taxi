/** Frontend safeguards only. The server remains authoritative for fares, roles and boarding. */
function object(value:any):any {
  if(typeof value==='string'){try{return object(JSON.parse(value))}catch{return {}}}
  return value && typeof value==='object' && !Array.isArray(value)?value:{}
}
function text(value:any):string {
  if(Array.isArray(value))return text(value[0])
  return value!==undefined && value!==null && String(value).trim()?String(value).trim():''
}
export function serverPickupEta(driver:any):string {
  const options=object(driver?.c_options),data=object(driver?.c_data ?? driver?.data)
  const offer=object(options.driver_offer ?? options.offer ?? driver?.driver_offer ?? driver?.offer)
  for(const value of [driver?.c_pickup_time,data.c_pickup_time,options.c_pickup_time,driver?.driver_offer_eta,options.driver_offer_eta,data.driver_offer_eta,offer.eta,offer.pickup_time,driver?.pickup_time,options.pickup_time,driver?.eta,options.eta]){
    const result=text(value);if(result)return result
  }
  return ''
}
export function validOfferPrice(value:unknown):boolean {
  return value!=='' && Number.isFinite(Number(value)) && Number(value)>0
}
export function orderMatchesCar(order:any,car:any):boolean {
  const required=order?.b_car_class ?? order?.b_car_class_id ?? order?.cc_id
  const actual=car?.cc_id ?? car?.c_class_id ?? car?.car_class_id
  // Missing metadata is not evidence of incompatibility. The backend still validates taking.
  // Legacy API reserves 0 for an unrestricted request (the service's “Any”
  // class). It is not a specific vehicle class, and /drive/now returns it to
  // drivers of concrete classes. A driver's own class 0 is not a wildcard.
  return required==null || required==='' || String(required)==='0' || actual==null || actual==='' || String(required)===String(actual)
}
const messages={
  ru:{offerMode:'Сервер не сохранил тип «Своя цена». Созданный заказ отменён. Используйте обычный заказ или выбор водителя.',offerUnverified:'Заказ создан, но тип «Своя цена» не подтверждён сервером. Не отправляйте повторно: проверьте текущий заказ или отмените его.',offerPrice:'Укажите цену предложения больше нуля.',fixedOffer:'Цена предложения зафиксирована при отправке. Выберите предложение водителя; изменение этой суммы здесь недоступно.',config:'Настройки сервера не соответствуют Марокко. Валюта и формат телефона показаны как на сервере; перед пилотом их должен настроить разработчик.'},
  en:{offerMode:'The server did not preserve Offer mode. The created order was canceled. Use a standard order or choose a driver.',offerUnverified:'Order created, but Offer mode was not confirmed. Do not submit again: check or cancel the current order.',offerPrice:'Enter a fare greater than zero.',fixedOffer:'The offered fare is fixed after sending. Choose a driver’s offer; editing this amount is unavailable here.',config:'Server settings do not match Morocco. Currency and phone format reflect the server; they need developer configuration before the pilot.'},
  fr:{offerMode:'Le serveur n’a pas conservé le mode Offre. La commande a été annulée. Utilisez une commande standard ou choisissez un chauffeur.',offerUnverified:'Commande créée, mais le mode Offre n’est pas confirmé. Ne renvoyez pas la demande ; vérifiez ou annulez la commande.',offerPrice:'Indiquez un prix supérieur à zéro.',fixedOffer:'Le prix proposé est fixé après l’envoi. Choisissez une offre du chauffeur ; ce montant ne peut pas être modifié ici.',config:'Les paramètres du serveur ne correspondent pas au Maroc. La devise et le téléphone reflètent le serveur et doivent être configurés avant le pilote.'},
  ar:{offerMode:'لم يحفظ الخادم نوع العرض. تم إلغاء طلب الاختبار. استخدم الطلب العادي أو اختر السائق.',offerUnverified:'تم إنشاء الطلب لكن نوع العرض غير مؤكد. لا ترسل طلباً آخر؛ تحقق من الطلب الحالي أو ألغِه.',offerPrice:'أدخل أجرة أكبر من صفر.',fixedOffer:'تم تثبيت الأجرة بعد الإرسال. اختر عرض السائق؛ تعديل هذا المبلغ غير متاح هنا.',config:'إعدادات الخادم لا تطابق المغرب. العملة والهاتف كما في الخادم ويجب ضبطهما قبل التجربة.'},
}
export function pilotCopy(iso?:string){return messages[(iso||'en').split('-')[0] as keyof typeof messages]||messages.en}

export function moroccoConfigMismatch(currency:string,phoneMask:string):boolean {
  return !['MAD','DH','DHS'].includes(String(currency).trim().toUpperCase()) || !String(phoneMask).startsWith('+212')
}
