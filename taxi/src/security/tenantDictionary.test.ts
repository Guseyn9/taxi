import axios from 'axios'
import { loadTenantDictionary, validateTenantDictionary } from './tenantDictionary'
jest.mock('axios', () => ({get:jest.fn()}))
const valid = () => ({code:'200',status:'success',data:{version:'v1',default_currency:'MAD',data:{langs:{1:{iso:'ary-Arab',native:'Darija'}},lang_vls:{hello:{1:'Hello'}},site_constants:{},car_classes:{},booking_location_classes:{}}}})
it('loads the existing JSON endpoint and publishes only dictionary/whitelisted metadata', async () => {
  ;(axios.get as any).mockResolvedValue({data:{...valid(),injected:'ignored'}})
  const result = await loadTenantDictionary('https://example.invalid/c/gruzvill/api/v1')
  expect(axios.get).toHaveBeenCalledWith('https://example.invalid/c/gruzvill/api/v1/data',{timeout:15000,responseType:'json'})
  expect(result.dictionary.langs[1].iso).toBe('ary-Arab')
  expect(result.metadata.default_currency).toBe('MAD')
  expect(result).not.toHaveProperty('injected')
})
it.each(['var data = {}; alert(1)', {code:404}, {code:200,status:'error',data:{}}, {code:200,status:'success',data:{data:{}}}])('rejects executable, error and incomplete envelopes', (value: any) => {
  expect(() => validateTenantDictionary(value)).toThrow()
})
it('rejects prototype-bearing or invalid-language dictionaries', () => {
  const input:any = valid();input.data.data.langs[1].iso='javascript:alert(1)'
  expect(() => validateTenantDictionary(input)).toThrow()
  // An own prototype-mutating key cannot enter through JSON parsing either.
  expect(() => validateTenantDictionary(JSON.parse(JSON.stringify(valid()).replace('"lang_vls":','"__proto__":{},"lang_vls":')))).toThrow()
  expect(({} as any).polluted).toBeUndefined()
})

it('normalizes the archived Core car-class array without renumbering its classes', () => {
  const input = valid()
  const classes = [{en: 'Any'}, {en: 'Economy'}, {en: 'Comfort'}]
  input.data.data.car_classes = classes

  const result = validateTenantDictionary(JSON.parse(JSON.stringify(input)))

  expect(result.dictionary.car_classes).toEqual({0: classes[0], 1: classes[1], 2: classes[2]})
  expect(Array.isArray(result.dictionary.car_classes)).toBe(false)
})

it('continues to reject malformed class arrays and arrays for other dictionary fields', () => {
  const input = valid()
  input.data.data.car_classes = [null]
  expect(() => validateTenantDictionary(input)).toThrow('Incomplete tenant dictionary')

  const withMissingConstants = valid()
  withMissingConstants.data.data.site_constants = []
  expect(() => validateTenantDictionary(withMissingConstants)).toThrow('Incomplete tenant dictionary')
})
