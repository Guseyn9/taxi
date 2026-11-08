import { IRootState } from '../'
import { moduleName } from './constants'
import { isFreshDevicePosition } from '../../tools/locationFreshness'

export const moduleSelector = (state: IRootState) => state[moduleName]

export const geoposition = (state: IRootState) => {
  const position = moduleSelector(state).geoposition
  return isFreshDevicePosition(position) ? position : undefined
}
