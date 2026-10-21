/**
 * MapMapper — чистое преобразование намерения карты в Action контракта.
 *
 * Фиксируем форму Action, сохранение сырого ID и безопасный отказ для
 * невалидных значений — в пути клика исключения не должны возникать.
 */

import { mapOrderSelectToAction } from '../MapMapper'
import { DRIVER_ORDER_SELECT_ACTION, MAP_CHANNEL_SOURCE } from '../map-channel-protocol'

const TIMESTAMP = '2026-07-27T10:00:00.000Z'
const CORRELATION_ID = 'map-test-correlation-1'

describe('MapMapper: валидный orderId', () => {
  it('строит Action с правильными type, payload и metadata', () => {
    const action = mapOrderSelectToAction('42', TIMESTAMP, CORRELATION_ID)

    expect(action).toEqual({
      type: 'driver.order.select',
      payload: { orderId: '42' },
      metadata: {
        source: 'map',
        timestamp: TIMESTAMP,
        correlationId: CORRELATION_ID,
      },
    })
  })

  it('type и source берутся из протокола, а не из литералов Mapper’а', () => {
    const action = mapOrderSelectToAction('42', TIMESTAMP, CORRELATION_ID)

    expect(action.type).toBe(DRIVER_ORDER_SELECT_ACTION)
    expect(action.metadata.source).toBe(MAP_CHANNEL_SOURCE)
  })

  it('correlationId проставляется в metadata как есть', () => {
    const action = mapOrderSelectToAction('42', TIMESTAMP, 'map-abc-xyz')

    expect(action.metadata.correlationId).toBe('map-abc-xyz')
  })

  it.each([
    ['числовой ID', 12345],
    ['нулевой ID', 0],
    ['строковый ID с ведущими нулями', '00123'],
  ])('сохраняет исходный тип и значение: %s', (_name, raw) => {
    const action = mapOrderSelectToAction(raw, TIMESTAMP, CORRELATION_ID)

    expect(action.payload.orderId).toBe(raw)
    expect(typeof action.payload.orderId).toBe(typeof raw)
  })

  it('детерминирован: одинаковый вход → одинаковый выход', () => {
    const first = mapOrderSelectToAction('42', TIMESTAMP, CORRELATION_ID)
    const second = mapOrderSelectToAction('42', TIMESTAMP, CORRELATION_ID)

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })
})

describe('MapMapper: невалидный orderId', () => {
  const invalidCases = [
    ['пустая строка', ''],
    ['undefined', undefined],
    ['null', null],
    ['одни пробелы', '   '],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['минус Infinity', Number.NEGATIVE_INFINITY],
    ['boolean', false],
    ['объект', { id: 42 }],
  ]

  it.each(invalidCases)('%s → Action не создаётся, возвращается null', (_name, orderId) => {
    expect(mapOrderSelectToAction(orderId, TIMESTAMP, CORRELATION_ID)).toBeNull()
  })

  it.each(invalidCases)('%s → исключение не бросается', (_name, orderId) => {
    expect(() => mapOrderSelectToAction(orderId, TIMESTAMP, CORRELATION_ID)).not.toThrow()
  })
})
