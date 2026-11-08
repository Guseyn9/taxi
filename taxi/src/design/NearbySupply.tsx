import React from 'react'
import {CarFront, Clock3} from 'lucide-react'
import {t} from '../localization'
import {bookingReadinessCopy} from './bookingReadiness'

/** No live supply endpoint is confirmed. A missing estimate must not be a fake ETA. */
export default function NearbySupply({iso}:{iso?:string}) {
  const label = bookingReadinessCopy(iso).supply
  return <div className="rs-nearby-supply" aria-label={label} title={label}>
    <span><CarFront size={16} aria-hidden="true"/>{t('booking_supply_nearby',{fallback:iso?.startsWith('ru')?'Машины рядом':iso?.startsWith('fr')?'Taxis proches':iso?.startsWith('ar')?'سيارات قريبة':'Nearby taxis'})}: —</span>
    <span><Clock3 size={16} aria-hidden="true"/>{t('booking_supply_eta',{fallback:iso?.startsWith('ru')?'Подача':iso?.startsWith('fr')?'Délai':iso?.startsWith('ar')?'وقت الوصول':'Pickup ETA'})}: —</span>
  </div>
}
