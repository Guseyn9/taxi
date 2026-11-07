import moment from 'moment'

interface RemainingTarget { target: number, raw: number, waiting: unknown }
const remainingLifetimeTargetByOrder = new Map<string, RemainingTarget>()
const REMAINING_TARGET_MAX_ITEMS = 200
const DATE_FORMATS = [
  moment.ISO_8601,
  'YYYY-MM-DD HH:mm:ssZ',
  'YYYY-MM-DD HH:mm:ss Z',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DDTHH:mm:ssZ',
  'YYYY-MM-DDTHH:mm:ss.SSSZ',
]

function cleanupRemainingLifetimeTargets(now: number) {
  if (remainingLifetimeTargetByOrder.size <= REMAINING_TARGET_MAX_ITEMS)
    return

  remainingLifetimeTargetByOrder.forEach(({ target }, key) => {
    if (target < now - 60000)
      remainingLifetimeTargetByOrder.delete(key)
  })

  while (remainingLifetimeTargetByOrder.size > REMAINING_TARGET_MAX_ITEMS) {
    const first = remainingLifetimeTargetByOrder.keys().next().value
    if (!first) break
    remainingLifetimeTargetByOrder.delete(first)
  }
}

export function getTimestamp(value: any): number | null {
  if (!value)
    return null

  const date = parseMomentDate(value)
  return date.isValid() ? date.valueOf() : null
}

export function parseMomentDate(value: any): moment.Moment {
  if (!value)
    return moment.invalid()

  if (moment.isMoment(value))
    return value.isValid() ? value : moment.invalid()

  if (value instanceof Date || typeof value === 'number')
    return moment(value)

  const raw = String(value).trim()
  if (!raw)
    return moment.invalid()

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw)
    if (Number.isFinite(numeric))
      return moment(raw.length === 10 ? numeric * 1000 : numeric)
  }

  const parsed = moment.parseZone(raw, DATE_FORMATS as any, true)
  if (parsed.isValid())
    return parsed

  const normalized = raw.replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)([+-]\d{2}:?\d{2}|Z)?$/,
    (_match, date, time, zone = '') => `${date}T${time}${zone}`,
  )
  const normalizedParsed = moment.parseZone(normalized, DATE_FORMATS as any, true)
  if (normalizedParsed.isValid())
    return normalizedParsed

  return moment(raw as any)
}

export function formatClockSeconds(seconds: number) {
  const safe = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60

  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

export function getStableRemainingLifetimeSeconds(order: any, now: number = Date.now()) {
  cleanupRemainingLifetimeTargets(now)
  if (!order || typeof order.remaining_lifetime_seconds !== 'number')
    return null

  if (!Number.isFinite(order.remaining_lifetime_seconds)) return null
  const rawRemaining = Math.max(0, order.remaining_lifetime_seconds)
  const key = String(order.b_id || order.id || `${order.b_created || ''}_${order.b_start_datetime || ''}`)

  if (!key)
    return rawRemaining

  const receivedTarget = now + rawRemaining * 1000
  const cachedTarget = remainingLifetimeTargetByOrder.get(key)

  // Repeated renders/static polling must not restart the countdown. Every changed
  // server value or waiting interval is accepted, including small extensions after zero.
  if (!cachedTarget || cachedTarget.raw !== rawRemaining || cachedTarget.waiting !== order.b_max_waiting)
    remainingLifetimeTargetByOrder.set(key, { target: receivedTarget, raw: rawRemaining, waiting: order.b_max_waiting })
  const target = remainingLifetimeTargetByOrder.get(key)!.target
  return Math.max(0, (target - now) / 1000)
}
