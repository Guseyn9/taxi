/**
 * Матрица решения по видимости заказа для водителя.
 *
 * Спецификация: `taxi/DECISION_LOG_SPEC_RU.md`, §6.
 *
 * Модуль собирает ФАКТЫ, а не причины. Каждая проверка отдаёт измеренное
 * значение, порог, с которым его сравнивали, и статус — что с этой проверкой
 * сделал код. Вывод «заказ не показан, потому что не хватило мест» здесь не
 * формулируется: его строит внешний анализатор по значениям.
 *
 * Два принципа, за которыми надо следить при правках:
 *
 * 1. Ключ со `status: NOT_IMPLEMENTED` обязан иметь `value: null`. Правило, за
 *    которым нет кода, не должно выглядеть работающим.
 * 2. `INFORMATIONAL` — значение вычисляется, но на видимость не влияет. Именно
 *    так помечены выгода (она сортирует список) и класс автомобиля (значение
 *    снимается, фильтра нет).
 */

import SITE_CONSTANTS from '../siteConstants'
import { MAX_DRIVER_VISIBLE_ORDER_DISTANCE_KM } from '../constants/orders'
import { EBookingDriverState, EUserRoles, ICar, IOrder, IUser } from '../types/types'
import { IDecisionCheck, TDecision, TDecisionCheckStatus } from './decisionLog'
import { isAlongTheWayCandidate } from './alongTheWayCandidate'
import { getOrderSeatsCount, isDriverParticipatingOrder } from './driverCapacity'
import { getOfferCount, getOrderMode, isChoiceOrder, isOfferOrder, isVotingOrder } from './driverOffer'
import {
  getOrderTrainingDriverId,
  isAnyBrowserEmulatorOrder,
  isBrowserEmulatorRunning,
  isLocalBrowserEmulatorOrder,
  shouldHideOrderFromNormalMode,
} from './emulatorMode'
import { TDriverTripPhase } from './driverTripPhase'
import { distanceBetweenEarthCoordinates } from './geo'

/** Стабильные ключи матрицы. Порядок фиксирован — он же порядок в записи журнала. */
export const DECISION_CHECK_KEYS = [
  'emulatorGate',
  'emulatorOrderScope',
  'trainingDriverTag',
  'hiddenByDriver',
  'driverParticipation',
  'pickupDistance',
  'geoZone',
  'alongTheWay',
  'detour',
  'currentRoute',
  'eta',
  'activeTrip',
  'freeSeats',
  'requiredSeats',
  'carClass',
  'orderType',
  'timeWindow',
  'driverRating',
  'driverStatus',
  'driverAvailability',
  'profitability',
  'tariffExpectedIncome',
  'orderConstraints',
  'votingPosition',
] as const

export type TDecisionCheckKey = typeof DECISION_CHECK_KEYS[number]

/**
 * Шаг квантования для определения «значимого» изменения. Влияет ТОЛЬКО на
 * решение «писать запись или нет»: в саму запись всегда попадает точное
 * значение. Без этого расстояние и выгода, которые пересчитываются на каждом
 * такте, порождали бы новую запись на каждый polling.
 */
const QUANTIZATION_BY_KEY: Partial<Record<TDecisionCheckKey, number>> = {
  // Километры → шаг 50 м.
  pickupDistance: 0.05,
  // Секунды → шаг 30 с.
  eta: 30,
  timeWindow: 30,
  // Деньги → шаг в одну единицу.
  profitability: 1,
  tariffExpectedIncome: 1,
}

/** Состояния, в которых водитель считается выполняющим поездку по заказу. */
const ACTIVE_TRIP_STATES = [
  EBookingDriverState.Performer,
  EBookingDriverState.Arrived,
  EBookingDriverState.Started,
  EBookingDriverState.Finished,
]

