/**
 * Decision Log — третий журнал системы, рядом с RAW и Flow.
 *
 * Полная спецификация: `taxi/DECISION_LOG_SPEC_RU.md`.
 *
 * Главное правило, которое этот модуль обслуживает:
 *
 *   Журнал — неизменяемое хранилище ФАКТОВ. Он не содержит выводов, вердиктов и
 *   названий аномалий. Пишем измеренные значения («свободных мест 1, требуется 2»)
 *   и наблюдаемый исход («карточка не отрисована»), а не причину («не хватило
 *   мест»). Причинно-следственные связи строит внешний анализатор.
 *
 * Поэтому здесь нет ни одной функции, которая что-то «решает» или «объясняет»:
 * модуль умеет только принять готовый снимок и положить его в буфер.
 */

import { getDeviceId, getSessionId, writeRawLog } from './rawLog'

type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike }

/** Где в конвейере снят снимок. */
export type TDecisionStage =
  /** Ответ API до записи в store. */
  | 'API_RESPONSE'
  /** Результат селектора заказов. */
  | 'SELECTOR'
  /** Набор карточек, отрисованных в списке водителя. */
  | 'LIST_UI'
  /** Набор булавок, отрисованных на карте водителя. */
  | 'MAP_UI'

/** Наблюдаемый исход — что случилось с заказом, а не почему. */
export type TDecision =
  /** Заказ присутствует/отрисован на этой стадии. */
  | 'VISIBLE'
  /** Заказ был на предыдущей стадии, на этой отсутствует. */
  | 'HIDDEN'
  /** Заказ полностью исчез из входных данных. */
  | 'GONE'

export type TDecisionEvent =
  | 'ORDER_DECISION_INITIAL'
  | 'ORDER_DECISION_CHANGED'
  | 'ORDER_DECISION_FINAL'
  | 'DECISION_HEARTBEAT'
  /** Шаг таймлайна взаимодействия водителя с заказом. */
  | 'ORDER_INTERACTION'

/**
 * Наблюдаемые действия водителя над заказом. Все — факты о том, что произошло
 * на экране или ушло на сервер; ни одного вывода о намерениях водителя.
 */
export type TOrderInteractionStep =
  /** Заказ впервые показан водителю (карточка в списке или булавка на карте). */
  | 'PRESENTED'
  /** Водитель выделил карточку. */
  | 'SELECTED'
  /** Открыт экран заказа. */
  | 'OPENED'
  /** Нажата кнопка взятия, запрос ушёл на сервер. */
  | 'TAKE_REQUESTED'
  | 'TAKE_SUCCEEDED'
  | 'TAKE_FAILED'
  /** Водитель скрыл заказ. */
  | 'HIDDEN_BY_DRIVER'
  /** Заказ пропал с экрана водителя. */
  | 'PRESENTATION_ENDED'

export type TOrderInteractionSurface = 'LIST' | 'MAP' | 'ORDER_SCREEN' | 'API'

export interface IDecisionInteraction {
  step: TOrderInteractionStep
  surface: TOrderInteractionSurface | null
  /** Сколько прошло с момента, когда заказ впервые показали водителю. */
  msSincePresented: number | null
  /** Сколько прошло с предыдущего шага по этому же заказу. */
  msSincePreviousStep: number | null
  previousStep: TOrderInteractionStep | null
  details?: JsonLike
}

/**
 * Что сделал КОД с этой проверкой. Статус описывает поведение системы, а не
 * правильность заказа.
 */
export type TDecisionCheckStatus =
  /** Проверка выполнена, заказ её прошёл. */
  | 'PASS'
  /** Проверка выполнена, заказ её не прошёл. */
  | 'FAIL'
  /** Значение вычисляется, но на видимость не влияет (например, выгода — она сортирует). */
  | 'INFORMATIONAL'
  /** Данных для проверки нет: нет координат, машины, геопозиции. */
  | 'UNKNOWN'
  /** Ветка кода на этой стадии не выполнялась. */
  | 'SKIPPED'
  /** Правило заложено в целевую схему, кода нет. `value` обязан быть null. */
  | 'NOT_IMPLEMENTED'

