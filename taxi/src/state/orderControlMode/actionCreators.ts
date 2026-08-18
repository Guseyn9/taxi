import { TAction } from '../../types'
import {
  ActionTypes,
  EOrderControlMode,
  ERealisticSubMode,
  STORAGE_KEY,
  SUB_MODE_STORAGE_KEY,
} from './constants'

export const setOrderControlMode = (payload: EOrderControlMode): TAction => {
  try {
    window.localStorage.setItem(STORAGE_KEY, payload)
  } catch {
    // localStorage может быть недоступен — режим всё равно применится в рантайме.
  }
  return { type: ActionTypes.SET_ORDER_CONTROL_MODE, payload }
}

export const setRealisticSubMode = (payload: ERealisticSubMode): TAction => {
  try {
    window.localStorage.setItem(SUB_MODE_STORAGE_KEY, payload)
  } catch {
    // localStorage может быть недоступен — подтип всё равно применится в рантайме.
  }
  return { type: ActionTypes.SET_REALISTIC_SUB_MODE, payload }
}
