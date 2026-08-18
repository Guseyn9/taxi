/**
 * Сбор контекста для матрицы решений.
 *
 * Матрица (`orderDecisionMatrix.ts`) намеренно ничего не знает о глобальном
 * состоянии — иначе её нельзя было бы прогнать в тесте. Всё, что приходится
 * читать из шин и хранилищ (положение водителя, фаза поездки, флаги эмулятора,
 * скрытые заказы), собирается здесь, в одном месте для саги и обоих экранов
 * водителя.
 */

import { ICar, IOrder, IUser } from '../types/types'
import { getCarCapacity, getDriverFreeSeats } from './driverCapacity'
import { getDriverPosition } from './driverPosition'
import { getDriverTrip } from './driverTripPhase'
import { isAnyBrowserEmulatorModeRunning, isExternalEmulatorEnabled } from './emulatorMode'
import { IOrderDecisionContext } from './orderDecisionMatrix'

/** Заказы, скрытые самим водителем. Хранилище общее с `addHiddenOrder`. */
export function getHiddenOrderIds(userId?: IUser['u_id'] | null): string[] {
  if (!userId || typeof window === 'undefined')
    return []

  try {
    const hiddenOrders = JSON.parse(window.localStorage.getItem('hiddenOrders') || '{}')
    return Array.isArray(hiddenOrders?.[userId]) ? hiddenOrders[userId] : []
  } catch {
    return []
  }
}

export interface IBuildOrderDecisionContextInput {
  user?: IUser | null
  car?: ICar | null
  /** Активные заказы водителя — по ним считается занятость мест. */
  activeOrders?: IOrder[] | null
  /** Позиция из redux, если шина водителя ещё молчит (например, в саге). */
  fallbackPosition?: [number, number] | null
  /** Уже посчитанные экраном значения — чтобы не считать их дважды. */
  freeSeats?: number
  carCapacity?: number
  hiddenOrderIds?: Array<string | number> | null
  declinedAlongTheWayOrderIds?: Record<string, boolean> | null
}

export function buildOrderDecisionContext(
  input: IBuildOrderDecisionContextInput,
): IOrderDecisionContext {
  const trip = getDriverTrip()

  return {
    user: input.user ?? null,
    car: input.car ?? null,
    driverPosition: getDriverPosition() ?? input.fallbackPosition ?? null,
    freeSeats: input.freeSeats ?? getDriverFreeSeats(input.car, input.activeOrders, input.user?.u_id),
    carCapacity: input.carCapacity ?? getCarCapacity(input.car),
    hiddenOrderIds: input.hiddenOrderIds ?? getHiddenOrderIds(input.user?.u_id),
    emulatorAnyModeRunning: isAnyBrowserEmulatorModeRunning(),
    externalEmulatorEnabled: isExternalEmulatorEnabled(),
    declinedAlongTheWayOrderIds: input.declinedAlongTheWayOrderIds ?? null,
    tripPhase: trip.phase,
    tripTarget: trip.target,
  }
}

/** Уникальные заказы, дошедшие до входа стадии. */
export function mergeDecisionStageOrders(...groups: Array<IOrder[] | null | undefined>): IOrder[] {
  const byId = new Map<string, IOrder>()

  groups.forEach(group => (group ?? []).forEach(order => {
    if (order?.b_id)
      byId.set(String(order.b_id), order)
  }))

  return Array.from(byId.values())
}
