import {isOfferOrder, isVotingOrder} from '../tools/driverOffer'
import {IOrder} from '../types/types'
import {addressLocale} from './addressPresentation'
const copy = {
  ru: {order:'Такси', voting:'Голосование', offer:'Своя цена', profit:'Расчётная выгода', perKm:'На км подачи', loss:'Возможен убыток', missing:'Нет данных для расчёта', km:'км'},
  en: {order:'Taxi', voting:'Hailing', offer:'Fare offer', profit:'Estimated profit', perKm:'Per pickup km', loss:'Possible loss', missing:'Calculation unavailable', km:'km'},
  fr: {order:'Taxi', voting:'Premier taxi', offer:'Offre de prix', profit:'Gain estimé', perKm:'Par km d’approche', loss:'Perte possible', missing:'Calcul indisponible', km:'km'},
  ar: {order:'تاكسي', voting:'اختيار السائق', offer:'عرض الأجرة', profit:'الربح التقديري', perKm:'لكل كم للوصول', loss:'خسارة محتملة', missing:'الحساب غير متاح', km:'كم'},
}
export function driverOrderCopy(iso?: string) { return copy[addressLocale(iso) as keyof typeof copy] || copy.en }
export function driverOrderMode(order: IOrder): 'order'|'voting'|'offer' {
  return isVotingOrder(order) ? 'voting' : isOfferOrder(order) ? 'offer' : 'order'
}
export function signedProfit(value: unknown, currency: string, iso?: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  try { return new Intl.NumberFormat(addressLocale(iso), {style:'currency', currency, currencyDisplay:'code', maximumFractionDigits:2, signDisplay:'exceptZero'} as Intl.NumberFormatOptions).format(value) }
  catch { return `${value > 0 ? '+' : ''}${value} ${currency}` }
}
