import { all, fork, take, cancel } from 'redux-saga/effects'
import { SESSION_DOMAIN_RESET } from '../security/sessionLifecycle'
import { saga as geolocationSaga } from './geolocation/sagas'
import { saga as clientOrderSaga } from './clientOrder/sagas'
import { saga as userSaga } from './user/sagas'
import { saga as carsSaga } from './cars/sagas'
import { saga as ordersSaga } from './orders/sagas'
import { saga as ordersDetailsSaga } from './ordersDetails/sagas'
import { saga as orderSaga } from './order/sagas'
import { saga as configSaga } from './config/sagas'
import { saga as areasSaga } from './areas/sagas'

export default function* rootSaga() {
  yield all([userSaga(),configSaga(),domainSupervisor()])
}

export function* domainSupervisor(): Generator<any, void, any> {
  while (true) {
    const task = yield fork(privateDomains)
    yield take(SESSION_DOMAIN_RESET)
    yield cancel(task)
  }
}
function* privateDomains() {
  yield all([
    geolocationSaga(),
    clientOrderSaga(),
    carsSaga(),
    ordersSaga(),
    ordersDetailsSaga(),
    orderSaga(),
    areasSaga(),
  ])
}
