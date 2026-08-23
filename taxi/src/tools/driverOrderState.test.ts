import { EBookingDriverState } from '../types/types'
import { isDriverOrderBoarded, resolveEffectiveDriverState } from './driverOrderState'

const { Performer, Arrived, Started, Finished } = EBookingDriverState

describe('resolveEffectiveDriverState', () => {

  it('без оптимистичного значения отдаёт состояние бэкенда', () => {
    expect(resolveEffectiveDriverState({ backendState: Arrived })).toBe(Arrived)
    expect(resolveEffectiveDriverState({})).toBeUndefined()
  })

  it('оптимистичное значение живёт, только пока оно впереди бэкенда', () => {
    expect(resolveEffectiveDriverState({ backendState: Performer, optimisticState: Arrived }))
      .toBe(Arrived)
    expect(resolveEffectiveDriverState({ backendState: Finished, optimisticState: Started }))
      .toBe(Finished)
  })

  /**
   * Test 4 ТЗ DRIVER-BOARDING-001: заказ, по которому код посадки подтверждён,
   * Driver UI обязан видеть как Started — иначе кнопка снова предложит
   * «Код посадки» (ровно тот дефект, что нашли на регрессии PR #10).
   */
  it('подтверждённая посадка переводит Arrived в Started', () => {
    expect(resolveEffectiveDriverState({ backendState: Arrived, boarded: true })).toBe(Started)
    expect(resolveEffectiveDriverState({ backendState: Performer, boarded: true })).toBe(Started)
  })

  /**
   * Test 2 ТЗ: пока посадка не подтверждена, состояние остаётся прежним —
   * неверный код не двигает UI вперёд.
   */
  it('без подтверждения посадки состояние не поднимается', () => {
    expect(resolveEffectiveDriverState({ backendState: Arrived })).toBe(Arrived)
    expect(resolveEffectiveDriverState({ backendState: Arrived, boarded: false })).toBe(Arrived)
  })

  it('заказ, которого водитель ещё не касался, посадкой не оживает', () => {
    expect(resolveEffectiveDriverState({ boarded: true })).toBeUndefined()
  })

  it('завершённый заказ отметка посадки не откатывает', () => {
    expect(resolveEffectiveDriverState({ backendState: Finished, boarded: true })).toBe(Finished)
  })

})

/**
 * Именно эта отметка чинит дефект DRIVER-BOARDING-001: подтверждённый код
 * посадки переживает уход с карты, поэтому Driver UI видит заказ как Started и
 * не предлагает подтвердить код повторно.
 */
describe('isDriverOrderBoarded', () => {

  it('голосовой заказ с подтверждённым кодом считается посаженным', () => {
    expect(isDriverOrderBoarded('1509-2', {
      confirmedBoardingOrderIds: ['1509-2'],
    })).toBe(true)
  })

  it('попутчик, посаженный при взятии, тоже считается посаженным', () => {
    expect(isDriverOrderBoarded('1509-2', {
      boardedAlongTheWayIds: ['1509-2'],
    })).toBe(true)
  })

  it('заказ без отметок не посажен', () => {
    expect(isDriverOrderBoarded('1509-2', {
      boardedAlongTheWayIds: ['777'],
      confirmedBoardingOrderIds: ['888'],
    })).toBe(false)
    expect(isDriverOrderBoarded('1509-2', {})).toBe(false)
  })

  it('отметка чужого заказа не поднимает состояние этого', () => {
    const markers = { confirmedBoardingOrderIds: ['1509-2'] }

    expect(resolveEffectiveDriverState({
      backendState: Arrived,
      boarded: isDriverOrderBoarded('1509-2', markers),
    })).toBe(Started)
    expect(resolveEffectiveDriverState({
      backendState: Arrived,
      boarded: isDriverOrderBoarded('1509-3', markers),
    })).toBe(Arrived)
  })

  it('числовой и строковый id заказа — одна и та же отметка', () => {
    expect(isDriverOrderBoarded(1509, { confirmedBoardingOrderIds: ['1509'] })).toBe(true)
    expect(isDriverOrderBoarded('1509', { confirmedBoardingOrderIds: [1509] })).toBe(true)
  })

})
