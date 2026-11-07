import { ParametersExceptFirst, TAction } from '../../types'
import { ICar } from '../../types/types'
import * as API from '../../API'
import { IDispatch } from '..'
import { ActionTypes } from './constants'
import { getSessionRecoveryId } from '../../security/sessionTokens'
import { setUser } from '../user/actionCreators'

/** Activation is explicit and completes only after both car and user readback. */
export const activateVehicle = (car: ICar) => async (dispatch: IDispatch) => {
  const session = getSessionRecoveryId()
  const response = await API.driveCar(car)
  if (String(response.code) !== '200' && (response.data as any)?.detail !== 'not_modified') throw new Error('Vehicle activation was not confirmed')
  const [cars, user] = await Promise.all([API.getUserCars(), API.getAuthorizedUser()])
  if (getSessionRecoveryId() !== session) throw new Error('Session changed')
  const active = cars.find((item: ICar) => String(item.c_id) === String(car.c_id) && String(item.u_d_id) === String(user?.u_id))
  if (!user || !active) throw new Error('Vehicle activation needs reconciliation; refresh before retrying')
  dispatch({ type: ActionTypes.GET_USER_CARS_SUCCESS, payload: cars })
  dispatch(setUser(user))
  return active as ICar
}

export const getUserCars = (): TAction =>
  ({ type: ActionTypes.GET_USER_CARS_REQUEST })

export const createUserCar = (
  ...params: Parameters<typeof API.createUserCar>
) => async(dispatch: IDispatch) => {
  const session = getSessionRecoveryId()
  const response = await API.createUserCar(...params)
  const createdCarId = (response.data as any)?.created_car?.c_id
  if (String(response.code) !== '200' || !createdCarId) return response
  let cars: ICar[]
  try { cars = await API.getUserCars() } catch {
    throw new Error('Vehicle creation needs reconciliation; refresh the vehicle list before retrying')
  }
  if (getSessionRecoveryId() !== session) throw new Error('Session changed')
  if (!cars.some(item => String(item.c_id) === String(createdCarId)))
    throw new Error('Vehicle creation needs reconciliation; refresh the vehicle list before retrying')
  dispatch({ type: ActionTypes.GET_USER_CARS_SUCCESS, payload: cars })
  return response
}

export const edit = (
  id: ICar['c_id'],
  ...params: ParametersExceptFirst<typeof API.editCar>
) => mutationThunk(async () => {
  const session = getSessionRecoveryId()
  const response = await API.editCar(id, ...params)
  if (String(response.code) !== '200') return response
  const [cars, user] = await Promise.all([API.getUserCars(), API.getAuthorizedUser()])
  if (getSessionRecoveryId() !== session) throw new Error('Session changed')
  if (!user || !cars.some((item: ICar) => String(item.c_id) === String(id)))
    throw new Error('Vehicle update needs reconciliation; refresh before retrying')
  return { ...response, reconciled: { cars, user } }
}, id)
export const drive = activateVehicle

const mutationThunk = <TReturn>(
  mutation: () => Promise<TReturn>,
  id: ICar['c_id'],
) => async(
    dispatch: IDispatch,
  ): Promise<TReturn> => {
    dispatch({ type: ActionTypes.START_MUTATION, payload: id })
    try {
      const response = await mutation()
      const reconciled = (response as any)?.reconciled
      if (reconciled) {
        dispatch({ type: ActionTypes.GET_USER_CARS_SUCCESS, payload: reconciled.cars })
        dispatch(setUser(reconciled.user))
      }
      return response
    } finally {
      dispatch({ type: ActionTypes.END_MUTATION, payload: id })
    }
  }
