import { IOrder } from '../types/types'

/**
 * Короткий id заказа.
 *
 * Водителю проще держать в голове несколько последних цифр id, чем весь id
 * целиком. Берём минимальное количество последних цифр, которого достаточно,
 * чтобы отличить заказ от остальных заказов из набора (по умолчанию — активные
 * заказы водителя). Полный id при этом показываем разбитым на префикс и суффикс
 * (`12345-67`), а на плашке карточки — только суффикс (`67`).
 */

export interface IOrderIdParts {
  /** Начало id без короткого суффикса (может быть пустым) */
  prefix: string
  /** Короткий уникальный суффикс — то, что видит/запоминает водитель */
  suffix: string
}

/**
 * Минимальная длина последних цифр `targetId`, которой хватает, чтобы отличить
 * его от всех остальных id из `poolIds`. Нижней границы нет: если в наборе нет
 * других заказов, хватает одной цифры.
 */
export function getOrderShortIdLength(
  targetId: IOrder['b_id'] | number | null | undefined,
  poolIds: Array<IOrder['b_id'] | number>,
): number {
  const target = String(targetId ?? '')
  if (!target) return 0

  const others = poolIds
    .map(id => String(id))
    .filter(id => id !== target)

  if (others.length === 0) return 1

  const maxLen = target.length
  let len = 1
  while (len < maxLen) {
    const targetSuffix = target.slice(-len)
    const hasCollision = others.some(id => id.slice(-len) === targetSuffix)
    if (!hasCollision) break
    len++
  }
  return len
}

/**
 * Разбивает id на префикс и короткий уникальный суффикс относительно `poolIds`.
 */
export function getOrderIdParts(
  targetId: IOrder['b_id'] | number | null | undefined,
  poolIds: Array<IOrder['b_id'] | number>,
): IOrderIdParts {
  const target = String(targetId ?? '')
  if (!target) return { prefix: '', suffix: '' }

  const len = getOrderShortIdLength(target, poolIds)
  return {
    prefix: target.slice(0, target.length - len),
    suffix: target.slice(-len),
  }
}
