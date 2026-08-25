// Слой API тянет за собой локализацию и корневую сагу (циклический импорт), а
// здесь проверяется только связка «действие → редьюсер».
jest.mock('../../../API', () => ({}))
jest.mock('../selectors', () => ({ order: () => null }))
jest.mock('../../geolocation/actionCreators', () => ({ watch: () => ({}), activateSending: () => ({}) }))

import reducer from '../reducer'
import { ActionTypes } from '../constants'
import { ActionTypes as OrderActionTypes } from '../../order/constants'
import { refreshOrder } from '../actionCreators'
import { getOrder } from '../../order/actionCreators'

const ORDER_ID = '1509-2'
const DRIVER_ID = 'driver-1'

const ARRIVED = 4
const STARTED = 5

const orderWith = state => ({
  b_id: ORDER_ID,
  drivers: [{ u_id: DRIVER_ID, c_state: state }],
})

const driverState = (state, id = ORDER_ID) =>
  state.orders.get(id)?.value?.drivers?.[0]?.c_state

/**
 * Test 4 ТЗ DRIVER-BOARDING-001: после успешной посадки локальное состояние
 * должно догнать бэкенд в том же store, из которого Driver UI берёт c_state.
 * Синхронизацию выполняет refreshOrder — тем же механизмом, что и watchOrder.
 */
describe('ordersActionCreators.refreshOrder', () => {

  it('запрашивает заказ тем же действием, которое обслуживает getOrderSaga', () => {
    expect(refreshOrder(ORDER_ID)).toEqual({
      type: ActionTypes.GET_ORDER_REQUEST,
      payload: ORDER_ID,
    })
  })

  it('ответ бэкенда со Started попадает в store, из которого читает Driver UI', () => {
    let state = reducer(undefined, { type: ActionTypes.WATCH_ORDER, payload: ORDER_ID })
    state = reducer(state, {
      type: ActionTypes.GET_ORDER_SUCCESS,
      payload: orderWith(ARRIVED),
    })
    expect(driverState(state)).toBe(ARRIVED)

    state = reducer(state, refreshOrder(ORDER_ID))
    state = reducer(state, {
      type: ActionTypes.GET_ORDER_SUCCESS,
      payload: orderWith(STARTED),
    })

    expect(driverState(state)).toBe(STARTED)
  })

  it('невыполненная команда не переводит store в Started сама по себе', () => {
    let state = reducer(undefined, { type: ActionTypes.WATCH_ORDER, payload: ORDER_ID })
    state = reducer(state, {
      type: ActionTypes.GET_ORDER_SUCCESS,
      payload: orderWith(ARRIVED),
    })

    // Запрос обновления без ответа бэкенда — состояние прежнее.
    state = reducer(state, refreshOrder(ORDER_ID))

    expect(driverState(state)).toBe(ARRIVED)
  })

})

/**
 * Замечание с ревью PR #11: не избыточны ли getOrder(id) и refreshOrder(id),
 * которые Order/index.tsx вызывает подряд. Нет — это разные слайсы: state/order
 * читает сама страница заказа, state/orders — карточка и карта водителя.
 */
describe('getOrder и refreshOrder — разные слайсы', () => {

  it('действия расходятся по типу, у каждого свой редьюсер и сага', () => {
    expect(refreshOrder(ORDER_ID).type).toBe(ActionTypes.GET_ORDER_REQUEST)
    expect(getOrder(ORDER_ID).type).toBe(OrderActionTypes.GET_ORDER_REQUEST)
    expect(refreshOrder(ORDER_ID).type).not.toBe(getOrder(ORDER_ID).type)
  })

  it('успех соседнего слайса состояние в orders не меняет', () => {
    let state = reducer(undefined, { type: ActionTypes.WATCH_ORDER, payload: ORDER_ID })
    state = reducer(state, {
      type: ActionTypes.GET_ORDER_SUCCESS,
      payload: orderWith(ARRIVED),
    })

    state = reducer(state, {
      type: OrderActionTypes.GET_ORDER_SUCCESS,
      payload: orderWith(STARTED),
    })

    expect(driverState(state)).toBe(ARRIVED)
  })

  /**
   * И почему refreshActiveOrders в одиночку не закрывает вопрос: список кладёт
   * заказ в partial, а ordersSelectors.order отдаёт `value ?? partial` —
   * устаревший value заслоняет свежий partial.
   */
  it('список активных заказов не перебивает устаревший value', () => {
    let state = reducer(undefined, { type: ActionTypes.WATCH_ORDER, payload: ORDER_ID })
    state = reducer(state, {
      type: ActionTypes.GET_ORDER_SUCCESS,
      payload: orderWith(ARRIVED),
    })

    state = reducer(state, {
      type: ActionTypes.GET_ACTIVE_ORDERS_SUCCESS,
      payload: [orderWith(STARTED)],
    })

    const record = state.orders.get(ORDER_ID)
    expect(record.partial.drivers[0].c_state).toBe(STARTED)
    // Селектор отдаёт `value ?? partial` — значит, наружу пойдёт устаревшее.
    expect(record.value.drivers[0].c_state).toBe(ARRIVED)

    // Ровно это и чинит refreshOrder: он обновляет value.
    state = reducer(state, {
      type: ActionTypes.GET_ORDER_SUCCESS,
      payload: orderWith(STARTED),
    })

    expect(driverState(state)).toBe(STARTED)
  })

})
