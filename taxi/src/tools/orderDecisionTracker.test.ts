import { EUserRoles, ICar, IOrder, IUser } from '../types/types'
import { clearDecisionLog, getDecisionLogSnapshot } from './decisionLog'
import { IOrderDecisionContext } from './orderDecisionMatrix'
import {
  emitDecisionHeartbeatNow,
  resetOrderDecisionTracker,
  trackOrderDecisions,
} from './orderDecisionTracker'
import { resetOrderInteractionLog } from './orderInteractionLog'

const DRIVER_ID = 'driver-1'

function order(id: string, fields: Record<string, any> = {}): IOrder {
  return {
    b_id: id,
    b_state: 1,
    b_start_latitude: 54.7,
    b_start_longitude: 20.48,
    b_passengers_count: 1,
    drivers: [],
    ...fields,
  } as unknown as IOrder
}

function context(fields: Partial<IOrderDecisionContext> = {}): IOrderDecisionContext {
  return {
    user: { u_id: DRIVER_ID, u_role: EUserRoles.Driver } as unknown as IUser,
    car: { c_id: 'car-1', cc_id: 2 } as unknown as ICar,
    driverPosition: [54.7, 20.48],
    freeSeats: 4,
    carCapacity: 4,
    hiddenOrderIds: [],
    emulatorAnyModeRunning: true,
    externalEmulatorEnabled: false,
    ...fields,
  }
}

/** Журнал один на всех, поэтому шаги таймлайна отделяем от матриц решений. */
function entries() {
  return getDecisionLogSnapshot().entries.filter(item => item.event !== 'ORDER_INTERACTION')
}

function interactionSteps() {
  return getDecisionLogSnapshot().entries
    .filter(item => item.event === 'ORDER_INTERACTION')
    .map(item => `${item.orderId}:${item.interaction!.step}`)
}

function eventsOf(orderId: string) {
  return entries().filter(item => item.orderId === orderId).map(item => item.event)
}

beforeEach(() => {
  resetOrderDecisionTracker()
  resetOrderInteractionLog()
  clearDecisionLog()
})

afterEach(() => {
  resetOrderDecisionTracker()
})

describe('trackOrderDecisions', () => {

  it('пишет начальный снимок при первом появлении заказа', () => {
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
    })

    const [record] = entries()
    expect(record.event).toBe('ORDER_DECISION_INITIAL')
    expect(record.stage).toBe('LIST_UI')
    expect(record.decision).toBe('VISIBLE')
    expect(record.decisionMatrix.length).toBeGreaterThan(0)
  })

  it('не повторяет матрицу, пока ничего не изменилось', () => {
    const input = {
      stage: 'LIST_UI' as const,
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
    }

    trackOrderDecisions(input)
    const writtenOnSecondPoll = trackOrderDecisions(input)
    const writtenOnThirdPoll = trackOrderDecisions(input)

    expect(writtenOnSecondPoll).toBe(0)
    expect(writtenOnThirdPoll).toBe(0)
    expect(entries()).toHaveLength(1)
  })

  it('пишет изменение, когда заказ перестал быть видимым', () => {
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
    })
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a')],
      visibleOrderIds: [],
      context: context(),
    })

    expect(eventsOf('a')).toEqual(['ORDER_DECISION_INITIAL', 'ORDER_DECISION_CHANGED'])
    expect(entries()[1].decision).toBe('HIDDEN')
  })

  it('пишет изменение при значимом сдвиге значения матрицы', () => {
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a', { emptyMileageKm: 1 })],
      visibleOrderIds: ['a'],
      context: context(),
    })
    const afterTinyDrift = trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a', { emptyMileageKm: 1.01 })],
      visibleOrderIds: ['a'],
      context: context(),
    })
    const afterRealMove = trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a', { emptyMileageKm: 4 })],
      visibleOrderIds: ['a'],
      context: context(),
    })

    expect(afterTinyDrift).toBe(0)
    expect(afterRealMove).toBe(1)
  })

  it('закрывает исчезнувший заказ последним известным состоянием', () => {
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a'), order('b')],
      visibleOrderIds: ['a', 'b'],
      context: context(),
    })
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
    })

    const final = entries().find(item => item.event === 'ORDER_DECISION_FINAL')
    expect(final?.orderId).toBe('b')
    expect(final?.decision).toBe('GONE')
    expect(final?.decisionMatrix.length).toBeGreaterThan(0)
  })

  it('ведёт стадии конвейера независимо друг от друга', () => {
    trackOrderDecisions({
      stage: 'API_RESPONSE',
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
    })
    trackOrderDecisions({
      stage: 'SELECTOR',
      orders: [order('a')],
      visibleOrderIds: [],
      context: context(),
    })

    const stages = entries().map(item => `${item.stage}:${item.decision}`)
    expect(stages).toEqual(['API_RESPONSE:VISIBLE', 'SELECTOR:HIDDEN'])
  })

  it('сохраняет legacy-причину рядом с матрицей, не смешивая их', () => {
    trackOrderDecisions({
      stage: 'SELECTOR',
      orders: [order('a')],
      visibleOrderIds: [],
      context: context(),
      legacyReasonOf: () => 'hidden_by_selector_or_filter',
    })

    const [record] = entries()
    expect(record.reason).toBe('hidden_by_selector_or_filter')
    expect(record.decisionMatrix.some(item => item.key === 'requiredSeats')).toBe(true)
  })

  it('не пишет debug-payload без включённого флага', () => {
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
      debugOf: () => ({ raw: 'heavy' }),
    })

    expect(entries()[0].debug).toBeUndefined()
  })

})

describe('таймлайн взаимодействия от стадий, которые видит водитель', () => {

  it('открывает таймлайн, когда карточка появилась на экране', () => {
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
    })

    expect(interactionSteps()).toEqual(['a:PRESENTED'])
  })

  it('закрывает таймлайн, когда карточка ушла с экрана', () => {
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
    })
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [],
      visibleOrderIds: [],
      context: context(),
    })

    expect(interactionSteps()).toEqual(['a:PRESENTED', 'a:PRESENTATION_ENDED'])
  })

  it('не считает показом стадии конвейера, которых водитель не видит', () => {
    trackOrderDecisions({
      stage: 'API_RESPONSE',
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
    })
    trackOrderDecisions({
      stage: 'SELECTOR',
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
    })

    expect(interactionSteps()).toEqual([])
  })

  it('не открывает таймлайн заново, когда заказ показан и в списке, и на карте', () => {
    const input = {
      orders: [order('a')],
      visibleOrderIds: ['a'],
      context: context(),
    }
    trackOrderDecisions({ ...input, stage: 'LIST_UI' })
    trackOrderDecisions({ ...input, stage: 'MAP_UI' })

    expect(interactionSteps()).toEqual(['a:PRESENTED'])
  })

})

describe('DECISION_HEARTBEAT', () => {

  it('фиксирует, что состояние продолжало существовать, не повторяя матрицу', () => {
    trackOrderDecisions({
      stage: 'LIST_UI',
      orders: [order('a'), order('b')],
      visibleOrderIds: ['a'],
      context: context(),
    })
    emitDecisionHeartbeatNow()

    const heartbeat = entries().find(item => item.event === 'DECISION_HEARTBEAT')!
    expect(heartbeat.orders).toHaveLength(2)
    expect(heartbeat.orders?.map(item => item.decision)).toEqual(['VISIBLE', 'HIDDEN'])
    expect(heartbeat.decisionMatrix).toEqual([])
  })

  it('молчит, когда отслеживать нечего', () => {
    emitDecisionHeartbeatNow()
    expect(entries()).toHaveLength(0)
  })

})
