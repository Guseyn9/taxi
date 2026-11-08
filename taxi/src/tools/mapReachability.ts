// Map / Navigation Adapter (слой 2 в архитектуре генерации заказов).
// -------------------------------------------------------------------
// Единственная задача этого модуля — отвечать на вопросы о дороге, НЕ принимая
// бизнес-решений. Генератор заказов спрашивает: «эта точка доступна?» / «привяжи
// её к дороге», а адаптер отвечает через OSRM `/nearest` (тот же публичный сервис,
// что уже используется для построения маршрутов). Кто и когда снапит/регенерирует —
// решает вызывающая сторона (Order Generator), а не адаптер.
//
// Всё «best-effort»: если OSRM недоступен/тормозит, адаптер не блокирует генерацию —
// он возвращает null (снап невозможен) или true (не мешаем создавать заказ). Демо
// не должно вставать из-за внешнего сервиса.

export interface IReachablePoint {
  latitude: number
  longitude: number
}

export interface ISnapResult {
  latitude: number
  longitude: number
  // Расстояние (в метрах) от исходной точки до ближайшей дороги. Большое значение
  // означает, что точка стоит в стороне от дорог (парк, двор, водоём).
  roadDistanceMeters: number
  source: 'osrm'
}

export interface IEnsureReachableResult<T extends IReachablePoint> {
  point: T
  roadDistanceMeters: number | null
  snapped: boolean
  attempts: number
  // reachable — точка сразу оказалась у дороги; snapped — привязали к ближайшей
  // дороге после неудачных регенераций; fallback — OSRM недоступен, отдали как есть.
  source: 'reachable' | 'snapped' | 'fallback'
}

const OSRM_NEAREST_BASE = 'https://router.project-osrm.org/nearest/v1/driving'
// Если дорога в пределах этого радиуса — считаем точку доступной без изменений.
export const REACHABLE_ROAD_METERS = 25
const DEFAULT_MAX_ATTEMPTS = 4
const REQUEST_TIMEOUT_MS = 6000
const SUCCESS_CACHE_MS = 15 * 60 * 1000
const FAILURE_CACHE_MS = 5000
const MAX_CACHE_ENTRIES = 256
const MAX_PENDING_REQUESTS = 16

interface INearestCacheEntry {
  value: ISnapResult | null
  expiresAt: number
}
// Per-tab, bounded LRU. A short negative TTL prevents a transient outage becoming
// a permanent miss; successful road geometry may be reused for fifteen minutes.
const nearestCache = new Map<string, INearestCacheEntry>()
const pendingRequests = new Map<string, Promise<ISnapResult | null>>()
let activeProviderReads = 0
const monotonicNow = () => typeof performance !== 'undefined' ? performance.now() : Date.now()
const copyResult = (result: ISnapResult | null): ISnapResult | null => result ? { ...result } : null

