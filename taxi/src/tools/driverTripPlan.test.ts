import { EBookingDriverState, IOrder } from '../types/types'
import {
  ETripStopKind,
  buildDriverTripPlan,
  getTripActionStop,
  getTripPlanKey,
  getTripPlanOrderIds,
  getTripStopKey,
  isFinalTripStop,
} from './driverTripPlan'

const DRIVER_ID = 'driver-1'

/** Все точки на одной широте, поэтому расстояние пропорционально сдвигу долготы. */
const LAT = 55
const at = (lngOffset: number): [number, number] => [LAT, 37 + lngOffset]
const DRIVER_AT_START: [number, number] = at(0)

function order(
  id: string,
  options: {
    state?: EBookingDriverState
    pickup?: number
    dropoff?: number
  } = {},
): IOrder {
  const { state, pickup, dropoff } = options

  return {
    b_id: id,
    b_start_latitude: pickup === undefined ? undefined : LAT,
    b_start_longitude: pickup === undefined ? undefined : 37 + pickup,
    b_destination_latitude: dropoff === undefined ? undefined : LAT,
    b_destination_longitude: dropoff === undefined ? undefined : 37 + dropoff,
    drivers: state === undefined ? [] : [{ u_id: DRIVER_ID, c_state: state }],
  } as unknown as IOrder
}

const plan = (activeOrders: IOrder[], rest: Parameters<typeof buildDriverTripPlan>[0] = {}) =>
  buildDriverTripPlan({
    activeOrders,
    userId: DRIVER_ID,
    position: DRIVER_AT_START,
    ...rest,
  })

const keys = (stops: ReturnType<typeof buildDriverTripPlan>) => stops.map(getTripStopKey)

describe('buildDriverTripPlan — один заказ', () => {

  it('взятый заказ даёт посадку, затем высадку', () => {
    const stops = plan([order('A', { state: EBookingDriverState.Performer, pickup: 0.01, dropoff: 0.02 })])

    expect(keys(stops)).toEqual(['A:pickup', 'A:dropoff'])
  })

  it('пассажир в салоне — остаётся только высадка', () => {
    const stops = plan([order('A', { state: EBookingDriverState.Started, pickup: 0.01, dropoff: 0.02 })])

    expect(keys(stops)).toEqual(['A:dropoff'])
  })

  it('высадка не может опередить свою посадку, даже если она ближе', () => {
    const stops = plan([order('A', { state: EBookingDriverState.Performer, pickup: 0.09, dropoff: 0.01 })])

    expect(keys(stops)).toEqual(['A:pickup', 'A:dropoff'])
  })

  it('голосовой заказ с подтверждённым кодом считается посаженным', () => {
    const stops = plan(
      [order('A', { state: EBookingDriverState.Performer, pickup: 0.01, dropoff: 0.02 })],
      { boardedOrderIds: ['A'] },
    )

    expect(keys(stops)).toEqual(['A:dropoff'])
  })

  // Test 5 ТЗ DRIVER-BOARDING-001: подтверждают код именно из Arrived — маршрут
  // после подтверждения должен вести к точке высадки, а не обратно к посадке.
  it('код подтверждён из Arrived — маршрут ведёт к точке высадки', () => {
    const arrived = [order('A', { state: EBookingDriverState.Arrived, pickup: 0.01, dropoff: 0.02 })]

    expect(keys(plan(arrived))).toEqual(['A:pickup', 'A:dropoff'])
    expect(keys(plan(arrived, { boardedOrderIds: ['A'] }))).toEqual(['A:dropoff'])
  })

})