export interface IDecisionCheck {
  key: string
  status: TDecisionCheckStatus
  /** Фактически измеренное значение — точное, без квантования. */
  value?: JsonLike
  /** Порог/ограничение, с которым сравнивали. */
  limit?: JsonLike
}

export interface IDecisionRecord {
  id: string
  ts: string
  timestamp: number
  event: TDecisionEvent
  sessionId: string
  deviceId: string
  driverId: string | number | null
  orderId: string | number | null
  stage: TDecisionStage | null
  decision: TDecision | null
  decisionMatrix: IDecisionCheck[]
  /** LEGACY: вычисленная причина из старых журналов. Только для сверки моделей. */
  reason?: string | null
  driverSnapshot?: JsonLike
  orderSnapshot?: JsonLike
  fingerprint?: string | null
  /** Тяжёлые технические детали — только при включённом debug. */
  debug?: JsonLike
  /** Компактный срез по всем отслеживаемым заказам (только у DECISION_HEARTBEAT). */
  orders?: IDecisionHeartbeatOrder[]
  /** Шаг таймлайна водителя (только у ORDER_INTERACTION). */
  interaction?: IDecisionInteraction
}

export interface IDecisionHeartbeatOrder {
  orderId: string | number
  stage: TDecisionStage
  decision: TDecision
  fingerprint: string
}

export interface IWriteOrderDecisionInput {
  event: Exclude<TDecisionEvent, 'DECISION_HEARTBEAT'>
  stage: TDecisionStage
  decision: TDecision
  orderId: string | number | null
  driverId?: string | number | null
  decisionMatrix: IDecisionCheck[]
  fingerprint?: string | null
  reason?: string | null
  driverSnapshot?: any
  orderSnapshot?: any
  debug?: any
}

export interface IWriteDecisionHeartbeatInput {
  driverId?: string | number | null
  orders: IDecisionHeartbeatOrder[]
  driverSnapshot?: any
  debug?: any
}

export const DECISION_LOG_STORAGE_KEY = 'taxi_decision_log_v1'
const DECISION_DEBUG_STORAGE_KEY = 'taxi_decision_log_debug_v1'
const DECISION_LIFECYCLE_INITIALIZED_KEY = '__taxiDecisionLifecycleInitialized'

export const MAX_DECISION_RECORDS = 1500
/** Сколько буфера отбрасываем, когда localStorage переполнен. */
const QUOTA_DROP_RATIO = 0.25
const STORAGE_FLUSH_DELAY_MS = 1000

const MAX_DEPTH = 5
const MAX_ARRAY_ITEMS = 60
const MAX_STRING_LENGTH = 900

let cachedRecords: IDecisionRecord[] | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pendingFlush = false

function isBrowser() {
  return typeof window !== 'undefined'
}

function safeNowIso() {
  try {
    return new Date().toISOString()
  } catch (_) {
    return String(Date.now())
  }
}

function makeId(prefix: string) {
  try {
    const cryptoObject = isBrowser() ? window.crypto : undefined
    if (cryptoObject?.randomUUID)
      return `${prefix}-${cryptoObject.randomUUID()}`
  } catch (_) {}

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function sanitize(value: any, depth = 0): JsonLike {
  if (depth > MAX_DEPTH)
    return '[depth-limit]'

  if (value === null || value === undefined)
    return null

  const type = typeof value
  if (type === 'string')
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value

  if (type === 'number')
    return Number.isFinite(value) ? value : null

  if (type === 'boolean')
    return value

  if (value instanceof Date)
    return value.toISOString()

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitize(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS)
      items.push(`[+${value.length - MAX_ARRAY_ITEMS} items]`)
    return items
  }

  if (type === 'object') {
    const output: { [key: string]: JsonLike } = {}
    Object.keys(value).slice(0, MAX_ARRAY_ITEMS).forEach(key => {
      const lower = key.toLowerCase()
      if (
        lower.includes('password') ||
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('authorization') ||
        lower.includes('u_hash')
      ) {
        output[key] = '[hidden]'
        return
      }

      output[key] = sanitize(value[key], depth + 1)
    })
    return output
  }

  return String(value)
}

