import {FsmOrderSnapshotTransport} from '../FsmOrderSnapshotTransport'
import {FsmDriverSnapshotTransport} from '../FsmDriverSnapshotTransport'
import {bookingSubmissionUnconfirmed} from '../../../design/bookingSubmissionError'
import {resolveFsmIntent} from '../fsmIntentGate'
import {FsmTaxiCommandTransport} from '../FsmTaxiCommandTransport'
import {FsmCommandStatusTransport} from '../FsmCommandStatusTransport'
import {FsmPassengerBridge, fsmPassengerEnabled} from '../FsmPassengerBridge'
import {handleFsmSocketClose, subscribeFsmAuthenticationRequired} from '../fsmSessionAuth'
import {saveSessionTokens,clearSessionTokens,loadSessionTokens} from '../../../security/sessionTokens'
const {webcrypto}=require('node:crypto'), {TextEncoder}=require('node:util')
const apiUrl='https://fsm.example.test'
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data})
const accepted={accepted:true,duplicate:false,instanceId:7,entityId:12,intent:'cancel_requested',status:'PENDING'}
const originalEnv={...process.env}
beforeAll(()=>{Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});globalThis.TextEncoder=TextEncoder})
beforeEach(()=>{sessionStorage.clear();clearSessionTokens();saveSessionTokens({token:'private-token',u_hash:'private-hash'})})
afterEach(()=>{clearSessionTokens();sessionStorage.clear();process.env=originalEnv})
function runtimeFlags(){process.env={...originalEnv,REACT_APP_FSM_RUNTIME_FLAGS_ENABLED:'true',REACT_APP_FSM_API_URL:apiUrl,REACT_APP_FSM_PASSENGER_ENABLED:'true'};delete process.env.REACT_APP_FSM_ENABLED_INTENTS}

it('changes the per-operation route without a rebuild and never sends credentials to the public policy read',async()=>{
 runtimeFlags()
 const request=jest.fn().mockResolvedValueOnce(response({schemaVersion:1,enabledIntents:['driver_arrived']})).mockResolvedValueOnce(response({schemaVersion:1,enabledIntents:[]}))
 expect(await resolveFsmIntent('driver.order.arrive',apiUrl,request)).toBe(true)
 expect(await resolveFsmIntent('driver.order.arrive',apiUrl,request)).toBe(false)
 expect(request.mock.calls[0][1]).toMatchObject({method:'GET',cache:'no-store',credentials:'omit',headers:{Accept:'application/json'}})
 expect(JSON.stringify(request.mock.calls)).not.toContain('private')
})
it.each([null,{schemaVersion:2,enabledIntents:[]},{schemaVersion:1,enabledIntents:['unknown']}])('blocks writes for malformed rollout settings %p',async config=>{
 runtimeFlags()
 const request=jest.fn().mockResolvedValue(response(config))
 const transport=new FsmTaxiCommandTransport({apiUrl,useIntentGate:true,useSessionAuth:true},{fetch:request})
 await expect(transport.send(901,'driver_cancel_requested')).rejects.toMatchObject({code:'FSM_FEATURE_FLAGS_UNAVAILABLE'})
 expect(request.mock.calls.every(([,init])=>init.method==='GET')).toBe(true)
})
it('does not turn an unreachable policy read into a write or a permanent unsent receipt',async()=>{
 runtimeFlags()
 const request=jest.fn().mockRejectedValue(new Error('offline'))
 await expect(new FsmPassengerBridge(apiUrl,request).command('901','cancel_requested')).rejects.toMatchObject({code:'FSM_FEATURE_FLAGS_UNAVAILABLE'})
 expect(request.mock.calls.every(([,init])=>init.method==='GET')).toBe(true)
 expect(sessionStorage.getItem('taxi.passenger.fsm-pending.v1')).toBeNull()
})
it('recovers an accepted command by GET even after its operation was disabled',async()=>{
 await expect(new FsmPassengerBridge(apiUrl,jest.fn().mockResolvedValue(response(accepted,202)),0).command('901','cancel_requested')).rejects.toMatchObject({code:'FSM_COMMAND_PENDING'})
 runtimeFlags()
 expect(await fsmPassengerEnabled('cancel_requested')).toBe(true)
 const request=jest.fn().mockResolvedValue(response({instanceId:7,status:'COMPLETED'}))
 await new FsmPassengerBridge(apiUrl,request).command('901','cancel_requested')
 expect(request).toHaveBeenCalledTimes(1)
 expect(request.mock.calls[0][0]).toBe(apiUrl+'/api/commands/7')
})
it('recovers a lost POST receipt by key without replaying the write after disabling the operation',async()=>{
 await expect(new FsmPassengerBridge(apiUrl,jest.fn().mockRejectedValue(new Error('offline'))).command('901','cancel_requested')).rejects.toThrow('offline')
 runtimeFlags()
 const request=jest.fn().mockResolvedValueOnce(response(accepted)).mockResolvedValueOnce(response({instanceId:7,status:'COMPLETED'}))
 await new FsmPassengerBridge(apiUrl,request).command('901','cancel_requested')
 expect(request.mock.calls[0][0]).toContain('/api/commands/by-key/taxi/')
 expect(request.mock.calls.every(([,init])=>init.method==='GET')).toBe(true)
})
it('requests sign-in once for a current HTTP 401, without calling Core logout',async()=>{
 const listener=jest.fn(),stop=subscribeFsmAuthenticationRequired(listener)
 try {
  const epoch = localStorage.getItem('taxi.auth.revocation')
  const request=jest.fn().mockResolvedValue(response({},401))
  await expect(new FsmCommandStatusTransport({apiUrl,useSessionAuth:true},{fetch:request}).getStatus(7)).rejects.toMatchObject({code:'FSM_COMMAND_STATUS_HTTP_401'})
  expect(loadSessionTokens()).toBeNull();expect(listener).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem('taxi.auth.revocation')).toBe(epoch)
  expect(request).toHaveBeenCalledTimes(1)
 }finally{stop()}
})
it('ignores a delayed HTTP 401 for an older session',async()=>{
 let finish
 const request=jest.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const pending=new FsmCommandStatusTransport({apiUrl,useSessionAuth:true},{fetch:request}).getStatus(7)
 saveSessionTokens({token:'new-token',u_hash:'new-hash'})
 finish(response({},401))
 await expect(pending).rejects.toMatchObject({code:'FSM_COMMAND_STATUS_HTTP_401'})
 expect(loadSessionTokens().token).toBe('new-token')
})
it.each([403,503])('does not discard credentials on HTTP %s',async status=>{
 const request=jest.fn().mockResolvedValue(response({},status))
 await expect(new FsmCommandStatusTransport({apiUrl,useSessionAuth:true},{fetch:request}).getStatus(7)).rejects.toBeDefined()
 expect(loadSessionTokens().token).toBe('private-token')
})
it('treats WS 4401 as sign-in required, but ignores network closes and stale sessions',()=>{
 const auth=JSON.stringify({token:'private-token',u_hash:'private-hash'})
 handleFsmSocketClose({code:1006},auth);expect(loadSessionTokens()).not.toBeNull()
 saveSessionTokens({token:'new-token',u_hash:'new-hash'})
 handleFsmSocketClose({code:4401},auth);expect(loadSessionTokens().token).toBe('new-token')
 handleFsmSocketClose({code:4401},JSON.stringify({token:'new-token',u_hash:'new-hash'}));expect(loadSessionTokens()).toBeNull()
})

