/**
 * Факты о положении водителя и об источнике координат.
 *
 * Спецификация: `taxi/DECISION_LOG_SPEC_RU.md`, §13.
 *
 * Задача модуля — сделать так, чтобы по журналу можно было увидеть, что
 * координата водителя изменилась на 2.4 км за 0.3 секунды, и что ровно в этот
 * момент источник координат сменился с эмулятора на реальный GPS.
 *
 * Чего модуль НЕ делает: он не пишет `GPS_TELEPORT_DETECTED` и вообще никаких
 * аномалий. «Мгновенное перемещение физически невозможно» — это вывод, и его
 * строит анализатор по трём фактам, которые здесь записаны: расстояние, время
 * между точками и смена источника.
 *
 * Частота записи. Маркер публикуется несколько раз в секунду, поэтому пишется
 * не каждая точка: сохраняются смены источника (всегда), заметные перемещения
 * (всегда — иначе скачок остался бы незаписанным) и разреженная выборка по
 * времени. Триггер записи указан в самой записи полем `samplingTrigger`, чтобы
 * прореживание было видно, а не подразумевалось.
 */

import { writeFlowEvent } from './flowLog'
import { distanceBetweenEarthCoordinates } from './geo'
import { writeRawLog } from './rawLog'

/** Откуда взята координата, которую видит водитель на карте. */
export type TDriverPositionSource =
  /** Маркер ведёт эмулятор маршрута (демо-движение или ручное управление). */
  | 'EMULATOR_ROUTE'
  /** Точка эмулятора, восстановленная после возврата на вкладку карты. */
  | 'EMULATOR_RESTORED'
  /** Точка, где водитель остался после прошлого заказа. */
  | 'PARKED'
  /** Координата водителя, пришедшая с бэкенда внутри заказа. */
  | 'BACKEND'
  /** Реальный GPS браузера. */
  | 'BROWSER_GPS'
  /** Позиции нет. */
  | 'NONE'
  /** Публикующая сторона источник не указала. */
  | 'UNKNOWN'

type TSamplingTrigger =
  | 'first_point'
  | 'source_change'
  | 'distance_step'
  | 'interval'
  | 'position_lost'

/** Разреженная выборка положения, когда ничего примечательного не происходит. */
const LOCATION_SAMPLE_INTERVAL_MS = 5000
/**
 * Перемещение, которое пишется немедленно. Порог намеренно низкий: он должен
 * гарантировать, что оба конца любого скачка попадут в журнал.
 */
const LOCATION_SAMPLE_DISTANCE_METERS = 150

interface ILoggedPoint {
  latitude: number
  longitude: number
  source: TDriverPositionSource
  timestamp: number
}

let lastPoint: ILoggedPoint | null = null
let lastWrittenAt = 0
let lastWrittenPoint: ILoggedPoint | null = null

function round(value: number, digits: number) {
  const factor = Math.pow(10, digits)
  return Math.round(value * factor) / factor
}

function metersBetween(from: ILoggedPoint | null, to: ILoggedPoint | null) {
  if (!from || !to)
    return null

  return round(distanceBetweenEarthCoordinates(
    from.latitude,
    from.longitude,
    to.latitude,
    to.longitude,
  ) * 1000, 1)
}

function buildPayload(point: ILoggedPoint | null, previous: ILoggedPoint | null, trigger: TSamplingTrigger) {
  const distanceMeters = metersBetween(previous, point)
  const deltaTimeMs = previous && point ? point.timestamp - previous.timestamp : null
  // Скорость — арифметика над двумя фактами выше, оба записаны рядом. Никакой
  // оценки «нормально/аномально» здесь нет и быть не должно.
  const calculatedSpeedKmh = distanceMeters !== null && deltaTimeMs !== null && deltaTimeMs > 0 ?
    round(distanceMeters / deltaTimeMs * 3600, 1) :
    null

  return {
    // Не `source`: в RAW-логе это поле занято именем подсистемы-источника записи.
    positionSource: point?.source ?? 'NONE',
    latitude: point?.latitude ?? null,
    longitude: point?.longitude ?? null,
    previous: previous ?
      {
        source: previous.source,
        latitude: previous.latitude,
        longitude: previous.longitude,
        timestamp: previous.timestamp,
      } :
      null,
    distanceMeters,
    deltaTimeMs,
    calculatedSpeedKmh,
    samplingTrigger: trigger,
    samplingIntervalMs: LOCATION_SAMPLE_INTERVAL_MS,
    samplingDistanceMeters: LOCATION_SAMPLE_DISTANCE_METERS,
  }
}

