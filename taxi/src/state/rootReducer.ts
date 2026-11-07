import { combineReducers } from 'redux'
import { SESSION_DOMAIN_RESET } from '../security/sessionLifecycle'
import { emptyClientOrderState } from './clientOrder/reducer'
import { TAction } from '../types'

import { moduleName as geolocationModule } from './geolocation/constants'
import geolocationReducer from './geolocation/reducer'
import { moduleName as userModule } from './user/constants'
import userReducer from './user/reducer'
import { moduleName as carsModule } from './cars/constants'
import carsReducer from './cars/reducer'
import { moduleName as ordersModule } from './orders/constants'
import ordersReducer from './orders/reducer'
import { moduleName as orderModule } from './order/constants'
import ordersDetailsReducer from './ordersDetails/reducer'
import { moduleName as ordersDetailsModule } from './ordersDetails/constants'
import orderReducer from './order/reducer'
import { moduleName as clientOrderModule } from './clientOrder/constants'
import clientOrderReducer from './clientOrder/reducer'
import { moduleName as configModule } from './config/constants'
import configReducer from './config/reducer'
import { moduleName as modalsModule } from './modals/constants'
import modalsReducer from './modals/reducer'
import { moduleName as areasModule } from './areas/constants'
import areasReducer from './areas/reducer'
import { moduleName as orderControlModeModule } from './orderControlMode/constants'
import orderControlModeReducer from './orderControlMode/reducer'

const combinedReducer = combineReducers({
  sessionGeneration:(state = 0, action: TAction) => action.type === SESSION_DOMAIN_RESET ? state + 1 : state,
  [geolocationModule]: geolocationReducer,
  [userModule]: userReducer,
  [carsModule]: carsReducer,
  [ordersModule]: ordersReducer,
  [ordersDetailsModule]: ordersDetailsReducer,
  [orderModule]: orderReducer,
  [clientOrderModule]: clientOrderReducer,
  [configModule]: configReducer,
  [modalsModule]: modalsReducer,
  [areasModule]: areasReducer,
  [orderControlModeModule]: orderControlModeReducer,
})

const rootReducer = (state: ReturnType<typeof combinedReducer> | undefined, action: TAction): ReturnType<typeof combinedReducer> => {
  if (state && action.type === SESSION_DOMAIN_RESET) {
    const clean = combinedReducer(undefined, {type:'@@session/INIT'})
    state = {
      ...clean, sessionGeneration:state.sessionGeneration,
      user:clean.user.set('tab',state.user.tab).set('tokens',action.payload?.preserveCurrentTokens ? state.user.tokens : null),
      config:state.config, areas:state.areas,
      clientOrder:action.payload?.preserveGuestDraft ? state.clientOrder.set('fromLoading',false).set('toLoading',false) : emptyClientOrderState(),
      modals:clean.modals.set('isLoginModalOpen',state.modals.isLoginModalOpen),
    }
  }
  return combinedReducer(state, action)
}

export default rootReducer
