import axios from 'axios'
import { writeRawLog } from '../tools/rawLog'
import { loadTenantDictionary, validateTenantDictionary } from './tenantDictionary'
jest.mock('axios', () => ({get:jest.fn()}))
jest.mock('../tools/rawLog', () => ({writeRawLog:jest.fn()}))
const valid = (carClasses: unknown = {1: {seats: '4', booking_location_classes: null}}) => ({
  code: '200',
  status: 'success',
  data: {
    version: 'v1',
    default_currency: 'MAD',
    data: {
      langs: {1: {iso: 'ary-Arab', native: 'Darija'}},
      lang_vls: {hello: {1: 'Hello'}},
      site_constants: {},
      car_classes: carClasses,
      booking_location_classes: {},
    },
  },
})
const get = axios.get as any
const apiUrl = 'https://example.invalid/c/gruzvill/api/v1'
beforeEach(() => jest.clearAllMocks())
it('loads the existing JSON endpoint and publishes only dictionary/whitelisted metadata', async () => {
  ;(axios.get as any).mockResolvedValue({data:{...valid(),injected:'ignored'}})
  const result = await loadTenantDictionary('https://example.invalid/c/gruzvill/api/v1')
  expect(axios.get).toHaveBeenCalledWith(`${apiUrl}/data`, {timeout:10000,responseType:'json'})
  expect(result.dictionary.langs[1].iso).toBe('ary-Arab')
  expect(result.metadata.default_currency).toBe('MAD')
  expect(result).not.toHaveProperty('injected')
})

it.each([
  [{code: 'ERR_NETWORK'}, 'transport_error'],
  [{code: 'ECONNABORTED'}, 'timeout'],
  [{response: {status: 503, data: {code: '503', message: 'omitted service text'}}}, 'http_error'],
])('retries a transient dictionary failure once and publishes the recovered dictionary', async(error: unknown, reason: string) => {
  get.mockRejectedValueOnce(error).mockResolvedValueOnce({data: valid(), status: 200})

  await expect(loadTenantDictionary(apiUrl)).resolves.toMatchObject({metadata: {version:'v1'}})
  expect(get).toHaveBeenCalledTimes(2)
  expect(writeRawLog).toHaveBeenCalledWith('TENANT_DICTIONARY_READ_FAILURE', expect.objectContaining({attempt:1, endpoint:'/data', reason}))
  expect(JSON.stringify((writeRawLog as any).mock.calls)).not.toContain('omitted service text')
})

it('exhausts the automatic retry after two transient failures', async() => {
  const failure = {response: {status: 504}}
  get.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure)
  await expect(loadTenantDictionary(apiUrl)).rejects.toBe(failure)
  expect(get).toHaveBeenCalledTimes(2)
})

it('rejects an invalid successful response without retry or logging its contents', async() => {
  get.mockResolvedValueOnce({data: {code: '200', status: 'success', data: {secret: 'sample private value'}}, status: 200})
  await expect(loadTenantDictionary(apiUrl)).rejects.toThrow('Invalid tenant dictionary')
  expect(get).toHaveBeenCalledTimes(1)
  expect(writeRawLog).toHaveBeenCalledWith('TENANT_DICTIONARY_READ_FAILURE', expect.objectContaining({attempt:1, httpStatus:200, reason:'invalid_dictionary'}))
  expect(JSON.stringify((writeRawLog as any).mock.calls)).not.toContain('sample private value')
})

it('aborts the pending retry when the tenant read has been superseded', async() => {
  const controller = new AbortController()
  const failure = {code: 'ERR_NETWORK'}
  get.mockRejectedValueOnce(failure)
  const loading = loadTenantDictionary(apiUrl, controller.signal)
  setTimeout(() => controller.abort(), 10)

  await expect(loading).rejects.toBe(failure)
  expect(get).toHaveBeenCalledTimes(1)
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
  const classes = [{en: 'Any'}, {en: 'Economy'}, {en: 'Comfort'}]

  const result = validateTenantDictionary(JSON.parse(JSON.stringify(valid(classes))))

  expect(result.dictionary.car_classes).toEqual({0: classes[0], 1: classes[1], 2: classes[2]})
  expect(Array.isArray(result.dictionary.car_classes)).toBe(false)
})

it('continues to reject malformed class arrays and arrays for other dictionary fields', () => {
  expect(() => validateTenantDictionary(valid([null]))).toThrow('Incomplete tenant dictionary')

  const withMissingConstants = valid()
  withMissingConstants.data.data.site_constants = []
  expect(() => validateTenantDictionary(withMissingConstants)).toThrow('Incomplete tenant dictionary')
})

it.each([{}, [], {1: null}])('rejects a dictionary without usable car class records', (classes: unknown) => {
  expect(() => validateTenantDictionary(valid(classes))).toThrow('Incomplete tenant dictionary')
})
