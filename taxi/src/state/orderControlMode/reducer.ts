import { TAction } from '../../types'
import {
  ActionTypes,
  DEFAULT_ORDER_CONTROL_MODE,
  DEFAULT_REALISTIC_SUB_MODE,
  EOrderControlMode,
  ERealisticSubMode,
  IOrderControlModeState,
  ORDER_CONTROL_MODE_ORDER,
  REALISTIC_SUB_MODES,
  STORAGE_KEY,
  SUB_MODE_STORAGE_KEY,
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

function readInitialSubMode(): ERealisticSubMode {
  try {
    const stored = window.localStorage.getItem(SUB_MODE_STORAGE_KEY)
    if (stored && REALISTIC_SUB_MODES.includes(stored as ERealisticSubMode))
      return stored as ERealisticSubMode
  } catch {
    // См. выше — молча откатываемся на подтип по умолчанию.
  }
  return DEFAULT_REALISTIC_SUB_MODE
}

const initialState: IOrderControlModeState = {
  mode: readInitialMode(),
  realisticSubMode: readInitialSubMode(),
}

export default function reducer(state = initialState, action: TAction): IOrderControlModeState {
  const { type, payload } = action

  switch (type) {
    case ActionTypes.SET_ORDER_CONTROL_MODE:
      if (!ORDER_CONTROL_MODE_ORDER.includes(payload))
        return state
      return { ...state, mode: payload }
    case ActionTypes.SET_REALISTIC_SUB_MODE:
      if (!REALISTIC_SUB_MODES.includes(payload))
        return state
      return { ...state, realisticSubMode: payload }
    default:
      return state
  }
}