export interface IOrderDecisionContext {
  user?: IUser | null
  car?: ICar | null
  /** Разрешённое положение водителя — то же, что видит карта. */
  driverPosition?: [number, number] | null
  freeSeats: number
  carCapacity: number
  hiddenOrderIds?: Array<string | number> | null
  /** `isAnyBrowserEmulatorModeRunning()` на момент снимка. */
  emulatorAnyModeRunning: boolean
  /** `isExternalEmulatorEnabled()` на момент снимка. */
  externalEmulatorEnabled: boolean
  /** Заказы, по которым водитель уже сказал «не брать» (попутчики на карте). */
  declinedAlongTheWayOrderIds?: Record<string, boolean> | null
  tripPhase?: TDriverTripPhase | null
  tripTarget?: [number, number] | null
}

function toFiniteNumber(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function check(
  key: TDecisionCheckKey,
  status: TDecisionCheckStatus,
  value?: any,
  limit?: any,
): IDecisionCheck {
  return {
    key,
    status,
    // Правило спецификации: за нереализованным правилом не должно стоять
    // никакого значения, кроме null.
    value: status === 'NOT_IMPLEMENTED' ? null : (value === undefined ? null : value),
    ...(limit === undefined ? {} : { limit }),
  }
}

function notImplemented(key: TDecisionCheckKey) {
  return check(key, 'NOT_IMPLEMENTED')
}

function getDriverInOrder(order: IOrder, userId?: IUser['u_id'] | null) {
  if (userId === undefined || userId === null)
    return undefined

  return order?.drivers?.find(driver => String(driver.u_id) === String(userId))
}

function isCurrentDriverActiveTrip(order: IOrder, userId?: IUser['u_id'] | null) {
  const state = getDriverInOrder(order, userId)?.c_state
  return state !== undefined && ACTIVE_TRIP_STATES.includes(state)
}

function getOrderStartPoint(order: IOrder): [number, number] | null {
  const latitude = toFiniteNumber(order?.b_start_latitude)
  const longitude = toFiniteNumber(order?.b_start_longitude)
  return latitude && longitude ? [latitude, longitude] : null
}

/**
 * Холостой пробег до точки подачи. Приоритет у оценки селектора
 * (`emptyMileageKm`, считается по графу дорог) — по ней же работает фильтр
 * видимости. Прямая линия — запасной вариант, когда оценки ещё нет.
 */
function getPickupDistanceKm(order: IOrder, context: IOrderDecisionContext) {
  const estimated = toFiniteNumber((order as any).emptyMileageKm)
  if (estimated !== null)
    return { km: estimated, measure: 'route_empty_mileage' as const }

  const startPoint = getOrderStartPoint(order)
  const driverPosition = context.driverPosition
  if (!startPoint || !driverPosition)
    return { km: null, measure: 'unavailable' as const }

  return {
    km: distanceBetweenEarthCoordinates(
      driverPosition[0],
      driverPosition[1],
      startPoint[0],
      startPoint[1],
    ),
    measure: 'straight_line' as const,
  }
}

function buildPickupDistanceCheck(order: IOrder, context: IOrderDecisionContext): IDecisionCheck {
  const { km, measure } = getPickupDistanceKm(order, context)
  const value = { km, measure }
  const limit = MAX_DRIVER_VISIBLE_ORDER_DISTANCE_KM

  // Во внешнем режиме эмулятора фильтр расстояния не выполняется вовсе:
  // тестировщик может быть в другом городе. Это факт о ветке кода, а не о заказе.
  if (context.externalEmulatorEnabled)
    return check('pickupDistance', 'SKIPPED', value, limit)

  if (km === null)
    return check('pickupDistance', 'UNKNOWN', value, limit)

  if (km <= limit)
    return check('pickupDistance', 'PASS', value, limit)

  // Заказ дальше порога, но водитель его уже выполняет — код оставляет его
  // видимым. Анализатор увидит value > limit при status PASS и activeTrip = true.
  return check(
    'pickupDistance',
    isCurrentDriverActiveTrip(order, context.user?.u_id) ? 'PASS' : 'FAIL',
    value,
    limit,
  )
}

function buildEmulatorGateCheck(context: IOrderDecisionContext): IDecisionCheck {
  const isDriver = context.user?.u_role === EUserRoles.Driver
  const value = {
    driverRole: isDriver,
    emulatorAnyModeRunning: context.emulatorAnyModeRunning,
    externalEmulatorEnabled: context.externalEmulatorEnabled,
  }

  if (!isDriver)
    return check('emulatorGate', 'SKIPPED', value)

  const forcedEmpty = !context.emulatorAnyModeRunning && !context.externalEmulatorEnabled
  return check('emulatorGate', forcedEmpty ? 'FAIL' : 'PASS', value)
}

function buildEmulatorOrderScopeCheck(order: IOrder): IDecisionCheck {
  const clientMode = isBrowserEmulatorRunning('clients')
  const driverMode = isBrowserEmulatorRunning('drivers')
  const value = {
    isEmulatorOrder: isAnyBrowserEmulatorOrder(order),
    clientModeRunning: clientMode,
    driverModeRunning: driverMode,
    localToClientMode: clientMode ? isLocalBrowserEmulatorOrder(order, 'clients') : null,
    localToDriverMode: driverMode ? isLocalBrowserEmulatorOrder(order, 'drivers') : null,
    hiddenFromNormalMode: shouldHideOrderFromNormalMode(order),
  }

  if (clientMode)
    return check('emulatorOrderScope', value.localToClientMode ? 'PASS' : 'FAIL', value)

  if (driverMode)
    return check('emulatorOrderScope', value.localToDriverMode ? 'PASS' : 'FAIL', value)

  return check('emulatorOrderScope', value.hiddenFromNormalMode ? 'FAIL' : 'PASS', value)
}

function buildTrainingDriverTagCheck(order: IOrder, context: IOrderDecisionContext): IDecisionCheck {
  const target = getOrderTrainingDriverId(order)
  const driverId = context.user?.u_id ?? null
  const value = { orderTag: target, driverId }

  if (!context.externalEmulatorEnabled)
    return check('trainingDriverTag', 'SKIPPED', value)

  if (!target || !driverId)
    return check('trainingDriverTag', 'PASS', value)

  if (String(target) === String(driverId))
    return check('trainingDriverTag', 'PASS', value)

  // Чужой тренировочный заказ остаётся видимым, если водитель уже в нём участвует.
  return check(
    'trainingDriverTag',
    isDriverParticipatingOrder(order, driverId) ? 'PASS' : 'FAIL',
    value,
  )
}

function buildHiddenByDriverCheck(order: IOrder, context: IOrderDecisionContext): IDecisionCheck {
  const hidden = (context.hiddenOrderIds ?? []).some(id => String(id) === String(order.b_id))
  return check('hiddenByDriver', hidden ? 'FAIL' : 'PASS', { hidden })
}

function buildTimeWindowCheck(order: IOrder): IDecisionCheck {
  const remainingLifetimeSeconds = toFiniteNumber(order.remaining_lifetime_seconds)
  const createdAt = toFiniteNumber(order.b_created) ?? 0
  const startAt = toFiniteNumber(order.b_start_datetime) ?? 0
  const maxWaitingSeconds = toFiniteNumber(order.b_max_waiting) ?? SITE_CONSTANTS.WAITING_INTERVAL
  const startedAt = Math.max(createdAt, startAt)
  const deadlineMs = startedAt ? startedAt + maxWaitingSeconds * 1000 : null

  const value = {
    remainingLifetimeSeconds,
    maxWaitingSeconds,
    startedAt: startedAt || null,
    deadlineMs,
    nowMs: Date.now(),
  }

  // Срок жизни проверяется только у голосований — остальные виды заказов эту
  // ветку кода не проходят.
  if (!isVotingOrder(order))
    return check('timeWindow', 'SKIPPED', value)

  const hasSelectedDriver = !!order.drivers?.some(driver => ACTIVE_TRIP_STATES.includes(driver.c_state))
  if (hasSelectedDriver)
    return check('timeWindow', 'PASS', value)

  if (remainingLifetimeSeconds !== null && remainingLifetimeSeconds <= 0)
    return check('timeWindow', 'FAIL', value)

  if (deadlineMs === null)
    return check('timeWindow', 'UNKNOWN', value)

  return check('timeWindow', deadlineMs <= Date.now() ? 'FAIL' : 'PASS', value)
}

function buildVotingPositionCheck(order: IOrder, context: IOrderDecisionContext): IDecisionCheck {
  const driverInOrder = getDriverInOrder(order, context.user?.u_id)

  return check('votingPosition', 'INFORMATIONAL', {
    driverStateInOrder: driverInOrder?.c_state ?? null,
    isConsidering: driverInOrder?.c_state === EBookingDriverState.Considering,
    candidatesCount: order.drivers?.length ?? 0,
    offerCount: getOfferCount(order),
    // Позиция водителя в очереди голосования не вычисляется ни на клиенте, ни в
    // ответе бэкенда. null — это факт отсутствия данных, а не «первое место».
    positionInQueue: null,
  })
}

/**
 * Полная матрица по одному заказу. Порядок ключей совпадает с
 * {@link DECISION_CHECK_KEYS}.
 */
export function buildOrderDecisionMatrix(
  order: IOrder,
  context: IOrderDecisionContext,
): IDecisionCheck[] {
  const userId = context.user?.u_id ?? null
  const requiredSeats = getOrderSeatsCount(order)
  const participating = isDriverParticipatingOrder(order, userId ?? undefined)
  const activeTrip = isCurrentDriverActiveTrip(order, userId)

  return [
    buildEmulatorGateCheck(context),
    buildEmulatorOrderScopeCheck(order),
    buildTrainingDriverTagCheck(order, context),
    buildHiddenByDriverCheck(order, context),

    check('driverParticipation', 'INFORMATIONAL', {
      participating,
      driverStateInOrder: getDriverInOrder(order, userId)?.c_state ?? null,
    }),

    buildPickupDistanceCheck(order, context),

    // Зоны между точками считаются (`getAreasBetweenPoints`), но на видимость
    // заказа не влияют — правила зон нет.
    notImplemented('geoZone'),

    check('alongTheWay', 'INFORMATIONAL', {
      isCandidate: isAlongTheWayCandidate(order, {
        userId,
        freeSeats: context.freeSeats,
        declinedOrderIds: context.declinedAlongTheWayOrderIds ?? null,
      }),
      tripPhase: context.tripPhase ?? null,
    }),

    notImplemented('detour'),

    check('currentRoute', 'INFORMATIONAL', {
      tripPhase: context.tripPhase ?? null,
      tripTarget: context.tripTarget ?? null,
    }),

    notImplemented('eta'),

    check('activeTrip', 'INFORMATIONAL', { activeTrip }),

    check('freeSeats', 'INFORMATIONAL', { freeSeats: context.freeSeats }, context.carCapacity),

    // Единственный гейт по местам: заказ проходит, если помещается в остаток
    // или если водитель уже в нём участвует.
    check(
      'requiredSeats',
      participating || requiredSeats <= context.freeSeats ? 'PASS' : 'FAIL',
      { requiredSeats, participating },
      context.freeSeats,
    ),

    check('carClass', 'INFORMATIONAL', {
      orderClassId: (order as any).b_car_class ?? (order as any).b_car_class_id ?? (order as any).cc_id ?? null,
      driverClassId: (context.car as any)?.cc_id ??
        (context.car as any)?.c_class_id ??
        (context.car as any)?.car_class_id ?? null,
    }),

    check('orderType', 'INFORMATIONAL', {
      mode: getOrderMode(order),
      voting: isVotingOrder(order),
      offer: isOfferOrder(order),
      choice: isChoiceOrder(order),
      state: order.b_state ?? null,
    }),

    buildTimeWindowCheck(order),

    notImplemented('driverRating'),

    check('driverStatus', 'INFORMATIONAL', {
      role: context.user?.u_role ?? null,
      active: context.user?.u_active ?? null,
      outDrive: (context.user as any)?.out_drive ?? null,
      city: context.user?.u_city ?? null,
    }),

    // Правила доступности водителя (смена, перерыв, блокировка) в коде нет —
    // сейчас доступность определяется только эмуляторным гейтом выше.
    notImplemented('driverAvailability'),

    check('profitability', 'INFORMATIONAL', {
      profit: toFiniteNumber(order.profit),
      profitRank: (order as any).profitRank ?? null,
      profitPerEmptyKm: toFiniteNumber((order as any).profitPerEmptyKm),
      profitSortValue: toFiniteNumber((order as any).profitSortValue),
      routeMileageKm: toFiniteNumber((order as any).routeMileageKm),
    }),

    check('tariffExpectedIncome', 'INFORMATIONAL', {
      priceEstimate: toFiniteNumber(order.b_price_estimate),
      tips: toFiniteNumber(order.b_tips),
      customerPrice: toFiniteNumber((order.b_options as any)?.customer_price),
      performersPrice: toFiniteNumber((order.b_options as any)?.performers_price),
    }),

    check('orderConstraints', 'INFORMATIONAL', {
      passengersCount: toFiniteNumber(order.b_passengers_count),
      comments: order.b_comments ?? null,
      locationClass: (order as any).b_location_class ?? null,
    }),

    buildVotingPositionCheck(order, context),
  ]
}

/** Квантует числовые листья значения по шагу ключа. Только для отпечатка. */
function quantize(value: any, step: number | undefined): any {
  if (step === undefined)
    return value

  if (typeof value === 'number')
    return Number.isFinite(value) ? Math.round(value / step) : null

  if (Array.isArray(value))
    return value.map(item => quantize(item, step))

  if (value && typeof value === 'object') {
    const output: Record<string, any> = {}
    Object.keys(value).sort().forEach(key => {
      output[key] = quantize(value[key], step)
    })
    return output
  }

  return value
}

/**
 * Отпечаток матрицы: по нему трекер понимает, изменилось ли решение. Числа
 * округляются по шагу ключа, поэтому дрожание расстояния и выгоды между тактами
 * новую запись не порождает.
 *
 * `nowMs` из проверки временного окна из отпечатка исключён: он меняется всегда
 * и один сделал бы дедупликацию бессмысленной.
 */
export function buildDecisionFingerprint(checks: IDecisionCheck[], decision: TDecision): string {
  const parts = checks.map(item => {
    const step = QUANTIZATION_BY_KEY[item.key as TDecisionCheckKey]
    const value = item.key === 'timeWindow' && item.value && typeof item.value === 'object' ?
      { ...(item.value as Record<string, any>), nowMs: undefined } :
      item.value

    return `${item.key}:${item.status}:${JSON.stringify(quantize(value, step) ?? null)}`
  })

  return `${decision}|${parts.join('|')}`
}

/** Компактный снимок водителя — общий для всех записей одного такта. */
export function buildDriverSnapshot(context: IOrderDecisionContext) {
  return {
    driverId: context.user?.u_id ?? null,
    role: context.user?.u_role ?? null,
    active: context.user?.u_active ?? null,
    city: context.user?.u_city ?? null,
    position: context.driverPosition ?? null,
    freeSeats: context.freeSeats,
    carCapacity: context.carCapacity,
    carId: (context.car as any)?.c_id ?? null,
    carClassId: (context.car as any)?.cc_id ?? null,
    tripPhase: context.tripPhase ?? null,
    emulatorAnyModeRunning: context.emulatorAnyModeRunning,
    externalEmulatorEnabled: context.externalEmulatorEnabled,
  }
}

/** Компактный снимок заказа. Полный объект уходит только в debug-payload. */
export function buildOrderSnapshot(order: IOrder) {
  return {
    orderId: order.b_id ?? null,
    state: order.b_state ?? null,
    startPoint: getOrderStartPoint(order),
    destinationPoint: [
      toFiniteNumber(order.b_destination_latitude),
      toFiniteNumber(order.b_destination_longitude),
    ],
    startAddress: order.b_start_address ?? null,
    destinationAddress: order.b_destination_address ?? null,
    passengersCount: toFiniteNumber(order.b_passengers_count),
    driversCount: order.drivers?.length ?? 0,
    createdAt: toFiniteNumber(order.b_created),
  }
}
