import axios from 'axios'
import { writeRawLog } from '../tools/rawLog'
const record = (value: any): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value)
const transientHttpStatuses = [408, 500, 502, 503, 504]
const timeoutCodes = ['ECONNABORTED', 'ETIMEDOUT']
const codeNumber = (value: unknown): number | undefined =>
  (typeof value === 'number' || typeof value === 'string') && /^[1-5]\d{2}$/.test(String(value)) ? Number(value) : undefined

function transportFailure(error: unknown) {
  const code = record(error) ? error.code : undefined
  const response = record(error) && record(error.response) ? error.response : undefined
  const httpStatus = codeNumber(response?.status)
  const serviceCode = record(response?.data) ? codeNumber(response.data.code) : undefined
  if (response) return { reason: 'http_error', httpStatus, serviceCode, retry: httpStatus !== undefined && transientHttpStatuses.includes(httpStatus) }
  if (timeoutCodes.includes(code)) return { reason: 'timeout', retry: true }
  return { reason: 'transport_error', retry: code === 'ERR_NETWORK' }
}
/** Only the existing JSON /data contract is accepted; remote JavaScript is never evaluated. */
export function validateTenantDictionary(response: any) {
  const payload = response?.data
  if (String(response?.code) !== '200' || response?.status !== 'success' || !record(payload) || !record(payload.data)) throw new Error('Invalid tenant dictionary')
  const dictionary = payload.data
  for (const key of ['langs', 'lang_vls', 'site_constants', 'booking_location_classes'])
    if (!record(dictionary[key])) throw new Error('Incomplete tenant dictionary')
  const carClasses = dictionary.car_classes
  // PHP encodes a class map with keys 0..n as a JSON array. Keep each index as its class ID.
  if ((!record(carClasses) && !Array.isArray(carClasses)) ||
      !Object.keys(carClasses).length || !Object.values(carClasses).every(record))
    throw new Error('Incomplete tenant dictionary')
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
  const normalized = Array.isArray(carClasses) ? { ...dictionary, car_classes: { ...carClasses } } : dictionary
  return { dictionary: normalized, metadata: {
    version: String(payload.version || ''), default_lang: payload.default_lang,
    default_currency: typeof payload.default_currency === 'string' ? payload.default_currency : '',
    default_country: typeof payload.default_country === 'string' ? payload.default_country : '',
    default_profile: typeof payload.default_profile === 'string' ? payload.default_profile : '',
  } }
}
export async function loadTenantDictionary(apiUrl: string, signal?: AbortSignal) {
  const read = async(attempt: number) => {
    const started = Date.now()
    const options = { timeout: 10000, responseType: 'json' as const, ...(signal && {signal}) }
    const response = await axios.get(`${apiUrl}/data`, options).catch((error: unknown) => {
      if (!signal?.aborted) {
        const { reason, httpStatus, serviceCode } = transportFailure(error)
        writeRawLog('TENANT_DICTIONARY_READ_FAILURE', { method: 'GET', endpoint: '/data', attempt, reason, httpStatus, serviceCode, durationMs: Date.now() - started })
      }
      throw error
    })
    try {
      return validateTenantDictionary(response.data)
    } catch (error) {
      const serviceCode = record(response.data) ? codeNumber(response.data.code) : undefined
      const reason = serviceCode && serviceCode !== 200 ? 'service_error' : 'invalid_dictionary'
      writeRawLog('TENANT_DICTIONARY_READ_FAILURE', { method: 'GET', endpoint: '/data', attempt, reason, httpStatus: codeNumber(response.status), serviceCode, durationMs: Date.now() - started })
      throw error
    }
  }

  try {
    return await read(1)
  } catch (error) {
    if (signal?.aborted || !transportFailure(error).retry) throw error
    await new Promise(resolve => setTimeout(resolve, 350))
    if (signal?.aborted) throw error
    return read(2)
  }
}
