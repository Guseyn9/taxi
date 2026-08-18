// Единый канал «окно-решения» для авто-режимов управления заказами (Реалистичный).
// Модель проста: любой участник (контейнер водителя — взятие, карта — шаги поездки)
// просит показать окно с описанием действия и двумя кнопками; по таймеру или по
// нажатию основной кнопки вызывается onConfirm, по второй — onCancel.

export interface IOrderModeDecisionRequest {
  /** Ключ дедупликации (например `${orderId}:${step}`) — повторный запрос с тем же id не переоткрывает окно. */
  id: string
  /**
   * Строка-подпись заказа, например «Заказ №12345-67». Водитель может вести
   * несколько заказов сразу, поэтому окно должно называть, о каком именно
   * заказе спрашивают.
   */
  orderLabel?: string
  /** Заголовок окна. */
  title: string
  /** Описание действия. */
  description: string
  /** Текст основной кнопки (действие). */
  actionText: string
  /** Текст второй кнопки (отказ/отмена). */
  cancelText: string
  /** Сколько секунд до авто-подтверждения. */
  seconds: number
  /** Действие при подтверждении (клик или истечение таймера). */
  onConfirm: () => void
  /** Действие при отказе. */
  onCancel: () => void
}

type Listener = (request: IOrderModeDecisionRequest | null) => void

let current: IOrderModeDecisionRequest | null = null
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach(listener => listener(current))
}

export function requestOrderModeDecision(request: IOrderModeDecisionRequest) {
  // Тот же шаг уже показывается — обновляем обработчики (могли обновиться замыкания),
  // но окно не переоткрываем и таймер не сбрасываем.
  if (current && current.id === request.id) {
    current = { ...current, onConfirm: request.onConfirm, onCancel: request.onCancel }
    return
  }
  current = request
  emit()
}

export function dismissOrderModeDecision(id?: string) {
  if (id && current?.id !== id)
    return
  if (!current)
    return
  current = null
  emit()
}

export function getCurrentDecisionId(): string | undefined {
  return current?.id
}

export function subscribeOrderModeDecision(listener: Listener) {
  listeners.add(listener)
  listener(current)
  return () => {
    listeners.delete(listener)
  }
}