describe('buildDriverTripPlan — попутные заказы', () => {

  it('сценарий 1: попутный по пути к высадке — сначала везём первого клиента', () => {
    // A уже в салоне и едет к 0.05; попутчик B ждёт на 0.02, его цель — 0.10.
    const stops = plan([
      order('A', { state: EBookingDriverState.Started, pickup: 0.01, dropoff: 0.05 }),
      order('B', { state: EBookingDriverState.Performer, pickup: 0.02, dropoff: 0.10 }),
    ])

    expect(keys(stops)).toEqual(['B:pickup', 'A:dropoff', 'B:dropoff'])
  })

  it('сценарий 2: попутного забираем по пути к клиенту и высаживаем первым, если он ближе', () => {
    // Едем за A на 0.06, по пути попутчик B на 0.02 с высадкой на 0.04.
    const stops = plan([
      order('A', { state: EBookingDriverState.Performer, pickup: 0.06, dropoff: 0.10 }),
      order('B', { state: EBookingDriverState.Performer, pickup: 0.02, dropoff: 0.04 }),
    ])

    expect(keys(stops)).toEqual(['B:pickup', 'B:dropoff', 'A:pickup', 'A:dropoff'])
  })

  it('сценарий 2: если высадка попутчика дальше клиента — сначала забираем клиента', () => {
    // То же, но цель попутчика (0.20) дальше, чем оставшийся путь к A (0.06).
    const stops = plan([
      order('A', { state: EBookingDriverState.Performer, pickup: 0.06, dropoff: 0.08 }),
      order('B', { state: EBookingDriverState.Performer, pickup: 0.02, dropoff: 0.20 }),
    ])

    expect(keys(stops)).toEqual(['B:pickup', 'A:pickup', 'A:dropoff', 'B:dropoff'])
  })

  it('когда все в салоне, первым выходит тот, чья высадка ближе', () => {
    const stops = plan([
      order('A', { state: EBookingDriverState.Started, pickup: 0.01, dropoff: 0.10 }),
      order('B', { state: EBookingDriverState.Started, pickup: 0.02, dropoff: 0.03 }),
    ])

    expect(keys(stops)).toEqual(['B:dropoff', 'A:dropoff'])
  })

  it('кандидат даёт только точку посадки и помечен pending', () => {
    const stops = plan(
      [order('A', { state: EBookingDriverState.Started, pickup: 0.01, dropoff: 0.05 })],
      { candidateOrders: [order('B', { pickup: 0.02, dropoff: 0.10 })] },
    )

    expect(keys(stops)).toEqual(['B:pickup', 'A:dropoff'])
    expect(stops[0].pending).toBe(true)
    expect(stops[1].pending).toBeUndefined()
  })

  it('кандидат, который водитель уже выполняет, не дублируется', () => {
    const taken = order('B', { state: EBookingDriverState.Performer, pickup: 0.02, dropoff: 0.04 })
    const stops = plan([taken], { candidateOrders: [taken] })

    expect(keys(stops)).toEqual(['B:pickup', 'B:dropoff'])
  })

})

describe('getTripActionStop — точка шага поездки', () => {

  it('обычный план — шаг относится к ближайшей точке', () => {
    const stops = plan([order('A', { state: EBookingDriverState.Performer, pickup: 0.01, dropoff: 0.02 })])

    expect(getTripStopKey(getTripActionStop(stops)!)).toBe('A:pickup')
  })

  it('попутчик первой точкой не забирает себе кнопку взятого заказа', () => {
    // Иначе водитель не смог бы нажать «Поехал» по A и маркер бы не тронулся.
    const stops = plan(
      [order('A', { state: EBookingDriverState.Performer, pickup: 0.06, dropoff: 0.08 })],
      { candidateOrders: [order('B', { pickup: 0.02, dropoff: 0.04 })] },
    )

    expect(keys(stops)).toEqual(['B:pickup', 'A:pickup', 'A:dropoff'])
    expect(getTripStopKey(getTripActionStop(stops)!)).toBe('A:pickup')
  })

  it('план только из кандидатов не даёт точки шага', () => {
    const stops = plan([], { candidateOrders: [order('B', { pickup: 0.02 })] })

    expect(getTripActionStop(stops)).toBeNull()
  })

  it('пустой план не даёт точки шага', () => {
    expect(getTripActionStop([])).toBeNull()
  })

})

describe('isFinalTripStop — промежуточная высадка или конец поездки', () => {

  it('одна оставшаяся точка — поездка на этом кончится', () => {
    const stops = plan([order('A', { state: EBookingDriverState.Started, pickup: 0.01, dropoff: 0.05 })])

    expect(keys(stops)).toEqual(['A:dropoff'])
    expect(isFinalTripStop(stops)).toBe(true)
  })

  it('двое в салоне — первая высадка промежуточная', () => {
    const stops = plan([
      order('A', { state: EBookingDriverState.Started, pickup: 0.01, dropoff: 0.10 }),
      order('B', { state: EBookingDriverState.Started, pickup: 0.02, dropoff: 0.03 }),
    ])

    expect(keys(stops)).toEqual(['B:dropoff', 'A:dropoff'])
    expect(isFinalTripStop(stops)).toBe(false)
  })

  it('кандидат в попутчики поездку не продлевает — решение по нему ещё не принято', () => {
    const stops = plan(
      [order('A', { state: EBookingDriverState.Started, pickup: 0.01, dropoff: 0.05 })],
      { candidateOrders: [order('B', { pickup: 0.02, dropoff: 0.10 })] },
    )

    expect(keys(stops)).toEqual(['B:pickup', 'A:dropoff'])
    expect(isFinalTripStop(stops)).toBe(true)
  })

  it('пустой план считаем концом поездки', () => {
    expect(isFinalTripStop([])).toBe(true)
  })

})

