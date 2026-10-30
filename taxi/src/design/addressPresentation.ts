/** Presentation only: original addresses, IDs and coordinates stay in the order. */
type Names = Record<string, unknown>
export function addressLocale(iso?: string): string {
  const value = (iso || 'en').toLowerCase().replace(/_/g, '-')
  if (value.includes('arab')) return 'ar'
  return value.split('-')[0]
}
function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}
function localizedName(names: Names | undefined, iso?: string): string {
  if (!names) return ''
  const locale = addressLocale(iso)
  return clean(names[`name:${locale}`] ?? names[locale])
}
interface Presentation { names?: Names; raw: string }
const placeNames = new Map<string, Presentation>()
function pointKey(lat: unknown, lng: unknown): string | null {
  if (lat == null || lng == null || lat === '' || lng === '') return null
  const a = Number(lat), b = Number(lng)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? `${a.toFixed(5)},${b.toFixed(5)}` : null
}
export function rememberAddressPresentation(place: any): any {
  const key = pointKey(place?.lat, place?.lon)
  if (key && place?.namedetails) {
    placeNames.delete(key)
    placeNames.set(key, {raw: clean(place.display_name), names: place.namedetails})
    if (placeNames.size > 512) placeNames.delete(placeNames.keys().next().value!)
  }
  return place
}
export function displayAddress(value: unknown, iso?: string, lat?: unknown, lng?: unknown): string {
  const raw = clean(value)
  if (!raw || /^(undefined|null)$/i.test(raw)) return ''
  const key = pointKey(lat, lng), cached = key ? placeNames.get(key) : undefined
  const parts = raw.split(/[,،]|\s+·\s+/).map(part => part.trim()).filter(Boolean)
  const name = localizedName(cached?.names, iso)
  // Metadata belongs to the exact first component, not to an arbitrary nearby street.
  const hasLocalizedName = Boolean(name && cached?.raw.split(/[,،]/)[0].trim() === parts[0])
  if (hasLocalizedName) parts[0] = name
  return parts.filter((part, index, all) => all.indexOf(part) === index).join(', ')
}

/** Shorten only after applying structured localization; never truncate the stored source. */
export function displayShortAddress(value: unknown, iso?: string, lat?: unknown, lng?: unknown): string {
  return displayAddress(value, iso, lat, lng).split(',').slice(0, 2).join(',').trim()
}
