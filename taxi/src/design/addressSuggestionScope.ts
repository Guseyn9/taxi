import {ESuggestionType,ISuggestion} from '../types/types'
import {isInMoroccoView} from './maps/morocco'
/** Legacy shared strings are an unlocated Accra list, not Morocco service data.
 * Keep personal history and geocoder points; do not relabel that list as local. */
export function scopeAddressSuggestions(items:ISuggestion[], center?:{latitude?:number;longitude?:number}|null) {
  if (!center || typeof center.latitude !== 'number' || typeof center.longitude !== 'number' || !isInMoroccoView([center.latitude,center.longitude])) return items
  return items.filter(item => item.type !== ESuggestionType.PointUnofficial ||
    (typeof item.point?.latitude === 'number' && Number.isFinite(item.point.latitude) &&
     typeof item.point?.longitude === 'number' && Number.isFinite(item.point.longitude)))
}