describe('buildDriverTripPlan — отбор заказов', () => {

  it('игнорирует чужие заказы и нерабочие состояния', () => {
    const foreign = {
      b_id: 'X',
      b_start_latitude: LAT,
      b_start_longitude: 37.01,
      b_destination_latitude: LAT,
      b_destination_longitude: 37.02,
      drivers: [{ u_id: 'other-driver', c_state: EBookingDriverState.Started }],
    } as unknown as IOrder

    const stops = plan([
      foreign,
      order('C', { state: EBookingDriverState.Considering, pickup: 0.01, dropoff: 0.02 }),
      order('D', { state: EBookingDriverState.Canceled, pickup: 0.01, dropoff: 0.02 }),
      order('F', { state: EBookingDriverState.Finished, pickup: 0.01, dropoff: 0.02 }),
    ])

    expect(stops).toEqual([])
  })

  it('пропускает точки без координат', () => {
    const stops = plan([
      order('A', { state: EBookingDriverState.Performer, pickup: 0.01 }),
      order('B', { state: EBookingDriverState.Performer, dropoff: 0.02 }),
    ])

    expect(keys(stops)).toEqual(['A:pickup', 'B:dropoff'])
  })

  it('отбрасывает нулевые координаты', () => {
    const broken = {
      b_id: 'A',
      b_start_latitude: 0,
      b_start_longitude: 0,
      b_destination_latitude: LAT,
      b_destination_longitude: 37.02,
      drivers: [{ u_id: DRIVER_ID, c_state: EBookingDriverState.Performer }],
    } as unknown as IOrder

    expect(keys(plan([broken]))).toEqual(['A:dropoff'])
  })

  it('без позиции водителя план всё равно упорядочен', () => {
    const stops = buildDriverTripPlan({
      activeOrders: [order('A', { state: EBookingDriverState.Performer, pickup: 0.06, dropoff: 0.08 })],
      userId: DRIVER_ID,
      position: null,
    })

    expect(keys(stops)).toEqual(['A:pickup', 'A:dropoff'])
  })

})

describe('buildDriverTripPlan — детерминизм', () => {

  it('равноудалённые точки упорядочены стабильно', () => {
    const orders = [
      order('B', { state: EBookingDriverState.Started, pickup: 0.01, dropoff: 0.05 }),
      order('A', { state: EBookingDriverState.Started, pickup: 0.01, dropoff: 0.05 }),
    ]

    const first = keys(plan(orders))
    const second = keys(plan(orders.slice().reverse()))

    expect(first).toEqual(['A:dropoff', 'B:dropoff'])
    expect(second).toEqual(first)
  })

})

describe('ключи плана', () => {

  it('getTripStopKey и getTripPlanKey описывают состав и порядок', () => {
    const stops = plan([
      order('A', { state: EBookingDriverState.Started, pickup: 0.01, dropoff: 0.05 }),
      order('B', { state: EBookingDriverState.Performer, pickup: 0.02, dropoff: 0.10 }),
    ])

    expect(getTripPlanKey(stops)).toBe('B:pickup|A:dropoff|B:dropoff')
    expect(getTripPlanOrderIds(stops)).toEqual(['B', 'A'])
  })

  it('пустой план даёт пустой ключ', () => {
    expect(getTripPlanKey([])).toBe('')
  })

  it('высадка и посадка одного заказа различимы по ключу', () => {
    const stops = plan([order('A', { state: EBookingDriverState.Performer, pickup: 0.01, dropoff: 0.02 })])

    expect(stops[0].kind).toBe(ETripStopKind.Pickup)
    expect(stops[1].kind).toBe(ETripStopKind.Dropoff)
    expect(getTripStopKey(stops[0])).not.toBe(getTripStopKey(stops[1]))
  })

})
