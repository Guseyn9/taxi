/**
 * Метки «этот заказ отменил сам водитель».
 *
 * Watcher'ы на странице водителя видят только результат — заказ пропал из
 * активных или пришёл в состоянии Canceled — и по умолчанию трактуют это как
 * отмену клиентом. Когда отмену инициировал сам водитель, он уже получил своё
 * окно («Поездка отменена»), и второе окно «Клиент отменил заказ» было бы
 * прямой неправдой. Отменяющий код ставит метку, watcher'ы её проверяют.
 *
 * Метка живёт в localStorage, потому что между запросом на отмену и следующим
 * опросом заказов возможны переход на другую страницу и перемонтирование
 * компонентов; ref в React такое не переживает.
 */

import { IOrder, IUser } from '../types/types'

const STORAGE_KEY = 'driverSelfCancelledOrders'
/** Заведомо больше интервала опроса заказов, но недостаточно, чтобы дожить до следующего заказа с тем же id. */
const SELF_CANCEL_LIFETIME_MS = 15 * 60 * 1000

function canUseLocalStorage() {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage)
  } catch {
    return false
  }
}

function markKey(orderId: IOrder['b_id'], userId?: IUser['u_id'] | null) {
  return `${userId ?? ''}:${orderId}`
}

function readMarks(): Record<string, number> {
  try {
    if (!canUseLocalStorage())
      return {}

    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {}

    const now = Date.now()
    return Object.entries(parsed as Record<string, unknown>)
      .reduce<Record<string, number>>((result, [key, value]) => {
        const timestamp = Number(value)
        if (Number.isFinite(timestamp) && now - timestamp < SELF_CANCEL_LIFETIME_MS)
          result[key] = timestamp
        return result
      }, {})
  } catch {
    return {}
  }
}

function writeMarks(marks: Record<string, number>) {
  try {
    if (!canUseLocalStorage())
      return

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(marks))
  } catch {
    // storage is optional
  }
}

/** Поставить метку — вызывается перед запросом на отмену, чтобы опрос между запросом и ответом тоже молчал. */
export function markOrderCancelledByDriver(orderId?: IOrder['b_id'] | null, userId?: IUser['u_id'] | null) {
  if (!orderId)
    return

  const marks = readMarks()
  marks[markKey(orderId, userId)] = Date.now()
  writeMarks(marks)
}

/**
 * Есть ли метка. Если userId неизвестен, подходит метка любого водителя по
 * этому заказу — в браузере активна одна сессия водителя.
 */
export function wasOrderCancelledByDriver(orderId?: IOrder['b_id'] | null, userId?: IUser['u_id'] | null) {
  if (!orderId)
    return false

  const marks = readMarks()
  if (userId !== undefined && userId !== null)
    return Boolean(marks[markKey(orderId, userId)])

  const suffix = `:${orderId}`
  return Object.keys(marks).some(key => key.endsWith(suffix))
}

/** Снять метку — если отмена не удалась, заказ жив и настоящую отмену клиентом прятать нельзя. */
export function clearOrderCancelledByDriver(orderId?: IOrder['b_id'] | null, userId?: IUser['u_id'] | null) {
  if (!orderId)
    return

  const marks = readMarks()
  const key = markKey(orderId, userId)
  if (marks[key] === undefined)
    return

  delete marks[key]
  writeMarks(marks)
}
