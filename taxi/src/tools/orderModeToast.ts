// Канал тостов авто-режима (Строгий): короткие уведомления «что произошло» с
// иконкой машины и номером заказа. Одновременно показываем один тост; новый
// заменяет предыдущий. Автоскрытие делает компонент.

export interface IOrderModeToast {
  /** Ключ (например `${orderId}:${step}`) — повтор с тем же id не переоткрывает. */
  id: string
  /** Строка-заголовок, например «Заказ №2». */
  orderLabel: string
  /** Текст сообщения (поддерживает перевод строки \n). */
  message: string
  /** Сколько миллисекунд держать тост. */
  duration: number
}

type Listener = (toast: IOrderModeToast | null) => void

let current: IOrderModeToast | null = null
const listeners = new Set<Listener>()

export function showOrderModeToast(toast: IOrderModeToast) {
  if (current && current.id === toast.id)
    return
  current = toast
  listeners.forEach(listener => listener(current))
}

export function dismissOrderModeToast(id?: string) {
  if (id && current?.id !== id)
    return
  if (!current)
    return
  current = null
  listeners.forEach(listener => listener(null))
}

export function subscribeOrderModeToast(listener: Listener) {
  listeners.add(listener)
  listener(current)
  return () => {
    listeners.delete(listener)
  }
}
