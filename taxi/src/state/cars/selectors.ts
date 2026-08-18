import { is } from 'immutable'
import { createSelector } from 'reselect'
import { ICar } from '../../types/types'
import { IRootState } from '..'
import { user as userSelector } from '../user/selectors'
import { moduleName } from './constants'

export const moduleSelector = (state: IRootState) => state[moduleName]

export const carMutates = (state: IRootState, id: ICar['c_id']) =>
  (moduleSelector(state).cars.get(id)?.mutations as number) > 0

const cars = (state: IRootState) => moduleSelector(state).cars
const userCarsIds = (state: IRootState) => moduleSelector(state).userCars
export const userCars = createSelector(
  [cars, userCarsIds],
  (cars, ids) => ids?.map(id => cars.get(id)).filter(Boolean),
  { memoizeOptions: {
    resultEqualityCheck: (oldValue, newValue) => is(newValue, oldValue),
  } },
)
export const userPrimaryCar = (state: IRootState) => {
  const id = userCarsIds(state)?.get(0, null)
  return id == null ? id : cars(state).get(id)?.value
}

/**
 * Машина, за рулём которой водитель сейчас находится. Если бекенд не отметил
 * ни одну машину как ведомую, берём первую машину водителя.
 */
export const userDrivenCar = (state: IRootState) => {
  const ids = userCarsIds(state)
  if (!ids)
    return undefined

  const carsMap = cars(state)
  const userID = userSelector(state)?.u_id
  const drivenId = userID == null ?
    undefined :
    ids.find(id => String(carsMap.get(id)?.value?.u_d_id) === String(userID))
  const id = drivenId ?? ids.get(0, null)

  return id == null ? null : carsMap.get(id)?.value
}