function numericValue(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizePoint(point: IReachablePoint | null | undefined): IReachablePoint | null {
  const latitude = numericValue(point?.latitude), longitude = numericValue(point?.longitude)
  return latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ?
    { latitude, longitude } :
    null
}

function cacheKey(point: IReachablePoint): string {
  return `${Number(point.latitude).toFixed(6)},${Number(point.longitude).toFixed(6)}`
}

async function fetchNearest(point: IReachablePoint): Promise<ISnapResult | null> {
  const url = `${OSRM_NEAREST_BASE}/${point.longitude},${point.latitude}?number=1`
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>(resolve => {
    timer = setTimeout(() => {
      controller?.abort()
      resolve(null)
    }, REQUEST_TIMEOUT_MS)
  })
  try {
    return await Promise.race([deadline, (async(): Promise<ISnapResult | null> => {
      activeProviderReads++
      try {
        const response = await fetch(url, controller ? { signal: controller.signal } : undefined)
        if (!response.ok) return null
        const data = await response.json()
        if (data?.code !== undefined && data.code !== 'Ok') return null
        const waypoint = data?.waypoints?.[0]
        const location = waypoint?.location
        const distance = numericValue(waypoint?.distance)
        if (!Array.isArray(location) || location.length < 2 || distance === null || distance < 0) return null
        const snapped = normalizePoint({ latitude: location[1], longitude: location[0] })
        if (!snapped) return null
        return {
          latitude: Number(snapped.latitude.toFixed(6)),
          longitude: Number(snapped.longitude.toFixed(6)),
          roadDistanceMeters: distance,
          source: 'osrm',
        }
      } finally {
        // A logical timeout need not stop a non-cooperative fetch implementation.
        // Keep its physical slot until both the HTTP read and body really settle.
        activeProviderReads--
      }
    })()])
  } catch {
    // Сеть/таймаут/CORS — снап недоступен, отдаём null (best-effort).
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// Ближайшая точка на дорожной сети + расстояние до неё. null, если OSRM недоступен.
export async function snapToRoad(point: IReachablePoint): Promise<ISnapResult | null> {
  const normalized = normalizePoint(point)
  if (!normalized) return null
  const key = cacheKey(normalized)
  const cached = nearestCache.get(key)
  if (cached && cached.expiresAt > monotonicNow()) {
    nearestCache.delete(key)
    nearestCache.set(key, cached)
    return copyResult(cached.value)
  }
  nearestCache.delete(key)
  const pending = pendingRequests.get(key)
  if (pending) return copyResult(await pending)
  // Saturation keeps the existing best-effort fallback instead of an unbounded queue.
  if (pendingRequests.size >= MAX_PENDING_REQUESTS || activeProviderReads >= MAX_PENDING_REQUESTS) return null
  const request = fetchNearest(normalized).then(value => {
    const now = monotonicNow()
    nearestCache.forEach((entry, id) => { if (entry.expiresAt <= now) nearestCache.delete(id) })
    nearestCache.set(key, { value: copyResult(value), expiresAt: now + (value ? SUCCESS_CACHE_MS : FAILURE_CACHE_MS) })
    while (nearestCache.size > MAX_CACHE_ENTRIES) nearestCache.delete(nearestCache.keys().next().value!)
    return value
  })
  pendingRequests.set(key, request)
  try {
    return copyResult(await request)
  } finally {
    pendingRequests.delete(key)
  }
}

// Доступна ли точка = есть ли дорога в пределах `withinMeters`. При недоступном OSRM
// возвращаем true, чтобы не блокировать генерацию заказа.
export async function isReachable(
  point: IReachablePoint,
  withinMeters: number = REACHABLE_ROAD_METERS,
): Promise<boolean> {
  const snap = await snapToRoad(point)
  if (!snap) return true
  return snap.roadDistanceMeters <= withinMeters
}

// Политика «регенерация → snap»: до `maxAttempts` раз просим генератор дать новую
// точку; если какая-то сразу у дороги (<= reachableMeters) — берём её без изменений.
// Иначе привязываем к дороге лучшего (ближайшего к дороге) кандидата. Доп. поля
// объекта-точки (адрес и т.п.) сохраняются — меняются только координаты при снапе.
export async function ensureReachablePoint<T extends IReachablePoint>(
  generate: (attempt: number) => T,
  options: { maxAttempts?: number, reachableMeters?: number } = {},
): Promise<IEnsureReachableResult<T>> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))
  const reachableMeters = options.reachableMeters ?? REACHABLE_ROAD_METERS

  let best: { candidate: T, snap: ISnapResult } | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generate(attempt)
    const snap = await snapToRoad(candidate)

    if (!snap) {
      // OSRM недоступен — судить о доступности нечем, отдаём кандидата как есть.
      return { point: candidate, roadDistanceMeters: null, snapped: false, attempts: attempt + 1, source: 'fallback' }
    }

    if (snap.roadDistanceMeters <= reachableMeters)
      return { point: candidate, roadDistanceMeters: snap.roadDistanceMeters, snapped: false, attempts: attempt + 1, source: 'reachable' }

    if (!best || snap.roadDistanceMeters < best.snap.roadDistanceMeters)
      best = { candidate, snap }
  }

  // Ни одна регенерация не попала близко к дороге — привязываем лучшего кандидата.
  const snappedPoint = {
    ...best!.candidate,
    latitude: best!.snap.latitude,
    longitude: best!.snap.longitude,
  }
  return { point: snappedPoint, roadDistanceMeters: best!.snap.roadDistanceMeters, snapped: true, attempts: maxAttempts, source: 'snapped' }
}
