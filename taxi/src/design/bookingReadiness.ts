import {serviceText} from './serviceText'
import {hasZoneCoordinates} from './reliability/zoneCheck'
import type {IAddressPoint} from '../types/types'
import type {ZoneCheckStatus} from '../state/clientOrder/constants'

export type BookingBlock = 'pickup'|'destination'|'addressLoading'|'zoneError'|'zonesLoading'|'noClass'|'phone'|'pending'|null
export function bookingBlock(facts: {
  from:IAddressPoint|null; to:IAddressPoint|null; fromZoneStatus:ZoneCheckStatus; toZoneStatus:ZoneCheckStatus;
  zonesReady:boolean; hasClass:boolean; phoneValid:boolean; pending:boolean;
}):BookingBlock {
  if (facts.pending) return 'pending'
  if (!hasZoneCoordinates(facts.from)) return 'pickup'
  if (!hasZoneCoordinates(facts.to)) return 'destination'
  if (facts.from?.isAddressResolving || facts.to?.isAddressResolving) return 'addressLoading'
  if (facts.fromZoneStatus === 'error' || facts.toZoneStatus === 'error') return 'zoneError'
  if (!facts.zonesReady) return 'zonesLoading'
  if (!facts.hasClass) return 'noClass'
  if (!facts.phoneValid) return 'phone'
  return null
}
export function bookingReadinessCopy(iso='en') {
  const all = {
    en:{pickup:'Confirm the pickup from suggestions or on the map.',destination:'Confirm the destination from suggestions or on the map.',addressLoading:'Resolving the selected address…',zoneError:'Zone check failed. Retry the address check above.',zonesLoading:'Checking the route zones…',noClass:'No available vehicle class for this route.',phone:'Add a valid phone number in trip options.',pending:'Sending your request…',editPhone:'Add phone',supply:'Nearby taxis and pickup estimate: unavailable'},
    ru:{pickup:'Подтвердите место посадки из подсказок или на карте.',destination:'Подтвердите назначение из подсказок или на карте.',addressLoading:'Уточняем выбранный адрес…',zoneError:'Не удалось проверить зону. Повторите проверку адреса выше.',zonesLoading:'Проверяем зоны маршрута…',noClass:'Для маршрута нет доступного класса машины.',phone:'Укажите корректный телефон в параметрах поездки.',pending:'Отправляем заказ…',editPhone:'Указать телефон',supply:'Машины рядом и время подачи: данных пока нет'},
    fr:{pickup:'Confirmez le départ dans les résultats ou sur la carte.',destination:'Confirmez la destination dans les résultats ou sur la carte.',addressLoading:'Recherche de l’adresse sélectionnée…',zoneError:'Échec du contrôle de zone. Réessayez ci-dessus.',zonesLoading:'Vérification des zones du trajet…',noClass:'Aucune catégorie disponible pour ce trajet.',phone:'Ajoutez un numéro valide dans les options.',pending:'Envoi de la demande…',editPhone:'Ajouter le téléphone',supply:'Taxis à proximité et délai : données indisponibles'},
    ar:{pickup:'أكد نقطة الانطلاق من النتائج أو على الخريطة.',destination:'أكد الوجهة من النتائج أو على الخريطة.',addressLoading:'جارٍ تحديد العنوان…',zoneError:'فشل التحقق من المنطقة. أعد المحاولة أعلاه.',zonesLoading:'جارٍ التحقق من مناطق المسار…',noClass:'لا توجد فئة متاحة لهذا المسار.',phone:'أدخل رقم هاتف صالحاً في خيارات الرحلة.',pending:'جارٍ إرسال الطلب…',editPhone:'إضافة هاتف',supply:'سيارات قريبة ووقت الوصول: لا تتوفر بيانات'},
  }
  return serviceText(all[iso.split('-')[0] as keyof typeof all] || all.en,'booking_readiness')
}
