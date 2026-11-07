import { all, put } from 'redux-saga/effects'
import { TAction } from '../../types'
import { IUser } from '../../types/types'
import { select, call, concurrency } from '../../tools/sagaUtils'
import * as API from '../../API'
import { user as userSelector } from '../user/selectors'
import { ActionTypes } from './constants'
import { carMutates as carMutatesSelector } from './selectors'
import { getSessionRecoveryId } from '../../security/sessionTokens'

export function* saga() {
  yield all([
    concurrency({
      action: [
        ActionTypes.GET_USER_CARS_REQUEST,
      ],
      saga: getUserCarsSaga,
      parallelKey: 0,
      leading: ({ type }: TAction) =>
        type === ActionTypes.GET_USER_CARS_REQUEST || undefined,
    }, {
      action: ActionTypes.END_MUTATION,
      saga: getCarSaga,
      parallelKey: 1,
      sequenceKey: ({ payload }: TAction) => payload,
      latest: ({ payload }: TAction) => payload,
    }),
  ])
}

function* getCarSaga({ type, payload }: TAction) {
  if (yield* select(carMutatesSelector, payload))
    return
  try {
    const car = yield* call(API.getCar, payload)
    if (car)
      yield put({ type: ActionTypes.GET_SUCCESS, payload: car })
    else
      yield put({ type: ActionTypes.GET_NOT_FOUND, payload })
  } catch (error) {
    console.error(error)
    yield put({ type: ActionTypes.GET_FAIL, payload: error })
  }
}

export function* getUserCarsSaga({ type }: TAction) {
  const userId = (yield* select(userSelector))?.u_id
  if (!userId) return
  const session = getSessionRecoveryId()
  try {
    const cars = yield* call(API.getUserCars)
    if (getSessionRecoveryId() !== session || (yield* select(userSelector))?.u_id !== userId) return
    yield put({ type: ActionTypes.GET_USER_CARS_SUCCESS, payload: cars })
  } catch (error) {
    if (getSessionRecoveryId() !== session) return
    console.error(error)
    yield put({ type: ActionTypes.GET_USER_CARS_FAIL, payload: error })
  }
}
