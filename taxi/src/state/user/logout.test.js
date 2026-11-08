import { runSaga } from 'redux-saga'
import * as API from '../../API'
import { logoutSaga } from './sagas'
import { clearSessionTokens, saveSessionTokens, loadSessionTokens, getSessionRecoveryId } from '../../security/sessionTokens'
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

it.each(['passenger', 'driver'])('warns before logout with an unconfirmed %s command and keeps the session when cancelled', async source => {
  const pair = {token:'synthetic-token',u_hash:'synthetic-hash'}
  saveSessionTokens(pair)
  const session = getSessionRecoveryId()
  sessionStorage.setItem(source === 'passenger' ? 'taxi.passenger.fsm-pending.v1' : 'taxi.driver.pending-commands.v1', JSON.stringify(source === 'passenger' ? {session,commandId:'pending'} : {scope:{sessionId:session},commands:[{instanceId:1}]}))
  const confirmation = jest.spyOn(window, 'confirm').mockReturnValue(false)
  try {
    await runSaga({dispatch:()=>{}}, logoutSaga).toPromise()
    expect(confirmation).toHaveBeenCalledTimes(1)
    expect(API.logout).not.toHaveBeenCalled()
    expect(loadSessionTokens()).toEqual(pair)
    confirmation.mockReturnValue(true)
    API.logout.mockResolvedValue({status:'success'})
    await runSaga({dispatch:()=>{}}, logoutSaga).toPromise()
    expect(API.logout).toHaveBeenCalledWith(pair)
    expect(loadSessionTokens()).toBeNull()
  } finally {confirmation.mockRestore()}
})
