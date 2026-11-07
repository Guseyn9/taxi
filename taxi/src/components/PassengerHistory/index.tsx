import React, { useEffect, useState } from 'react'
import { EOrderTypes, IOrder } from '../../types/types'
import { backendGateway } from '../../platform/adapters/LegacyBackendGateway'
import { terminalBooking } from '../../design/reliability/rideData'
import { sessionGeneration } from '../../security/sessionLifecycle'
import Overlay from '../modals/Overlay'
import './styles.css'

const words: Record<string, string[]> = {
  ru: ['История поездок', 'Загружаем поездки…', 'Завершённых поездок пока нет.', 'Не удалось загрузить историю.', 'Повторить', 'Поездка'],
  en: ['Trip history', 'Loading trips…', 'No past trips yet.', 'Could not load trip history.', 'Try again', 'Trip'],
  fr: ['Historique des trajets', 'Chargement des trajets…', 'Aucun trajet passé.', 'Impossible de charger les trajets.', 'Réessayer', 'Trajet'],
  es: ['Historial de viajes', 'Cargando viajes…', 'Todavía no hay viajes anteriores.', 'No se pudo cargar el historial.', 'Reintentar', 'Viaje'],
  ar: ['سجل الرحلات', 'جار تحميل الرحلات…', 'لا توجد رحلات سابقة.', 'تعذر تحميل سجل الرحلات.', 'إعادة المحاولة', 'رحلة'],
}
export function passengerHistoryCopy(iso?: string) {
  const key = iso?.includes('Arab') || iso === 'ar' ? 'ar' : iso?.split('-')[0] || 'en'
  const [title, loading, empty, error, retry, trip] = words[key] || words.en
  return { title, loading, empty, error, retry, trip }
}

/** Defence in depth for display; the archive endpoint must still enforce ownership. */
export function ownPastTrips(orders: IOrder[], owner: string): IOrder[] {
  return orders.filter(order => String(order.u_id) === owner && terminalBooking(order))
}

export default function PassengerHistory({ owner, iso, onClose }: { owner: string, iso?: string, onClose: () => void }) {
  const copy = passengerHistoryCopy(iso)
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<{ owner: string, orders?: IOrder[], failed?: boolean }>({ owner })
  useEffect(() => {
    let current = true
    const generation = sessionGeneration()
    setState({ owner })
    backendGateway.getOrders(EOrderTypes.History).then(response => {
      if (!Array.isArray((response.data as any)?.booking)) throw new Error('Invalid archive response')
      if (current && generation === sessionGeneration()) setState({ owner, orders: ownPastTrips((response.data as any).booking, owner) })
    }).catch(() => {
      if (current && generation === sessionGeneration()) setState({ owner, failed: true })
    })
    return () => { current = false }
  }, [owner, reload])
  const displayed = state.owner === owner ? state : { owner }
  return <Overlay isOpen onClick={onClose} wrapperClassName="passenger-history-overlay">
    <section className="passenger-history modal">
      <h2>{copy.title}</h2>
      {displayed.failed ? <div role="alert"><p>{copy.error}</p><button type="button" onClick={() => setReload(value => value + 1)}>{copy.retry}</button></div> :
        !displayed.orders ? <p role="status">{copy.loading}</p> : !displayed.orders.length ? <p>{copy.empty}</p> :
          <ol>{displayed.orders.map(order => <li key={order.b_id}>
            <strong>{copy.trip} #{order.b_id}</strong>
            <p>{order.b_start_address || '—'} → {order.b_destination_address || '—'}</p>
          </li>)}</ol>}
    </section>
  </Overlay>
}
