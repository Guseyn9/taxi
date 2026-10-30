jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }))
jest.mock('../config', () => ({ __esModule: true, default: { API_URL: 'https://test.invalid/api/v1' } }))
import axios from 'axios'
import { getPolygonsIdsOnPoint, ZONE_LOOKUP_TIMEOUT_MS } from './polygon'
const get = axios.get as any
const response = (polygons: unknown) => ({ data: { code: '200', status: 'success', data: { data: { map_place_polygons: polygons } } } })
beforeEach(() => get.mockReset())

it('keeps the existing read endpoint and bounds waiting to 10 seconds', async () => {
  get.mockResolvedValue(response({ '79': { var: 'petti_agadir' } }))
  await expect(getPolygonsIdsOnPoint([30.4278, -9.5981])).resolves.toEqual(['79'])
  expect(get).toHaveBeenCalledWith('https://test.invalid/api/v1/data?fields=map_place_polygons&key=30.4278,-9.5981', { timeout: 10000 })
  expect(ZONE_LOOKUP_TIMEOUT_MS).toBe(10000)
})
it.each([{}, []])('accepts a confirmed empty PHP map %j without inventing a zone', async (value: unknown) => {
  get.mockResolvedValue(response(value))
  await expect(getPolygonsIdsOnPoint([31.63, -7.98])).resolves.toEqual([])
})
it.each([null, undefined, '79', ['79'], 79])('rejects an incomplete or malformed zone answer %j', async (value: unknown) => {
  get.mockResolvedValue(response(value))
  await expect(getPolygonsIdsOnPoint([30.42, -9.6])).rejects.toThrow('Invalid zone lookup response')
})
it('does not turn a backend error or timeout into a confirmed empty list', async () => {
  get.mockResolvedValue({ data: { ...response({}).data, code: '503', status: 'error' } })
  await expect(getPolygonsIdsOnPoint([30.42, -9.6])).rejects.toThrow()
  get.mockRejectedValue(new Error('timeout of 10000ms exceeded'))
  await expect(getPolygonsIdsOnPoint([30.42, -9.6])).rejects.toThrow('timeout')
})
it.each([[NaN, 0], [30, Infinity], [91, 0], [0, -181]])('rejects invalid coordinates before any request %j', async (lat: number, lng: number) => {
  await expect(getPolygonsIdsOnPoint([lat, lng])).rejects.toThrow('Invalid zone lookup coordinates')
  expect(get).not.toHaveBeenCalled()
})
