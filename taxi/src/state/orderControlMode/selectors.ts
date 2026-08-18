import { createSelector } from 'reselect'
import { moduleName } from './constants'
import { IRootState } from '../'

export const moduleSelector = (state: IRootState) => state[moduleName]
export const orderControlMode = createSelector(moduleSelector, state => state.mode)
export const realisticSubMode = createSelector(moduleSelector, state => state.realisticSubMode)
