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

// Кэш ответов /nearest по округлённой координате. Кэшируем и промахи (null), чтобы
// не долбить внешний сервис повторно по одной и той же недоступной точке.
const nearestCache = new Map<string, ISnapResult | null>()

function isFinitePoint(point: IReachablePoint | null | undefined): point is IReachablePoint {
  return Boolean(point) &&
    Number.isFinite(Number(point!.latitude)) &&
    Number.isFinite(Number(point!.longitude))
}

function cacheKey(point: IReachablePoint): string {
  return `${Number(point.latitude).toFixed(6)},${Number(point.longitude).toFixed(6)}`
}

async function fetchNearest(point: IReachablePoint): Promise<ISnapResult | null> {
  const url = `${OSRM_NEAREST_BASE}/${point.longitude},${point.latitude}?number=1`
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null
  try {
    const response = await fetch(url, controller ? { signal: controller.signal } : undefined)
    if (!response.ok) return null
    const data = await response.json()
    const waypoint = data?.waypoints?.[0]
    const location = waypoint?.location
    const distance = Number(waypoint?.distance)
    if (!Array.isArray(location) || location.length < 2 || !Number.isFinite(distance)) return null
    const longitude = Number(location[0])
    const latitude = Number(location[1])
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
    return {
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
      roadDistanceMeters: distance,
      source: 'osrm',
    }
  } catch {
    // Сеть/таймаут/CORS — снап недоступен, отдаём null (best-effort).
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// Ближайшая точка на дорожной сети + расстояние до неё. null, если OSRM недоступен.
export async function snapToRoad(point: IReachablePoint): Promise<ISnapResult | null> {
  if (!isFinitePoint(point)) return null
  const key = cacheKey(point)
  if (nearestCache.has(key)) return nearestCache.get(key) ?? null
  const result = await fetchNearest(point)
  nearestCache.set(key, result)
  return result
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
