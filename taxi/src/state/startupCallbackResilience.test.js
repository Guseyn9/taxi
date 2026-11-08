jest.mock('../API', () => ({ googleLogin: jest.fn() }))
jest.mock('./user/helpers', () => ({ uploadRegisterFiles: jest.fn(), uploadFiles: jest.fn() }))
function* mockIdle() { yield require('redux-saga/effects').take('NEVER') }
jest.mock('./config/sagas', () => ({ saga: mockIdle }))
jest.mock('./clientOrder/sagas', () => ({ saga: mockIdle }))
jest.mock('./cars/sagas', () => ({ saga: mockIdle }))
jest.mock('./orders/sagas', () => ({ saga: mockIdle }))
jest.mock('./ordersDetails/sagas', () => ({ saga: mockIdle }))
jest.mock('./order/sagas', () => ({ saga: mockIdle }))
jest.mock('./areas/sagas', () => ({ saga: mockIdle }))
jest.mock('./geolocation/sagas', () => ({ saga: function* () {
  const { takeEvery, put } = require('redux-saga/effects')
  yield takeEvery('SIBLING_PING', function* () { yield put({ type: 'SIBLING_PONG' }) })
} }))

test.each(['%', '%25', '%E0%A4%A', '%E2%82%AC', '%2B'])('startup callback %s cannot cancel sibling root sagas', async encoded => {
  const { runSaga, stdChannel } = require('redux-saga')
  const { captureAuthCallback } = require('../security/authCallback')
  const rootSaga = require('./rootSaga').default
  const previous = process.env.REACT_APP_OAUTH_STATE_SUPPORTED
  process.env.REACT_APP_OAUTH_STATE_SUPPORTED = 'true'
  sessionStorage.setItem('taxi.oauth.state', 'expected')
  window.history.replaceState(null, '', `/?auth_hash=${encoded}&state=wrong`)
  captureAuthCallback()
  const channel = stdChannel(), actions = []
  const task = runSaga({ channel, dispatch: action => { actions.push(action); channel.put(action) } }, rootSaga)
  try {
    channel.put({ type: 'SIBLING_PING' })
    expect(task.isRunning()).toBe(true)
    expect(actions).toContainEqual({ type: 'SIBLING_PONG' })
    expect(require('../API').googleLogin).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  } finally {
    task.cancel(); await task.toPromise(); window.history.replaceState(null, '', '/')
    if (previous === undefined) delete process.env.REACT_APP_OAUTH_STATE_SUPPORTED
    else process.env.REACT_APP_OAUTH_STATE_SUPPORTED = previous
  }
})
