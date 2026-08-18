import { EBookingDriverState, EUserRoles, ICar, IOrder, IUser } from '../types/types'
import { MAX_DRIVER_VISIBLE_ORDER_DISTANCE_KM } from '../constants/orders'
import {
  DECISION_CHECK_KEYS,
  IOrderDecisionContext,
  buildDecisionFingerprint,
  buildOrderDecisionMatrix,
} from './orderDecisionMatrix'

const DRIVER_ID = 'driver-1'

function order(fields: Record<string, any> = {}): IOrder {
  return {
    b_id: 'order-1',
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

function checkOf(matrix: ReturnType<typeof buildOrderDecisionMatrix>, key: string) {
  return matrix.find(item => item.key === key)!
}

describe('buildOrderDecisionMatrix', () => {

  it('всегда отдаёт все ключи целевой схемы в фиксированном порядке', () => {
    const matrix = buildOrderDecisionMatrix(order(), context())
    expect(matrix.map(item => item.key)).toEqual([...DECISION_CHECK_KEYS])
  })

  it('не подставляет значение нереализованным правилам', () => {
    const matrix = buildOrderDecisionMatrix(order(), context())
    matrix
      .filter(item => item.status === 'NOT_IMPLEMENTED')
      .forEach(item => expect(item.value).toBeNull())

    // Иначе журнал притворялся бы, что правило уже работает.
    expect(checkOf(matrix, 'detour').status).toBe('NOT_IMPLEMENTED')
    expect(checkOf(matrix, 'eta').status).toBe('NOT_IMPLEMENTED')
    expect(checkOf(matrix, 'driverRating').status).toBe('NOT_IMPLEMENTED')
    expect(checkOf(matrix, 'geoZone').status).toBe('NOT_IMPLEMENTED')
  })

  it('пишет измеренные значения мест, а не причину', () => {
    const matrix = buildOrderDecisionMatrix(
      order({ b_passengers_count: 2 }),
      context({ freeSeats: 1 }),
    )
    const requiredSeats = checkOf(matrix, 'requiredSeats')

    expect(requiredSeats.status).toBe('FAIL')
    expect(requiredSeats.value).toEqual({ requiredSeats: 2, participating: false })
    expect(requiredSeats.limit).toBe(1)
    expect(JSON.stringify(matrix)).not.toContain('NOT_ENOUGH_SEATS')
  })

  it('пропускает по местам заказ, в котором водитель уже участвует', () => {
    const participatingOrder = order({
      b_passengers_count: 3,
      drivers: [{ u_id: DRIVER_ID, c_state: EBookingDriverState.Performer }],
    })
    const matrix = buildOrderDecisionMatrix(participatingOrder, context({ freeSeats: 0 }))

    expect(checkOf(matrix, 'requiredSeats').status).toBe('PASS')
  })

  describe('pickupDistance', () => {

    it('сравнивает холостой пробег с порогом видимости', () => {
      const matrix = buildOrderDecisionMatrix(order({ emptyMileageKm: 12.5 }), context())
      const check = checkOf(matrix, 'pickupDistance')

      expect(check.status).toBe('PASS')
      expect(check.value).toEqual({ km: 12.5, measure: 'route_empty_mileage' })
      expect(check.limit).toBe(MAX_DRIVER_VISIBLE_ORDER_DISTANCE_KM)
    })

    it('отмечает выход за порог', () => {
      const matrix = buildOrderDecisionMatrix(order({ emptyMileageKm: 120 }), context())
      expect(checkOf(matrix, 'pickupDistance').status).toBe('FAIL')
    })

    it('оставляет далёкий заказ пройденным, если водитель его уже выполняет', () => {
      const matrix = buildOrderDecisionMatrix(
        order({
          emptyMileageKm: 120,
          drivers: [{ u_id: DRIVER_ID, c_state: EBookingDriverState.Started }],
        }),
        context(),
      )
      const check = checkOf(matrix, 'pickupDistance')

      // Факты остаются противоречивыми намеренно: значение больше порога, но код
      // заказ не спрятал. Связать одно с другим — работа анализатора.
      expect(check.status).toBe('PASS')
      expect((check.value as any).km).toBe(120)
      expect(checkOf(matrix, 'activeTrip').value).toEqual({ activeTrip: true })
    })

    it('помечает проверку пропущенной во внешнем режиме эмулятора', () => {
      const matrix = buildOrderDecisionMatrix(
        order({ emptyMileageKm: 999 }),
        context({ externalEmulatorEnabled: true }),
      )
      expect(checkOf(matrix, 'pickupDistance').status).toBe('SKIPPED')
    })

    it('считает расстояние по прямой, пока нет оценки по графу дорог', () => {
      const matrix = buildOrderDecisionMatrix(
        order({ b_start_latitude: 54.8, b_start_longitude: 20.48 }),
        context(),
      )
      const check = checkOf(matrix, 'pickupDistance')

      expect((check.value as any).measure).toBe('straight_line')
      expect((check.value as any).km).toBeGreaterThan(10)
    })

    it('не выдумывает расстояние без геопозиции', () => {
      const matrix = buildOrderDecisionMatrix(order(), context({ driverPosition: null }))
      const check = checkOf(matrix, 'pickupDistance')

      expect(check.status).toBe('UNKNOWN')
      expect((check.value as any).km).toBeNull()
    })

  })

  it('фиксирует эмуляторный гейт как отдельную проверку', () => {
    const matrix = buildOrderDecisionMatrix(
      order(),
      context({ emulatorAnyModeRunning: false, externalEmulatorEnabled: false }),
    )
    const check = checkOf(matrix, 'emulatorGate')

    expect(check.status).toBe('FAIL')
    expect(check.value).toEqual({
      driverRole: true,
      emulatorAnyModeRunning: false,
      externalEmulatorEnabled: false,
    })
  })

  it('фиксирует скрытие заказа самим водителем', () => {
    const matrix = buildOrderDecisionMatrix(order(), context({ hiddenOrderIds: ['order-1'] }))
    expect(checkOf(matrix, 'hiddenByDriver').status).toBe('FAIL')
  })

  it('не считает позицию в очереди голосования известной', () => {
    const matrix = buildOrderDecisionMatrix(order(), context())
    expect((checkOf(matrix, 'votingPosition').value as any).positionInQueue).toBeNull()
  })

})

describe('buildDecisionFingerprint', () => {

  const build = (fields: Record<string, any>) =>
    buildDecisionFingerprint(buildOrderDecisionMatrix(order(fields), context()), 'VISIBLE')

  it('не меняется от дрожания расстояния внутри шага квантования', () => {
    // 20 метров — не изменение решения, иначе запись уходила бы на каждый polling.
    expect(build({ emptyMileageKm: 1.0 })).toBe(build({ emptyMileageKm: 1.02 }))
  })

  it('меняется при выходе за шаг квантования', () => {
    expect(build({ emptyMileageKm: 1.0 })).not.toBe(build({ emptyMileageKm: 1.3 }))
  })

  it('не меняется от копеечной разницы в выгоде', () => {
    expect(build({ profit: 420.1 })).toBe(build({ profit: 420.3 }))
  })

  it('меняется при смене исхода', () => {
    const matrix = buildOrderDecisionMatrix(order(), context())
    expect(buildDecisionFingerprint(matrix, 'VISIBLE'))
      .not.toBe(buildDecisionFingerprint(matrix, 'HIDDEN'))
  })

  it('не зависит от текущего времени', () => {
    const votingOrder = order({ b_voting: true, b_created: 1700000000, b_max_waiting: 600 })
    const first = buildDecisionFingerprint(buildOrderDecisionMatrix(votingOrder, context()), 'VISIBLE')
    const second = buildDecisionFingerprint(buildOrderDecisionMatrix(votingOrder, context()), 'VISIBLE')

    expect(first).toBe(second)
  })

})