it.each(['order','driver'])('wires actual %s WebSocket 4401 to re-authentication',kind=>{
 const socket={readyState:0,send:jest.fn(),close:jest.fn()}
 const config={apiUrl,useSessionAuth:true,useCoreOrderIds:true,orderId:901,driverUserId:205}
 const Transport=kind==='order'?FsmOrderSnapshotTransport:FsmDriverSnapshotTransport
 const transport=new Transport(config,{socketFactory:()=>socket,fetch:jest.fn()})
 const stop=transport.subscribeSnapshots(()=>{})
 try{socket.onopen();socket.onclose({code:4401});expect(loadSessionTokens()).toBeNull()}finally{stop()}
})
it('requires sign-in for a definitive command authentication failure',async()=>{
 const request=jest.fn().mockResolvedValue(response({instanceId:7,status:'FAILED',errorCode:'CORE_AUTHENTICATION_REQUIRED'}))
 await new FsmCommandStatusTransport({apiUrl,useSessionAuth:true},{fetch:request}).getStatus(7)
 expect(loadSessionTokens()).toBeNull()
})
it('does not label pre-write policy failures as an uncertain submitted booking',()=>{
 for(const code of ['FSM_FEATURE_FLAGS_UNAVAILABLE','FSM_INTENT_DISABLED'])expect(bookingSubmissionUnconfirmed({code})).toBe(false)
})

it('keeps an immutable FAILED/unknown receipt through runtime disable until server reconciliation',async()=>{
 const unknown=response({instanceId:7,status:'FAILED',errorCode:'CORE_OUTCOME_UNKNOWN'})
 const first=jest.fn().mockResolvedValueOnce(response(accepted,202)).mockResolvedValueOnce(unknown).mockResolvedValueOnce(response({orderId:12,coreOrderId:901,sync:{status:'error'}}))
 await expect(new FsmPassengerBridge(apiUrl,first).command('901','cancel_requested')).rejects.toMatchObject({code:'CORE_OUTCOME_UNKNOWN'})
 expect(sessionStorage.getItem('taxi.passenger.fsm-pending.v1')).toContain('instanceId')
 runtimeFlags()
 expect(await fsmPassengerEnabled('cancel_requested')).toBe(true)
 const repaired=jest.fn().mockResolvedValueOnce(unknown).mockResolvedValueOnce(response({orderId:12,coreOrderId:901,sync:{status:'idle'}}))
 await expect(new FsmPassengerBridge(apiUrl,repaired).command('901','cancel_requested')).rejects.toMatchObject({code:'FSM_COMMAND_RECOVERY_REQUIRED'})
 expect(repaired.mock.calls.every(([,init])=>init.method==='GET')).toBe(true)
 expect(sessionStorage.getItem('taxi.passenger.fsm-pending.v1')).toBeNull()
})
it('does not clear an unknown receipt when the idle snapshot belongs to another order',async()=>{
 const first=jest.fn().mockResolvedValueOnce(response(accepted,202)).mockResolvedValueOnce(response({instanceId:7,status:'FAILED',errorCode:'CORE_FSM_DIVERGENCE'})).mockResolvedValueOnce(response({orderId:99,coreOrderId:901,sync:{status:'idle'}}))
 await expect(new FsmPassengerBridge(apiUrl,first).command('901','cancel_requested')).rejects.toMatchObject({code:'CORE_OUTCOME_UNKNOWN'})
 expect(sessionStorage.getItem('taxi.passenger.fsm-pending.v1')).toContain('instanceId')
})

it('preserves a valid login for a FAILED command denied by the entity permission policy',async()=>{
 const request=jest.fn().mockResolvedValue(response({instanceId:7,status:'FAILED',errorCode:'AUTHORIZATION_FAILED',errorMessage:'Permission denied'}))
 await new FsmCommandStatusTransport({apiUrl,useSessionAuth:true},{fetch:request}).getStatus(7)
 expect(loadSessionTokens().token).toBe('private-token')
})
