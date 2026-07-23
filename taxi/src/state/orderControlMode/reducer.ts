import { TAction } from '../../types'
import {
  ActionTypes,
  DEFAULT_ORDER_CONTROL_MODE,
  EOrderControlMode,
  IOrderControlModeState,
  ORDER_CONTROL_MODE_ORDER,
  STORAGE_KEY,
} from './constants'

function readInitialMode(): EOrderControlMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && ORDER_CONTROL_MODE_ORDER.includes(stored as EOrderControlMode))
      return stored as EOrderControlMode
  } catch {
    // localStorage может быть недоступен (приватный режим и т.п.) — тихо игнорируем.
  }
  return DEFAULT_ORDER_CONTROL_MODE
}

const initialState: IOrderControlModeState = {
  mode: readInitialMode(),
}

export default function reducer(state = initialState, action: TAction): IOrderControlModeState {
  const { type, payload } = action

  switch (type) {
    case ActionTypes.SET_ORDER_CONTROL_MODE:
      if (!ORDER_CONTROL_MODE_ORDER.includes(payload))
        return state
      return { ...state, mode: payload }
    default:
      return state
  }
}
