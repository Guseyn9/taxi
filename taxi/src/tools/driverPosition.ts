/**
 * Shared "where is the driver right now" channel.
 *
 * The driver map resolves the marker position from several sources (route
 * emulator > backend coords > browser GPS), but that resolution lived only
 * inside pages/Driver/Map.tsx. The order-details surfaces (CardModal, the Order
 * page) needed the same answer to tell whether the driver reached the pickup,
 * and were falling back to the Redux `geoposition` — raw device GPS, which never
 * moves during an emulator run. So the map marker could sit on the pickup point
 * while the card still believed the driver was far away.
 *
 * The map publishes its resolved position here and the cards read it, mirroring
 * the window-event bus the rest of the emulator UI already uses.
 */

import { useEffect, useState } from 'react'

import { TDriverPositionSource, recordDriverLocation } from './driverLocationLog'
import { distanceBetweenEarthCoordinates } from './geo'

export type TDriverPosition = [number, number]

/** A driver counts as "at the pickup" within this radius. */
export const PICKUP_ARRIVAL_RADIUS_METERS = 100

/** Same threshold for the dropoff — it flips the trip button to "Завершить поездку". */
export const DESTINATION_ARRIVAL_RADIUS_METERS = 100

const DRIVER_POSITION_EVENT = 'driverPositionChanged'

/**
 * «Где водитель остался» — точка, переживающая закрытие заказа.
 *
 * Позиция маркера жила только в состоянии карты (и в persistedDriverDemo), а оба
 * привязаны к АКТИВНОЙ поездке: заказ закрылся — план опустел, и водитель
 * возвращался к сырому GPS браузера, то есть к домашней точке, хотя прошлый
 * заказ мог закончиться на другом конце города. Оттуда же берут точку и
 * генераторы заказов, поэтому новые заказы появлялись вокруг дома, а не вокруг
 * водителя.
 *
 * Точку пишет карта (по ходу движения маркера и в момент завершения заказа), а
 * читают все, кому нужно «где сейчас такси»: сама карта после возвращения на
 * неё, расчёт выгоды и клиентский эмулятор.
 */
const DRIVER_PARKED_POSITION_KEY = 'gruzvill_driver_parked_position'

/** Маркер тикает раз в секунду, а точность записи тут не нужна — пишем реже. */
const PARKED_POSITION_WRITE_INTERVAL_MS = 3000

let currentDriverPosition: TDriverPosition | null = null
let parkedDriverPosition: TDriverPosition | null = null
let parkedDriverPositionLoaded = false
let parkedDriverPositionWrittenAt = 0

function loadParkedDriverPosition(): TDriverPosition | null {
  if (typeof window === 'undefined')
    return null

  try {
    const parsed = JSON.parse(window.localStorage.getItem(DRIVER_PARKED_POSITION_KEY) || 'null')
    const latitude = Number(parsed?.latitude)
    const longitude = Number(parsed?.longitude)
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null
  } catch {
    return null
  }
}

/** Последняя известная точка водителя, пережившая закрытие заказа и перезагрузку. */
export function getDriverParkedPosition(): TDriverPosition | null {
  if (!parkedDriverPositionLoaded) {
    parkedDriverPositionLoaded = true
    parkedDriverPosition = loadParkedDriverPosition()
  }

  return parkedDriverPosition
}

/**
 * Запомнить, где сейчас стоит/едет такси. `immediate` — для моментов, которые
 * нельзя потерять (завершение заказа): обычные тики маркера пишутся в хранилище
 * по таймеру, а в памяти точка всегда свежая.
 */
export function rememberDriverParkedPosition(
  position: TDriverPosition,
  { immediate = false }: { immediate?: boolean } = {},
) {
  if (!Number.isFinite(position?.[0]) || !Number.isFinite(position?.[1]))
    return

  parkedDriverPositionLoaded = true
  parkedDriverPosition = [position[0], position[1]]

  if (typeof window === 'undefined')
    return

  const now = Date.now()
  if (!immediate && now - parkedDriverPositionWrittenAt < PARKED_POSITION_WRITE_INTERVAL_MS)
    return

  parkedDriverPositionWrittenAt = now
  try {
    window.localStorage.setItem(DRIVER_PARKED_POSITION_KEY, JSON.stringify({
      latitude: position[0],
      longitude: position[1],
      timestamp: now,
    }))
  } catch {
    // ignore storage errors
  }
}

