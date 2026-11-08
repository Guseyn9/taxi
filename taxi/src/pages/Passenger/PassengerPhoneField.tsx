import React, {useState} from 'react'
import Input, {EInputStyles, EInputTypes} from '../../components/Input'
import {getPhoneNumberError} from '../../tools/utils'
import {t, TRANSLATION} from '../../localization'
import {serviceText} from '../../design/serviceText'
import images from '../../constants/images'

export const PASSENGER_SAVED_PHONE_KEY = 'gruzvill_passenger_saved_phone'
const digits = (phone: unknown) => String(phone ?? '').replace(/\D/g, '')
const copy = {
  ru: {storageError: 'Не удалось сохранить телефон на этом устройстве. Разрешите сохранение данных и повторите.'},
  en: {storageError: 'Could not save the phone on this device. Allow local storage and try again.'},
  fr: {storageError: 'Impossible d’enregistrer le téléphone sur cet appareil. Autorisez le stockage et réessayez.'},
  ar: {storageError: 'تعذر حفظ الهاتف على هذا الجهاز. اسمح بالتخزين المحلي وحاول مجدداً.'},
}

/** Save is local and synchronous: only a valid changed value can be saved. */
export default function PassengerPhoneField({phone, profilePhone, onChange, error, iso}: {
  phone: number | null; profilePhone?: string | number | null;
  onChange: (phone: number | null) => void; error?: string | null; iso?: string;
}) {
  const [saved, setSaved] = useState(() => {
    try { return digits(localStorage.getItem(PASSENGER_SAVED_PHONE_KEY) || profilePhone) }
    catch { return digits(profilePhone) }
  })
  const [storageError, setStorageError] = useState(false)
  const value = digits(phone)
  const canSave = !getPhoneNumberError(phone) && value !== saved
  const language = (iso || 'en').split(/[-_]/)[0] as keyof typeof copy
  const labels = serviceText(copy[language] || copy.en, 'passenger_phone')
  return <Input fieldWrapperClassName="passenger-voting-form__input rs-phone-field"
    label={t(TRANSLATION.PHONE)} inputType={EInputTypes.MaskedPhone} style={EInputStyles.RedDesign}
    inputProps={{'aria-label': t(TRANSLATION.PHONE), dir: 'ltr', value: phone ?? '',
      ...({'data-testid': 'passenger-order-phone'} as React.ComponentProps<'input'>)}}
    buttons={[...(profilePhone ? [{src: images.checkMarkRed, title: t(TRANSLATION.PHONE),
      onClick: () => {setStorageError(false); onChange(Number(digits(profilePhone)))}}] : []), {
      text: t(TRANSLATION.SAVE), title: t(TRANSLATION.SAVE), type: 'button',
      className: 'passenger-voting-form__phone-save-button', disabled: !canSave,
      checkLogin: false, fixedSize: false,
      onClick: () => {
        if (!canSave) return
        try {localStorage.setItem(PASSENGER_SAVED_PHONE_KEY, value); setSaved(value); setStorageError(false)}
        catch {setStorageError(true)}
      },
    }]}
    error={storageError ? labels.storageError : error}
    onChange={next => {setStorageError(false); onChange(next as number | null)}}/>
}