function writeLocation(point: ILoggedPoint | null, previous: ILoggedPoint | null, trigger: TSamplingTrigger) {
  lastWrittenAt = Date.now()
  lastWrittenPoint = point

  writeRawLog('DRIVER_LOCATION', {
    source: 'driver-position-bus',
    ...buildPayload(point, previous, trigger),
  })
}

/**
 * Принимает точку, опубликованную шиной положения водителя. Возвращает `true`,
 * если запись была сделана — удобно для тестов.
 */
export function recordDriverLocation(
  position: [number, number] | null,
  source: TDriverPositionSource = 'UNKNOWN',
): boolean {
  const previous = lastPoint
  const point: ILoggedPoint | null = position ?
    {
      latitude: position[0],
      longitude: position[1],
      source,
      timestamp: Date.now(),
    } :
    null

  lastPoint = point

  // Смена источника — самостоятельное событие: именно она объясняет разрыв в
  // координатах, и потерять её из-за прореживания нельзя.
  const previousSource = previous?.source ?? 'NONE'
  const nextSource = point?.source ?? 'NONE'
  if (previousSource !== nextSource) {
    const sourceChange = {
      oldSource: previousSource,
      newSource: nextSource,
    }
    writeFlowEvent('LOCATION_SOURCE_CHANGED', {
      screen: 'DriverMap',
      uiState: 'DriverPositionBus',
      data: { ...sourceChange, ...buildPayload(point, previous, 'source_change') },
    })
    writeRawLog('LOCATION_SOURCE_CHANGED', {
      source: 'driver-position-bus',
      ...sourceChange,
      ...buildPayload(point, previous, 'source_change'),
    })
    writeLocation(point, previous, point ? 'source_change' : 'position_lost')
    return true
  }

  if (!point)
    return false

  if (!previous || !lastWrittenPoint) {
    writeLocation(point, previous, 'first_point')
    return true
  }

  const metersSinceWritten = metersBetween(lastWrittenPoint, point) ?? 0
  if (metersSinceWritten >= LOCATION_SAMPLE_DISTANCE_METERS) {
    writeLocation(point, previous, 'distance_step')
    return true
  }

  if (Date.now() - lastWrittenAt >= LOCATION_SAMPLE_INTERVAL_MS) {
    writeLocation(point, previous, 'interval')
    return true
  }

  return false
}

/**
 * Запуск и остановка эмуляции. Отдельное событие нужно потому, что именно между
 * ним и следующей координатой обычно и происходит разрыв положения.
 */
export function recordEmulatorGeoState(mode: string, running: boolean) {
  const event = running ? 'EMULATOR_GEO_STARTED' : 'EMULATOR_GEO_STOPPED'
  const data = {
    mode,
    lastKnownSource: lastPoint?.source ?? 'NONE',
    lastKnownLatitude: lastPoint?.latitude ?? null,
    lastKnownLongitude: lastPoint?.longitude ?? null,
  }

  writeFlowEvent(event, {
    screen: 'DriverMap',
    uiState: 'DriverPositionBus',
    data,
  })
  writeRawLog(event, {
    source: 'browser-emulator-mode',
    ...data,
  })
}

/** Сброс состояния — смена сессии, тесты. */
export function resetDriverLocationLog() {
  lastPoint = null
  lastWrittenPoint = null
  lastWrittenAt = 0
}

/** Только для тестов и диагностики. */
export function getLastLoggedDriverLocation() {
  return lastPoint
}
