import axios from 'axios'
import { IPolygon } from '../types/polygon'
import Config from '../config'

export const ZONE_LOOKUP_TIMEOUT_MS = 10000

export async function getPolygonsIdsOnPoint(
  [latitude, longitude]: [lat: number, lng: number],
): Promise<IPolygon['id'][]> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    throw new Error('Invalid zone lookup coordinates')
  const key = `${latitude},${longitude}`
  const url = `${Config.API_URL}/data?fields=map_place_polygons&key=${key}`
  const { data } = await axios.get(url, { timeout: ZONE_LOOKUP_TIMEOUT_MS })
  const polygons = data?.data?.data?.map_place_polygons
  // PHP serializes an empty map as []; this is a valid, confirmed empty zone list.
  if (data?.status === 'error' || (data?.code != null && String(data.code) !== '200') ||
      !polygons || typeof polygons !== 'object' || (Array.isArray(polygons) && polygons.length > 0))
    throw new Error('Invalid zone lookup response')
  return Object.keys(polygons)
}
