import {DriverCommandRecovery} from '../DriverCommandRecovery'
import {CommandStatusDriverCommandCompletionWaiter} from '../DriverCommandCompletionWaiter'
import {BackendInteractionError} from '../backendError'
const KEY='taxi.driver.pending-commands.v1'
const scope={userId:'1420',service:'https://test.invalid/fsm',sessionId:'session-a'}
const command={actionType:'driver.order.confirm_boarding',orderId:'42',instanceId:91,acceptedAt:1000}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
function setup({current=()=>scope,storage=sessionStorage,status=jest.fn().mockResolvedValue({instanceId:91,status:'PROCESSING'}),timeout=500}={}){
 const waiter=new CommandStatusDriverCommandCompletionWaiter({getStatus:status},timeout,100)
 const onRecovered=jest.fn(),controller=new DriverCommandRecovery(waiter,{scope:current,storage,onRecovered,now:()=>1000})
 return {controller,waiter,status,onRecovered}
}
function saved(commands=[command],owner=scope){sessionStorage.setItem(KEY,JSON.stringify({version:1,scope:owner,commands}))}
beforeEach(()=>{sessionStorage.clear();jest.useFakeTimers()})
afterEach(()=>jest.useRealTimers())
test('reload follows the accepted instance and exposes a confirmed outcome without replaying an action',async()=>{
 const first=setup();first.controller.activate()
 first.controller.remember({...command,baseline:{state:'ARRIVED'},pin:'111',token:'never-save'},scope)
 const journal=sessionStorage.getItem(KEY)
 expect(journal).not.toMatch(/pin|token|ARRIVED|111/)
 const gate=deferred(),second=setup({status:jest.fn(()=>gate.promise)})
 second.controller.activate();expect(second.status).toHaveBeenCalledWith(91)
 expect(second.controller.hasPending('42')).toBe(true)
 gate.resolve({instanceId:91,status:'COMPLETED'});await tick()
 expect(sessionStorage.getItem(KEY)).toBeNull()
 expect(second.controller.hasPending('42')).toBe(false)
 expect(second.controller.getSnapshot()[0].phase).toBe('completed')
 expect(second.onRecovered).toHaveBeenCalledTimes(1)
 second.controller.dismiss(91);expect(second.controller.getSnapshot()).toEqual([])
})
test('a read failure is not an execution failure; manual retry only reads the same instance',async()=>{
 saved();const status=jest.fn().mockRejectedValueOnce(new BackendInteractionError('FSM_COMMAND_STATUS_HTTP_403','forbidden')).mockResolvedValueOnce({instanceId:91,status:'COMPLETED'})
 const {controller}=setup({status});controller.activate();await tick()
 expect(controller.getSnapshot()[0].phase).toBe('unconfirmed')
 expect(()=>controller.assertCanSend('42')).toThrow('previous action')
 expect(()=>controller.assertCanSend('43')).not.toThrow()
 expect(sessionStorage.getItem(KEY)).not.toBeNull()
 controller.dismiss(91);expect(controller.hasPending('42')).toBe(true)
 controller.retry(91);await tick()
 expect(status.mock.calls).toEqual([[91],[91]])
 expect(controller.getSnapshot()[0].phase).toBe('completed')
})
test('offline timeout remains recoverable and does not authorize a second mutation',async()=>{
 saved();const {controller,waiter}=setup({status:jest.fn().mockRejectedValue(new TypeError('offline'))})
 controller.activate();await tick();jest.advanceTimersByTime(501);await tick()
 expect(controller.getSnapshot()[0].phase).toBe('unconfirmed')
 expect(()=>controller.assertCanSend('42')).toThrow()
 expect(sessionStorage.getItem(KEY)).not.toBeNull();waiter.cancelAll()
})
test('a definitive execution failure clears the journal but remains visible until dismissed',async()=>{
 saved();const {controller}=setup({status:jest.fn().mockResolvedValue({instanceId:91,status:'FAILED',errorCode:'INVALID_BOARDING_CODE'})})
 controller.activate();await tick()
 expect(controller.getSnapshot()[0].phase).toBe('failed')
 expect(controller.hasPending('42')).toBe(false);expect(sessionStorage.getItem(KEY)).toBeNull()
})
test.each(['userId','service','sessionId'])('never restores another %s or applies a late result to it',async(field)=>{
 saved();let active={...scope,[field]:'different'}
 const gate=deferred(),parts=setup({current:()=>active,status:jest.fn(()=>gate.promise)})
 parts.controller.activate();expect(parts.status).not.toHaveBeenCalled()
 active=scope;parts.controller.activate();expect(parts.status).toHaveBeenCalledTimes(1)
 active={...scope,[field]:'different'};parts.controller.activate();gate.resolve({instanceId:91,status:'COMPLETED'});await tick()
 expect(parts.controller.getSnapshot()).toEqual([]);expect(parts.onRecovered).not.toHaveBeenCalled()
})
test('logout cancels local observation, not the server command; a new login cannot inherit it',async()=>{
 saved();let active=scope;const {controller,status,onRecovered}=setup({current:()=>active})
 controller.activate();active=null;controller.activate();await tick()
 expect(controller.getSnapshot()).toEqual([]);expect(onRecovered).not.toHaveBeenCalled()
 active={...scope,sessionId:'new-login'};controller.activate();expect(status).toHaveBeenCalledTimes(1)
})
test.each([
 '{broken',JSON.stringify({version:2,scope,commands:[command]}),
 JSON.stringify({version:1,scope,commands:[{...command,instanceId:0}]}),
 JSON.stringify({version:1,scope,commands:[{...command,actionType:'driver.order.delete'}]}),
 JSON.stringify({version:1,scope,commands:[{...command,orderId:'<script>'}]}),
 JSON.stringify({version:1,scope,commands:[command,command]}),
 JSON.stringify({version:1,scope,commands:[command,{...command,instanceId:92}]}),
 JSON.stringify({version:1,scope,commands:Array.from({length:51},(_,i)=>({...command,orderId:String(i+1),instanceId:i+1}))}),
])('invalid journals do not start observation: %#',async(raw)=>{
 sessionStorage.setItem(KEY,raw);const {controller,status}=setup();controller.activate();await tick()
 expect(status).not.toHaveBeenCalled();expect(controller.getSnapshot()).toEqual([])
})
test('a storage failure keeps the current action protected and exposes that reload cannot recover it',()=>{
 const {controller}=setup({storage:{getItem:()=>null,setItem:()=>{throw Error('quota')},removeItem:()=>{}}})
 controller.activate();controller.remember({...command,baseline:{state:null}},scope)
 expect(controller.getSnapshot()[0].durable).toBe(false)
 expect(()=>controller.assertCanSend('42')).toThrow()
})
test('snapshot-only fallback cannot claim completion of a restored command',()=>{
 saved();const waiter={wait:jest.fn(),cancelAll:jest.fn()},controller=new DriverCommandRecovery(waiter,{scope:()=>scope})
 controller.activate();expect(waiter.wait).not.toHaveBeenCalled();expect(controller.getSnapshot()).toEqual([])
})

test('unknown FAILED status remains pending until a fresh server snapshot proves reconciliation',async()=>{
 saved()
 const waiter=new CommandStatusDriverCommandCompletionWaiter({getStatus:jest.fn().mockResolvedValue({instanceId:91,status:'FAILED',errorCode:'CORE_OUTCOME_UNKNOWN'})},500,100)
 const verifyReconciliation=jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
 const controller=new DriverCommandRecovery(waiter,{scope:()=>scope,storage:sessionStorage,verifyReconciliation})
 controller.activate();await tick();await tick()
 expect(controller.hasPending('42')).toBe(true)
 expect(sessionStorage.getItem(KEY)).toContain('91')
 controller.dismiss(91);expect(controller.hasPending('42')).toBe(true)
 controller.retry(91);await tick();await tick()
 expect(verifyReconciliation).toHaveBeenCalledTimes(2)
 expect(controller.hasPending('42')).toBe(false)
 expect(sessionStorage.getItem(KEY)).toBeNull()
})
