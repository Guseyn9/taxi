import axios from 'axios'
const record = (value: any): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value)
/** Only the existing JSON /data contract is accepted; remote JavaScript is never evaluated. */
export function validateTenantDictionary(response: any) {
  const payload = response?.data
  if (String(response?.code) !== '200' || response?.status !== 'success' || !record(payload) || !record(payload.data)) throw new Error('Invalid tenant dictionary')
  const dictionary = payload.data
  for (const key of ['langs', 'lang_vls', 'site_constants', 'car_classes', 'booking_location_classes'])
    if (!record(dictionary[key])) throw new Error('Incomplete tenant dictionary')
  if (!Object.keys(dictionary.langs).length || !Object.values(dictionary.langs).every((lang: any) => record(lang) && typeof lang.native === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang.iso))) throw new Error('Invalid tenant languages')
  const serialized = JSON.stringify(payload)
  if (serialized.length > 8 * 1024 * 1024) throw new Error('Tenant dictionary exceeds limit')
  let nodes = 0
  const visit = (value: any, depth: number) => {
    if (++nodes > 300000 || depth > 40) throw new Error('Tenant dictionary exceeds complexity limit')
    if (!value || typeof value !== 'object') return
    for (const key of Object.keys(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid tenant dictionary key')
      visit(value[key], depth + 1)
    }
  }
  visit(payload, 0)
  return { dictionary, metadata: {
    version: String(payload.version || ''), default_lang: payload.default_lang,
    default_currency: typeof payload.default_currency === 'string' ? payload.default_currency : '',
    default_country: typeof payload.default_country === 'string' ? payload.default_country : '',
    default_profile: typeof payload.default_profile === 'string' ? payload.default_profile : '',
  } }
}
export async function loadTenantDictionary(apiUrl: string) {
  const response = await axios.get(`${apiUrl}/data`, { timeout: 15000, responseType: 'json' })
  return validateTenantDictionary(response.data)
}