/**
 * Новый прогон эмулятора начинается там, где физически стоит устройство, —
 * поэтому его остановка забывает точку прошлой смены.
 */
export function clearDriverParkedPosition() {
  parkedDriverPositionLoaded = true
  parkedDriverPosition = null
  parkedDriverPositionWrittenAt = 0
  // Живую точку тоже забываем: иначе «где водитель» ответила бы координатой из
  // прошлого прогона (карта, если открыта, тут же опубликует настоящую).
  publishDriverPosition(null, 'NONE')

  if (typeof window === 'undefined')
    return

  try {
    window.localStorage.removeItem(DRIVER_PARKED_POSITION_KEY)
  } catch {
    // ignore storage errors
  }
}

/**
 * `source` не влияет на поведение шины — он нужен журналу. Без него скачок
 * координат после остановки эмулятора неотличим от обычного движения: в логе
 * видно только, что точка изменилась, но не почему сменился её источник.
 */
export function publishDriverPosition(
  position: TDriverPosition | null,
  source: TDriverPositionSource = 'UNKNOWN',
) {
  const unchanged = Boolean(
    currentDriverPosition && position &&
    currentDriverPosition[0] === position[0] &&
    currentDriverPosition[1] === position[1],
  )
  if (unchanged || (!currentDriverPosition && !position))
    return

  currentDriverPosition = position
  recordDriverLocation(position, source)
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(DRIVER_POSITION_EVENT, { detail: position }))
}

/**
 * Где водитель сейчас. Пока карта открыта — её маркер; когда она не смонтирована
 * (водитель на списке заказов, страница только что перезагрузилась) — точка, где
 * он остался после прошлого заказа. Домашний GPS остаётся последним запасным
 * вариантом на стороне вызывающего.
 */
export function getDriverPosition() {
  return currentDriverPosition ?? getDriverParkedPosition()
}

export function subscribeDriverPosition(listener: (position: TDriverPosition | null) => void) {
  if (typeof window === 'undefined')
    return () => {}

  const handler = (event: Event) =>
    listener((event as CustomEvent<TDriverPosition | null>).detail ?? null)

  window.addEventListener(DRIVER_POSITION_EVENT, handler)
  return () => window.removeEventListener(DRIVER_POSITION_EVENT, handler)
}

export function useDriverPosition() {
  const [position, setPosition] = useState(getDriverPosition)
  useEffect(() => subscribeDriverPosition(setPosition), [])
  return position
}

function isWithinRadius(
  position: TDriverPosition | null | undefined,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  radiusMeters: number,
) {
  if (!position || !latitude || !longitude)
    return false

  const distanceMeters = distanceBetweenEarthCoordinates(
    position[0],
    position[1],
    latitude,
    longitude,
  ) * 1000

  return distanceMeters <= radiusMeters
}

/**
 * Distance checks against the order's endpoints, shared by the map buttons and
 * the order-details cards so they cannot disagree about where the driver is.
 */
export function isAtPickupPoint(
  position: TDriverPosition | null | undefined,
  pickupLatitude?: number | null,
  pickupLongitude?: number | null,
) {
  return isWithinRadius(position, pickupLatitude, pickupLongitude, PICKUP_ARRIVAL_RADIUS_METERS)
}

export function isAtDestinationPoint(
  position: TDriverPosition | null | undefined,
  destinationLatitude?: number | null,
  destinationLongitude?: number | null,
) {
  return isWithinRadius(
    position,
    destinationLatitude,
    destinationLongitude,
    DESTINATION_ARRIVAL_RADIUS_METERS,
  )
}
