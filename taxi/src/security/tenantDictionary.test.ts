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
