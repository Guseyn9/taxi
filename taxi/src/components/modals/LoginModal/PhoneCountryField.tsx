import React, {useState} from 'react'
import {Input} from './elements'
import {EInputTypes} from '../../Input'
import {getPhoneMask} from '../../../tools/phoneUtils'
import {authCopy} from './authCopy'

export const PHONE_COUNTRIES = [
  {iso:'MA', prefix:'212', mask:'+212 999 999 999'},
  {iso:'GH', prefix:'233', mask:'+233 99 999 9999'},
  {iso:'RS', prefix:'381', mask:'+381 99 999 9999'},
  {iso:'FR', prefix:'33', mask:'+33 9 99 99 99 99'},
  {iso:'ES', prefix:'34', mask:'+34 999 999 999'},
  {iso:'GB', prefix:'44', mask:'+44 9999 999999'},
  {iso:'US', prefix:'1', mask:'+1 999 999 9999'},
]
export function canonicalPhone(value: string) {
  const stripped = value.replace(/[^\d+]/g, '').replace(/^00/, '+')
  return stripped ? `+${stripped.replace(/\+/g, '')}` : ''
}
export function phoneCountry(value: string) {
  const digits = canonicalPhone(value).slice(1)
  return PHONE_COUNTRIES.find(country => digits.startsWith(country.prefix))
}

/** Display mask only. The existing registration normalizer still owns the API value. */
export function PhoneCountryField({value, onChange, onBlur, name, label, error, language, required=true, disabled=false}: {
  value:string; onChange:(value:string)=>void; onBlur:()=>void; name:string;
  label:string; error?:string; language?:string; required?:boolean; disabled?:boolean;
}) {
  const [prefix, setPrefix] = useState(() => phoneCountry(value || getPhoneMask())?.prefix || '')
  const country = phoneCountry(value) || PHONE_COUNTRIES.find(item => item.prefix === prefix)
  const copy = authCopy(language)
  const countryName = (iso:string) => {
    try {return new (Intl as any).DisplayNames([language || 'en'], {type:'region'}).of(iso)} catch {return iso}
  }
  return <div className="auth-phone-field">
    <label className="auth-phone-country"><span>{copy.country}</span><select
      aria-label={copy.country} value={country?.prefix || ''} disabled={disabled}
      onChange={event => {
        const next = event.target.value
        setPrefix(next)
        // Changing country clears the subscriber part; never silently reassign a number.
        onChange(next ? `+${next}` : '')
      }}>
      {!country && <option value="">+…</option>}
      {PHONE_COUNTRIES.map(item => <option key={item.iso} value={item.prefix}>{countryName(item.iso)} +{item.prefix}</option>)}
    </select></label>
    <Input label={label} error={error} inputType={country ? EInputTypes.MaskedPhone : EInputTypes.Default}
      inputProps={{name, value, required, disabled, autoComplete:'tel', inputMode:'tel',
        mask:country?.mask, maskPlaceholder:null, alwaysShowMask:false,
        placeholder:country?.mask.replace(/9/g, '0') || '+…', onBlur,
        onChange:(event:React.ChangeEvent<HTMLInputElement>) => onChange(canonicalPhone(event.target.value)),
        onPaste:(event:React.ClipboardEvent<HTMLInputElement>) => {
          const pasted = event.clipboardData.getData('text').trim()
          if (/^(\+|00)/.test(pasted)) {
            event.preventDefault()
            const number = canonicalPhone(pasted)
            setPrefix(phoneCountry(number)?.prefix || '')
            onChange(number)
          }
        },
      } as any}/>
  </div>
}
