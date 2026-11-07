import {serviceText} from '../../../design/serviceText'
export function authCopy(iso?: string) {
  const all = {
    ru: {country:'Страна телефона', unavailable:'Пока недоступно'},
    en: {country:'Phone country', unavailable:'Unavailable'},
    fr: {country:'Pays du téléphone', unavailable:'Indisponible'},
    ar: {country:'بلد الهاتف', unavailable:'غير متاح'},
  }
  const locale = (iso || 'en').split('-')[0] as keyof typeof all
  return serviceText(all[locale] || all.en, 'auth_ui')
}
