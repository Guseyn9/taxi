import { TAction } from '../../types'
import { ActionTypes, EOrderControlMode, STORAGE_KEY } from './constants'

export const setOrderControlMode = (payload: EOrderControlMode): TAction => {
  try {
    window.localStorage.setItem(STORAGE_KEY, payload)
  } catch {
    // localStorage может быть недоступен — режим всё равно применится в рантайме.
  }
  return { type: ActionTypes.SET_ORDER_CONTROL_MODE, payload }
}
