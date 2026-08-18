import { appName } from '../../constants'

export const moduleName = 'orderControlMode'

const prefix = `${appName}/${moduleName}`

/**
 * Режимы управления заказами (со стороны водителя):
 * - Manual — классический ручной режим (по умолчанию), водитель сам берёт заказы.
 * - Realistic — полуручной: водителю предлагается взять заказ, кнопка с таймером;
 *   если решение не принято, оно принимается за него — куда именно, задаёт
 *   подтип {@link ERealisticSubMode}.
 * - Strict — строгий/автоматический: подходящий заказ берётся автоматически,
 *   водителя уведомляют.
 */
export enum EOrderControlMode {
  Manual = 'manual',
  Realistic = 'realistic',
  Strict = 'strict',
}

/**
 * Подтип Реалистичного режима — куда «падает» решение, если водитель промолчал:
 * - Plus — таймер на кнопке действия, по истечении действие выполняется (как было раньше).
 * - Minus — таймер на кнопке отказа, по истечении заказ/поездка отменяется.
 * Отдельной иконки у подтипа нет: он спрашивается окном при выборе Реалистичного.
 */
export enum ERealisticSubMode {
  Plus = 'plus',
  Minus = 'minus',
}

export const DEFAULT_ORDER_CONTROL_MODE = EOrderControlMode.Manual

export const DEFAULT_REALISTIC_SUB_MODE = ERealisticSubMode.Plus

export const REALISTIC_SUB_MODES: ERealisticSubMode[] = [
  ERealisticSubMode.Plus,
  ERealisticSubMode.Minus,
]

/** Порядок циклического переключения по нажатию на кнопку. */
export const ORDER_CONTROL_MODE_ORDER: EOrderControlMode[] = [
  EOrderControlMode.Manual,
  EOrderControlMode.Realistic,
  EOrderControlMode.Strict,
]

export const STORAGE_KEY = 'orderControlMode'

export const SUB_MODE_STORAGE_KEY = 'orderControlModeRealisticSubMode'

export const ActionTypes = {
  SET_ORDER_CONTROL_MODE: `${prefix}/SET_ORDER_CONTROL_MODE`,
  SET_REALISTIC_SUB_MODE: `${prefix}/SET_REALISTIC_SUB_MODE`,
} as const

export interface IOrderControlModeState {
  mode: EOrderControlMode
  realisticSubMode: ERealisticSubMode
}
