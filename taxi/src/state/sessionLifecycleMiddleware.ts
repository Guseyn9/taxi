import type { Middleware } from 'redux'
import { ActionTypes as UserActions } from './user/constants'
import { SESSION_DOMAIN_RESET, advanceSessionGeneration, clearPrivateDerivedStorage, sessionGeneration, setPrivateDataOwner } from '../security/sessionLifecycle'
import { clearSessionTokens } from '../security/sessionTokens'
import { clearDriverParkedPosition } from '../tools/driverPosition'
import { clearPrivateDiagnosticLogs } from '../tools/frontendLog'
import { resetOrderDecisionTracker } from '../tools/orderDecisionTracker'
import { resetOrderInteractionLog } from '../tools/orderInteractionLog'

export const sessionLifecycleMiddleware: Middleware = store => next => (action: any) => {
  if (typeof action === 'function') {
    return next((dispatch: any, getState: any, extra: any) => {
      const generation = sessionGeneration()
      return action((value: any) => generation === sessionGeneration() ? dispatch(value) : undefined, getState, extra)
    })
  }
  if (action.type === SESSION_DOMAIN_RESET) {
    advanceSessionGeneration()
    if (!action.payload?.preserveGuestDraft) clearPrivateDerivedStorage()
    clearDriverParkedPosition();clearPrivateDiagnosticLogs()
    resetOrderDecisionTracker();resetOrderInteractionLog()
    if (action.payload?.clearUser) { clearSessionTokens();setPrivateDataOwner(null) }
  }
  if ([UserActions.LOGIN_START, UserActions.GOOGLE_LOGIN_START, UserActions.REGISTER_START, UserActions.LOGOUT_START].includes(action.type)) {
    const current = store.getState().user
    const preserveGuestDraft = action.type !== UserActions.LOGOUT_START && !current?.user && !current?.tokens
    store.dispatch({type:SESSION_DOMAIN_RESET,payload:{preserveGuestDraft}})
    clearSessionTokens(!action.payload?.externalRevocation)
    setPrivateDataOwner(null)
  }
  if ([UserActions.LOGIN_SUCCESS,UserActions.GOOGLE_LOGIN_SUCCESS,UserActions.SET_USER].includes(action.type)) {
    const user = action.type === UserActions.SET_USER ? action.payload : action.payload?.user
    const previous = store.getState().user?.user
    if (previous?.u_id && (!user?.u_id || String(previous.u_id) !== String(user.u_id))) store.dispatch({type:SESSION_DOMAIN_RESET,payload:{preserveCurrentTokens:Boolean(user?.u_id)}})
    setPrivateDataOwner(user?.u_id)
  }
  if (action.type === UserActions.SET_TOKENS && !action.payload && store.getState().user?.tokens) store.dispatch({type:SESSION_DOMAIN_RESET,payload:{clearUser:true}})
  return next(action)
}
