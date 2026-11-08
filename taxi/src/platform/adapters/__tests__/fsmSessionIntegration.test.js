import { saveSessionTokens, clearSessionTokens } from '../../../security/sessionTokens'
import { FsmTaxiCommandTransport } from '../FsmTaxiCommandTransport'
import { FsmOrderSnapshotTransport } from '../FsmOrderSnapshotTransport'
import { FsmCommandStatusTransport } from '../FsmCommandStatusTransport'
import { FsmPassengerBridge } from '../FsmPassengerBridge'

const { webcrypto } = require('node:crypto')
const { TextEncoder } = require('node:util')
const apiUrl = 'https://fsm.example.test'
const response = (data, status = 200) => ({ ok: status < 400, status, json: async() => data })
const accepted = { accepted: true, duplicate: false, instanceId: 7, entityId: 12, intent: 'cancel_requested', status: 'PENDING' }
const status = value => response({ instanceId: 7, status: value })
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); globalThis.TextEncoder = TextEncoder })
beforeEach(() => { sessionStorage.clear(); clearSessionTokens(); saveSessionTokens({ token: 'private-token', u_hash: 'private-hash' }) })
afterEach(() => { clearSessionTokens(); sessionStorage.clear() })

it('sends the current session pair to the Core-id command route, never in JSON or URL', async() => {
  const request = jest.fn().mockResolvedValue(response(accepted, 202))
  const transport = new FsmTaxiCommandTransport({ apiUrl, useSessionAuth: true, useCoreOrderIds: true }, { fetch: request })
  await transport.send('901', 'cancel_requested')
  const [url, init] = request.mock.calls[0]
  expect(url).toBe(apiUrl + '/api/taxi/core-orders/901/commands')
  expect(init.headers).toMatchObject({ 'X-Auth-Token': 'private-token', 'X-Auth-U-Hash': 'private-hash' })
  expect(init.headers.Authorization).toBeUndefined()
  expect(url + init.body).not.toContain('private')
  saveSessionTokens({ token: 'rotated-token', u_hash: 'rotated-hash' })
  await transport.send('901', 'cancel_requested')
  expect(request.mock.calls[1][1].headers['X-Auth-Token']).toBe('rotated-token')
})

it('refuses an HTTP command after logout before any fetch', async() => {
  const request = jest.fn()
  const transport = new FsmTaxiCommandTransport({ apiUrl, useSessionAuth: true }, { fetch: request })
  clearSessionTokens()
  await expect(transport.send(12, 'cancel_requested')).rejects.toMatchObject({ code: 'FSM_COMMAND_HTTP_401' })
  expect(request).not.toHaveBeenCalled()
})

it('authenticates WebSocket in its first message and keeps credentials out of the URL', () => {
  const socket = { readyState: 0, send: jest.fn(), close: jest.fn() }
  const sockets = jest.fn().mockReturnValue(socket)
  const transport = new FsmOrderSnapshotTransport({ apiUrl, orderId: 901, useSessionAuth: true, useCoreOrderIds: true }, { socketFactory: sockets })
  const stop = transport.subscribeSnapshots(() => {})
  socket.onopen()
  expect(sockets.mock.calls[0][0]).toBe('wss://fsm.example.test/api/realtime/ws/taxi/core-order/901')
  expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'auth', token: 'private-token', u_hash: 'private-hash' })
  stop()
})

it('uses the pair for command completion too', async() => {
  const request = jest.fn().mockResolvedValue(status('PROCESSING'))
  await new FsmCommandStatusTransport({ apiUrl, useSessionAuth: true }, { fetch: request }).getStatus(7)
  expect(request.mock.calls[0][1].headers['X-Auth-U-Hash']).toBe('private-hash')
})

it('keeps a pending passenger receipt and resumes it by GET after reload', async() => {
  const first = jest.fn().mockResolvedValue(response(accepted, 202))
  await expect(new FsmPassengerBridge(apiUrl, first, 0).command('901', 'cancel_requested')).rejects.toMatchObject({ code: 'FSM_COMMAND_PENDING' })
  const stored = sessionStorage.getItem('taxi.passenger.fsm-pending.v1')
  expect(stored).toContain('instanceId')
  expect(stored).not.toContain('private')
  const resumed = jest.fn().mockResolvedValue(status('COMPLETED'))
  await new FsmPassengerBridge(apiUrl, resumed).command('901', 'cancel_requested')
  expect(resumed).toHaveBeenCalledTimes(1)
  expect(resumed.mock.calls[0][0]).toBe(apiUrl + '/api/commands/7')
  expect(resumed.mock.calls[0][1].method).toBe('GET')
  expect(sessionStorage.getItem('taxi.passenger.fsm-pending.v1')).toBeNull()
})

it('blocks a changed selection while the previous command is unresolved', async() => {
  const request = jest.fn().mockResolvedValue(response({ ...accepted, intent: 'candidate_selected' }, 202))
  await expect(new FsmPassengerBridge(apiUrl, request, 0).command('901', 'candidate_selected', { driverUserId: 205 })).rejects.toMatchObject({ code: 'FSM_COMMAND_PENDING' })
  await expect(new FsmPassengerBridge(apiUrl, request).command('901', 'candidate_selected', { driverUserId: 206 })).rejects.toMatchObject({ code: 'FSM_COMMAND_RECOVERY_REQUIRED' })
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[1][0]).toBe(apiUrl + '/api/commands/7')
})

it('does not report a FAILED command as success', async() => {
  const request = jest.fn().mockResolvedValueOnce(response(accepted, 202)).mockResolvedValueOnce(response({ instanceId: 7, status: 'FAILED', errorCode: 'CORE_REJECTED' }))
  await expect(new FsmPassengerBridge(apiUrl, request).command('901', 'cancel_requested')).rejects.toMatchObject({ code: 'CORE_REJECTED' })
})

it('retains the create receipt when the final Core-id lookup fails', async() => {
  const data = { b_start_address: 'Agadir' }
  const request = jest.fn().mockResolvedValueOnce(response({ ...accepted, intent: 'order_registered' }, 202)).mockResolvedValueOnce(status('COMPLETED')).mockRejectedValueOnce(new Error('offline'))
  await expect(new FsmPassengerBridge(apiUrl, request).create(data, 'VOTE')).rejects.toThrow('offline')
  expect(sessionStorage.getItem('taxi.passenger.fsm-pending.v1')).toContain('instanceId')
  const resume = jest.fn().mockResolvedValueOnce(status('COMPLETED')).mockResolvedValueOnce(response({ coreOrderId: 901 }))
  await expect(new FsmPassengerBridge(apiUrl, resume).create(data, 'VOTE')).resolves.toBe('901')
  expect(resume.mock.calls.every(([, init]) => init.method !== 'POST')).toBe(true)
})

it('allows a later action only after proving that the saved action is terminal', async() => {
  await expect(new FsmPassengerBridge(apiUrl, jest.fn().mockResolvedValue(response({...accepted,intent:'candidate_selected'},202)),0).command('901','candidate_selected',{driverUserId:205})).rejects.toMatchObject({code:'FSM_COMMAND_PENDING'})
  const request=jest.fn().mockResolvedValueOnce(status('COMPLETED')).mockResolvedValueOnce(response(accepted,202)).mockResolvedValueOnce(status('COMPLETED'))
  await new FsmPassengerBridge(apiUrl,request).command('901','cancel_requested')
  expect(request.mock.calls[0][0]).toBe(apiUrl+'/api/commands/7')
  expect(request.mock.calls[1][1].method).toBe('POST')
})
