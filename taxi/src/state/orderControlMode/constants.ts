import { appName } from '../../constants'

export const moduleName = 'orderControlMode'

const prefix = `${appName}/${moduleName}`

/**
 * Режимы управления заказами (со стороны водителя):
 * - Manual — классический ручной режим (по умолчанию), водитель сам берёт заказы.
 * - Realistic — полуручной: водителю предлагается взять заказ, кнопка «Поехал»
 *   с таймером; если решение не принято — заказ берётся автоматически.
 * - Strict — строгий/автоматический: подходящий заказ берётся автоматически,
 *   водителя уведомляют.
 */
export enum EOrderControlMode {
  Manual = 'manual',
  Realistic = 'realistic',
  Strict = 'strict',
}

export const DEFAULT_ORDER_CONTROL_MODE = EOrderControlMode.Manual

/** Порядок циклического переключения по нажатию на кнопку. */
export const ORDER_CONTROL_MODE_ORDER: EOrderControlMode[] = [
  EOrderControlMode.Manual,
  EOrderControlMode.Realistic,
  EOrderControlMode.Strict,
]

export const STORAGE_KEY = 'orderControlMode'

export const ActionTypes = {
  SET_ORDER_CONTROL_MODE: `${prefix}/SET_ORDER_CONTROL_MODE`,
} as const

export interface IOrderControlModeState {
  mode: EOrderControlMode
}
