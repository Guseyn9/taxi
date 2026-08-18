/**
 * Трекер решений по видимости заказов.
 *
 * Спецификация: `taxi/DECISION_LOG_SPEC_RU.md`, §7.
 *
 * Матрица НЕ пишется на каждый polling. Трекер держит отпечаток последнего
 * снимка по каждой паре «стадия + заказ» и пишет запись только тогда, когда
 * отпечаток изменился:
 *
 *   ORDER_DECISION_INITIAL  — заказ впервые появился на стадии
 *   ORDER_DECISION_CHANGED  — изменился отпечаток
 *   DECISION_HEARTBEAT      — раз в 30 с, одной компактной записью на тик
 *   ORDER_DECISION_FINAL    — заказ исчез со стадии
 *
 * Heartbeat нужен не для повторения матрицы, а чтобы зафиксировать, что
 * состояние действительно продолжало существовать между изменениями.
 */

import { IOrder } from '../types/types'
import {
  IDecisionCheck,
  IDecisionHeartbeatOrder,
  TDecision,
  TDecisionStage,
  isDecisionDebugEnabled,
  writeDecisionHeartbeat,
  writeOrderDecision,
} from './decisionLog'
import {
  IOrderDecisionContext,
  buildDecisionFingerprint,
  buildDriverSnapshot,
  buildOrderDecisionMatrix,
  buildOrderSnapshot,
} from './orderDecisionMatrix'
import { recordOrderPresentationEnded, recordOrderPresented } from './orderInteractionLog'

/**
 * Стадии, на которых заказ реально видит водитель. Таймлайн взаимодействия
 * ведётся от них, а не от стадий конвейера: заказ, дошедший до селектора, но не
 * отрисованный, водителю не показывали.
 */
const PRESENTATION_SURFACE_BY_STAGE: Partial<Record<TDecisionStage, 'LIST' | 'MAP'>> = {
  LIST_UI: 'LIST',
  MAP_UI: 'MAP',
}

export const DECISION_HEARTBEAT_INTERVAL_MS = 30000

interface ITrackedEntry {
  stage: TDecisionStage
  orderId: string | number
  driverId: string | number | null
  decision: TDecision
  fingerprint: string
  decisionMatrix: IDecisionCheck[]
  orderSnapshot: any
  driverSnapshot: any
}

export interface ITrackOrderDecisionsInput {
  stage: TDecisionStage
  /** Все заказы, дошедшие до входа этой стадии. */
  orders: IOrder[] | null | undefined
  /** Подмножество, реально присутствующее/отрисованное на выходе стадии. */
  visibleOrderIds: Array<string | number> | null | undefined
  context: IOrderDecisionContext
  /** LEGACY: вычисленная причина из старых журналов, только для сверки моделей. */
  legacyReasonOf?: (order: IOrder) => string | null | undefined
  /** Тяжёлые технические детали — попадут в запись только при включённом debug. */
  debugOf?: (order: IOrder) => any
}

const trackedEntries = new Map<string, ITrackedEntry>()
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function entryKey(stage: TDecisionStage, orderId: string | number) {
  return `${stage}:${orderId}`
}

function stopHeartbeat() {
  if (heartbeatTimer === null)
    return

  clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

function emitHeartbeat() {
  if (!trackedEntries.size) {
    stopHeartbeat()
    return
  }

  const orders: IDecisionHeartbeatOrder[] = []
  let driverId: string | number | null = null
  let driverSnapshot: any = null

  trackedEntries.forEach(entry => {
    orders.push({
      orderId: entry.orderId,
      stage: entry.stage,
      decision: entry.decision,
      fingerprint: entry.fingerprint,
    })
    driverId = entry.driverId
    driverSnapshot = entry.driverSnapshot
  })

  writeDecisionHeartbeat({ driverId, orders, driverSnapshot })
}

function ensureHeartbeat() {
  if (heartbeatTimer !== null || typeof window === 'undefined')
    return

  heartbeatTimer = setInterval(emitHeartbeat, DECISION_HEARTBEAT_INTERVAL_MS)
}

/**
 * Снимает решения по одной стадии конвейера и дописывает в журнал только
 * изменения. Возвращает число записанных записей — удобно для тестов.
 */
export function trackOrderDecisions(input: ITrackOrderDecisionsInput): number {
  const orders = input.orders ?? []
  const visibleIds = new Set((input.visibleOrderIds ?? []).map(String))
  const driverSnapshot = buildDriverSnapshot(input.context)
  const driverId = input.context.user?.u_id ?? null
  const debugEnabled = isDecisionDebugEnabled()
  const seenKeys = new Set<string>()
  let written = 0

  orders.forEach(order => {
    if (!order?.b_id)
      return

    const orderId = order.b_id
    const key = entryKey(input.stage, orderId)
    seenKeys.add(key)

    const decision: TDecision = visibleIds.has(String(orderId)) ? 'VISIBLE' : 'HIDDEN'
    const decisionMatrix = buildOrderDecisionMatrix(order, input.context)
    const fingerprint = buildDecisionFingerprint(decisionMatrix, decision)
    const orderSnapshot = buildOrderSnapshot(order)
    const previous = trackedEntries.get(key)

    const surface = PRESENTATION_SURFACE_BY_STAGE[input.stage]
    if (surface && decision !== previous?.decision) {
      if (decision === 'VISIBLE')
        recordOrderPresented(orderId, surface, driverId)
      else
        recordOrderPresentationEnded(orderId, surface, driverId)
    }

    trackedEntries.set(key, {
      stage: input.stage,
      orderId,
      driverId,
      decision,
      fingerprint,
      decisionMatrix,
      orderSnapshot,
      driverSnapshot,
    })

    if (previous && previous.fingerprint === fingerprint)
      return

    writeOrderDecision({
      event: previous ? 'ORDER_DECISION_CHANGED' : 'ORDER_DECISION_INITIAL',
      stage: input.stage,
      decision,
      orderId,
      driverId,
      decisionMatrix,
      fingerprint,
      reason: input.legacyReasonOf?.(order) ?? null,
      driverSnapshot,
      orderSnapshot,
      debug: debugEnabled ? input.debugOf?.(order) : undefined,
    })
    written += 1
  })

  // Заказы, пропавшие со стадии, закрываем последним известным состоянием:
  // без этого в журнале остался бы висеть заказ, которого давно нет.
  trackedEntries.forEach((entry, key) => {
    if (entry.stage !== input.stage || seenKeys.has(key))
      return

    trackedEntries.delete(key)

    const surface = PRESENTATION_SURFACE_BY_STAGE[entry.stage]
    if (surface && entry.decision === 'VISIBLE')
      recordOrderPresentationEnded(entry.orderId, surface, entry.driverId)

    writeOrderDecision({
      event: 'ORDER_DECISION_FINAL',
      stage: entry.stage,
      decision: 'GONE',
      orderId: entry.orderId,
      driverId: entry.driverId,
      decisionMatrix: entry.decisionMatrix,
      fingerprint: entry.fingerprint,
      driverSnapshot,
      orderSnapshot: entry.orderSnapshot,
    })
    written += 1
  })

  if (trackedEntries.size)
    ensureHeartbeat()
  else
    stopHeartbeat()

  return written
}

/** Сброс состояния трекера — смена водителя, выход из сессии, тесты. */
export function resetOrderDecisionTracker() {
  trackedEntries.clear()
  stopHeartbeat()
}

/** Только для тестов: принудительный тик heartbeat без ожидания таймера. */
export function emitDecisionHeartbeatNow() {
  emitHeartbeat()
}
