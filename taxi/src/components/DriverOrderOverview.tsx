import {displayFare,orderCurrency} from '../design/reliability/rideData'
import React from 'react'
import { EBookingDriverState, EBookingStates, IOrder, IUser } from '../types/types'
import SITE_CONSTANTS, { CURRENCY } from '../siteConstants'
import { getPayment } from '../tools/utils'
import { t, TRANSLATION } from '../localization'
import { isOfferOrder, isVotingOrder } from '../tools/driverOffer'
import {displayShortAddress} from '../design/addressPresentation'
import {driverOrderCopy, driverOrderMode, signedProfit} from '../design/driverOrderPresentation'

const labels = {
  en: ['New request', 'Choose a driver', 'Fare offer', 'Waiting for passenger', 'On the way to pickup', 'At pickup', 'Trip in progress', 'Completed', 'Cancelled'],
  ru: ['Новый заказ', 'Выбор водителя', 'Предложение цены', 'Ожидание пассажира', 'Еду к пассажиру', 'На месте подачи', 'Поездка началась', 'Завершён', 'Отменён'],
  fr: ['Nouvelle demande', 'Choix du chauffeur', 'Offre de prix', 'En attente du passager', 'En route vers le départ', 'Au point de départ', 'Trajet en cours', 'Terminé', 'Annulé'],
  ar: ['طلب جديد', 'اختيار السائق', 'عرض الأجرة', 'في انتظار الراكب', 'في الطريق لنقطة الانطلاق', 'في نقطة الانطلاق', 'الرحلة جارية', 'مكتملة', 'ملغاة'],
}

export function driverOrderStatusIndex(order: IOrder, user?: IUser) {
  if (order.b_completed || order.b_state === EBookingStates.Completed) return 7
  if (order.b_canceled || order.b_state === EBookingStates.Canceled) return 8
  const driver = order.drivers?.find(item => item.u_id === user?.u_id)
  if (driver?.c_state === EBookingDriverState.Finished) return 7
  if (driver?.c_state === EBookingDriverState.Canceled) return 8
  if (driver?.c_state === EBookingDriverState.Started) return 6
  if (driver?.c_state === EBookingDriverState.Arrived) return 5
  if (driver?.c_state === EBookingDriverState.Performer) return 4
  if (driver?.c_state === EBookingDriverState.Considering) return 3
  if (isVotingOrder(order)) return 1
  if (isOfferOrder(order)) return 2
  return 0
}

function addressText(value?: unknown) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  return /^(undefined|null)(,\s*(undefined|null))?$/i.test(text) ? '' : text
}

export default function DriverOrderOverview({ order, user, iso, from, to }: {
  order: IOrder; user: IUser; iso?: string; from?: string; to?: string;
}) {
  const language = (iso || '').toLowerCase()
  const base = language.split('-')[0]
  const words = language.includes('arab') ? labels.ar : labels[base as keyof typeof labels] || labels.en
  const status = driverOrderStatusIndex(order, user)
  const copy = driverOrderCopy(iso), mode = driverOrderMode(order)
  const payment=getPayment(order)
  const currency = orderCurrency(order,CURRENCY.NAME)
  const hasProfit = typeof order.profit === 'number' && Number.isFinite(order.profit)
  const hasRelativeProfit = typeof order.profitPerEmptyKm === 'number' && Number.isFinite(order.profitPerEmptyKm)
  const carClass = SITE_CONSTANTS.CAR_CLASSES[order.b_car_class]
  const carClassName = carClass ? t(TRANSLATION.CAR_CLASSES[order.b_car_class]).replace(/petti/ig, 'PETIT') : ''
  const pickup = addressText(order.b_start_address) || addressText((order.b_options as any)?.fromShortAddress) || addressText(from).split(',').slice(0,2).join(',') || addressText(order.b_start_address).split(',').slice(0,2).join(',') || t(TRANSLATION.ADDRESS_NOT_SPECIFIED)
  const destination = addressText(order.b_destination_address) || addressText((order.b_options as any)?.toShortAddress) || addressText(to).split(',').slice(0,2).join(',') || addressText(order.b_destination_address).split(',').slice(0,2).join(',') || t(TRANSLATION.ADDRESS_NOT_SPECIFIED)

  return <div className="driver-order-overview">
    <div className="driver-order-overview__top">
      <span className="driver-order-overview__id">№{String(order.b_id)}</span>
      <span className="driver-order-overview__price">{displayFare(payment.value,orderCurrency(order,CURRENCY.NAME),iso,payment.estimated)}</span>
    </div>
    <div className="driver-order-overview__meta">
      <span className={`driver-order-overview__mode driver-order-overview__mode--${mode}`}>{copy[mode]}</span>
      <span className={`driver-order-overview__status driver-order-overview__status--${status}`}>{words[status < 3 ? 0 : status]}</span>
      {carClassName && <span className="driver-order-overview__class">{carClassName}</span>}
    </div>
    <div className="driver-order-overview__route">
      <div><i aria-hidden="true" /><p><small>{t(TRANSLATION.FROM)}</small><span dir="auto" title={order.b_start_address}>{displayShortAddress(pickup,iso,order.b_start_latitude,order.b_start_longitude)}</span></p></div>
      <div><i aria-hidden="true" /><p><small>{t(TRANSLATION.TO)}</small><span dir="auto" title={order.b_destination_address}>{displayShortAddress(destination,iso,order.b_destination_latitude,order.b_destination_longitude)}</span></p></div>
    </div>
    <dl className="driver-order-overview__profit" data-loss={hasProfit && order.profit! < 0}>
      <div><dt>{copy.profit}</dt><dd dir="auto">{signedProfit(order.profit,currency,iso)}</dd></div>
      <div><dt>{copy.perKm}</dt><dd dir="auto">{hasRelativeProfit ? `${signedProfit(order.profitPerEmptyKm,currency,iso)} / ${copy.km}` : '—'}</dd></div>
    </dl>
    {!hasProfit && <small className="driver-order-overview__profit-note">{copy.missing}</small>}
    {hasProfit && order.profit! < 0 && <small className="driver-order-overview__profit-note">{copy.loss}</small>}
  </div>
}
