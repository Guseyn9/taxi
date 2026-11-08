import { runSaga } from 'redux-saga'
import * as API from '../../API'
import { logoutSaga } from './sagas'
import { clearSessionTokens, saveSessionTokens, loadSessionTokens } from '../../security/sessionTokens'
import { ActionTypes } from './constants'
jest.mock('../../API', () => ({ logout: jest.fn() }))
jest.mock('./helpers', () => ({ uploadRegisterFiles: jest.fn(), uploadFiles: jest.fn() }))

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); clearSessionTokens(); jest.clearAllMocks() })
it.each([false, true])('an older logout cannot revoke or overwrite a new session when rejected=%s', async rejected => {
  let resolve, reject
  API.logout.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no }))
  const old = { token: 'synthetic-old', u_hash: 'synthetic-old-hash' }, fresh = { token: 'synthetic-new', u_hash: 'synthetic-new-hash' }
  saveSessionTokens(old)
  const actions = [], task = runSaga({ dispatch: action => actions.push(action) }, logoutSaga)
  expect(API.logout).toHaveBeenCalledWith(old); expect(loadSessionTokens()).toBeNull()
  saveSessionTokens(fresh)
  if (rejected) reject(new Error('offline')); else resolve({ status: 'success' })
  await task.toPromise()
  expect(loadSessionTokens()).toEqual(fresh)
  expect(actions.some(action => [ActionTypes.LOGOUT_SUCCESS, ActionTypes.LOGOUT_FAIL].includes(action.type))).toBe(false)
})