function readRecordsFromStorage(): IDecisionRecord[] {
  if (!isBrowser())
    return []

  try {
    const raw = window.localStorage.getItem(DECISION_LOG_STORAGE_KEY)
    if (!raw)
      return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function getCachedRecords() {
  if (cachedRecords === null)
    cachedRecords = readRecordsFromStorage()
  return cachedRecords
}

/**
 * Записывает буфер в localStorage. При переполнении хранилища отбрасывает
 * старейшую четверть и повторяет попытку один раз: потерять начало смены лучше,
 * чем перестать писать вообще.
 */
export function flushDecisionLog() {
  pendingFlush = false
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }

  if (!isBrowser() || cachedRecords === null)
    return

  try {
    window.localStorage.setItem(DECISION_LOG_STORAGE_KEY, JSON.stringify(cachedRecords))
  } catch (_) {
    const dropCount = Math.max(1, Math.floor(cachedRecords.length * QUOTA_DROP_RATIO))
    cachedRecords = cachedRecords.slice(dropCount)
    try {
      window.localStorage.setItem(DECISION_LOG_STORAGE_KEY, JSON.stringify(cachedRecords))
    } catch (_) {
      // Хранилище заблокировано целиком — буфер остаётся только в памяти.
    }
  }
}

function scheduleFlush() {
  if (!isBrowser())
    return

  pendingFlush = true
  if (flushTimer !== null)
    return

  flushTimer = setTimeout(flushDecisionLog, STORAGE_FLUSH_DELAY_MS)
}

/**
 * Подробный технический payload пишем не всегда: компактная decision-телеметрия
 * идёт и в реальной смене, а тяжёлые сырые объекты нужны только при отладке.
 */
export function isDecisionDebugEnabled() {
  if (!isBrowser())
    return false

  try {
    if ((window as any).__taxiDecisionDebug)
      return true
    return window.localStorage.getItem(DECISION_DEBUG_STORAGE_KEY) === '1'
  } catch (_) {
    return false
  }
}

export function setDecisionDebugEnabled(enabled: boolean) {
  if (!isBrowser())
    return

  try {
    ;(window as any).__taxiDecisionDebug = enabled
    if (enabled)
      window.localStorage.setItem(DECISION_DEBUG_STORAGE_KEY, '1')
    else
      window.localStorage.removeItem(DECISION_DEBUG_STORAGE_KEY)
  } catch (_) {}
}

function pushRecord(record: IDecisionRecord) {
  const records = getCachedRecords()
  records.push(record)
  if (records.length > MAX_DECISION_RECORDS)
    records.splice(0, records.length - MAX_DECISION_RECORDS)

  cachedRecords = records
  scheduleFlush()
  return record
}

function makeBaseRecord(event: TDecisionEvent, driverId?: string | number | null): IDecisionRecord {
  return {
    id: makeId('decision'),
    ts: safeNowIso(),
    timestamp: Date.now(),
    event,
    sessionId: getSessionId(),
    deviceId: getDeviceId(),
    driverId: driverId ?? null,
    orderId: null,
    stage: null,
    decision: null,
    decisionMatrix: [],
  }
}

/**
 * Снимок решения по одному заказу. Вызывающая сторона отвечает за то, что
 * матрица содержит измеренные значения, а не вердикты.
 */
export function writeOrderDecision(input: IWriteOrderDecisionInput): IDecisionRecord | null {
  if (!isBrowser())
    return null

  const record: IDecisionRecord = {
    ...makeBaseRecord(input.event, input.driverId),
    orderId: input.orderId ?? null,
    stage: input.stage,
    decision: input.decision,
    decisionMatrix: input.decisionMatrix.map(check => ({
      key: check.key,
      status: check.status,
      ...(check.value === undefined ? {} : { value: sanitize(check.value) }),
      ...(check.limit === undefined ? {} : { limit: sanitize(check.limit) }),
    })),
    fingerprint: input.fingerprint ?? null,
    driverSnapshot: sanitize(input.driverSnapshot),
    orderSnapshot: sanitize(input.orderSnapshot),
  }

  // LEGACY: старая модель причин остаётся на переходный период — по ней сверяют,
  // что новая матрица покрывает все прежние объяснения. Новые вычисленные причины
  // сюда не добавляются.
  if (input.reason !== undefined && input.reason !== null)
    record.reason = input.reason

  if (input.debug !== undefined && isDecisionDebugEnabled())
    record.debug = sanitize(input.debug)

  // RAW-журнал остаётся единым потоком низкоуровневых событий: решение должно
  // быть видно и там, в общей ленте времени.
  writeRawLog(input.event, {
    source: 'decision-log',
    orderId: record.orderId,
    driverId: record.driverId,
    stage: record.stage,
    decision: record.decision,
    fingerprint: record.fingerprint,
  })

  return pushRecord(record)
}

/**
 * Heartbeat фиксирует, что состояние продолжало существовать между изменениями.
 * Матрицы он не повторяет — только id заказов, их исход и отпечаток.
 */
export function writeDecisionHeartbeat(input: IWriteDecisionHeartbeatInput): IDecisionRecord | null {
  if (!isBrowser())
    return null

  const record: IDecisionRecord = {
    ...makeBaseRecord('DECISION_HEARTBEAT', input.driverId),
    orders: input.orders,
    driverSnapshot: sanitize(input.driverSnapshot),
  }

  if (input.debug !== undefined && isDecisionDebugEnabled())
    record.debug = sanitize(input.debug)

  return pushRecord(record)
}

export interface IWriteOrderInteractionInput {
  orderId: string | number | null
  driverId?: string | number | null
  interaction: IDecisionInteraction
}

/**
 * Шаг таймлайна взаимодействия. Живёт в том же журнале, что и матрица решений:
 * вопрос «почему водитель взял заказ А, а мимо заказа Б проехал» требует обеих
 * половин — что система показала и что водитель с этим сделал.
 */
export function writeOrderInteraction(input: IWriteOrderInteractionInput): IDecisionRecord | null {
  if (!isBrowser())
    return null

  const record: IDecisionRecord = {
    ...makeBaseRecord('ORDER_INTERACTION', input.driverId),
    orderId: input.orderId ?? null,
    interaction: {
      ...input.interaction,
      ...(input.interaction.details === undefined ?
        {} :
        { details: sanitize(input.interaction.details) }),
    },
  }

  writeRawLog('ORDER_INTERACTION', {
    source: 'decision-log',
    orderId: record.orderId,
    driverId: record.driverId,
    step: input.interaction.step,
    surface: input.interaction.surface,
    msSincePresented: input.interaction.msSincePresented,
    msSincePreviousStep: input.interaction.msSincePreviousStep,
  })

  return pushRecord(record)
}

export function getDecisionLogSnapshot() {
  flushDecisionLog()

  return {
    title: 'taxi decision log',
    specification: 'DECISION_LOG_SPEC_RU.md',
    principle: 'facts only, no conclusions',
    exportedAt: safeNowIso(),
    sessionId: getSessionId(),
    deviceId: getDeviceId(),
    debugEnabled: isDecisionDebugEnabled(),
    entries: getCachedRecords(),
  }
}

export function clearDecisionLog() {
  cachedRecords = []
  pendingFlush = true
  flushDecisionLog()
}

export function setupDecisionLogLifecycle() {
  if (!isBrowser())
    return

  const anyWindow = window as any
  if (anyWindow[DECISION_LIFECYCLE_INITIALIZED_KEY])
    return

  anyWindow[DECISION_LIFECYCLE_INITIALIZED_KEY] = true

  // Буфер сбрасывается с задержкой, поэтому уход со страницы и сворачивание
  // приложения обязаны дописать хвост — иначе теряются последние решения смены.
  const flushIfPending = () => {
    if (pendingFlush)
      flushDecisionLog()
  }

  document.addEventListener('visibilitychange', flushIfPending)
  window.addEventListener('pagehide', flushIfPending)
  window.addEventListener('beforeunload', flushIfPending)

  anyWindow.__taxiDecision = {
    get: getDecisionLogSnapshot,
    clear: clearDecisionLog,
    flush: flushDecisionLog,
    debug: setDecisionDebugEnabled,
    isDebug: isDecisionDebugEnabled,
  }
}

setupDecisionLogLifecycle()
