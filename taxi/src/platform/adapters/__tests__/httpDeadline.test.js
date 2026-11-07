import { withHttpDeadline } from '../httpDeadline'
import { FsmTaxiCommandTransport } from '../FsmTaxiCommandTransport'
import { subscribeRecoveryPolling } from '../recoveryPolling'
import { readChannels } from '../../../diagnostics/readChannels'
import { readHealth } from '../../../design/reliability/readHealth'
import { FsmOrderSnapshotTransport } from '../FsmOrderSnapshotTransport'

const flush = async() => { for (let i=0;i<12;i++) await Promise.resolve() }
describe('finite HTTP deadlines and recovery',()=>{
 beforeEach(()=>jest.useFakeTimers())
 afterEach(()=>jest.useRealTimers())
 it('releases a hung acceptance even when fetch ignores cancellation, without retrying',async()=>{
  const fetch=jest.fn(()=>new Promise(()=>{}))
  const transport=new FsmTaxiCommandTransport({apiUrl:'https://local.test',acceptanceTimeoutMs:100},{fetch})
  const result=expect(transport.send(42,'driver_arrived')).rejects.toMatchObject({code:'FSM_COMMAND_ACCEPT_TIMEOUT'})
  await flush();jest.advanceTimersByTime(100);await result
  expect(fetch).toHaveBeenCalledTimes(1)
 })
 it('also bounds a response body that never settles',async()=>{
  const response={ok:true,status:202,json:()=>new Promise(()=>{})}
  const transport=new FsmTaxiCommandTransport({apiUrl:'https://local.test',acceptanceTimeoutMs:100},{fetch:()=>Promise.resolve(response)})
  const result=expect(transport.send(42,'driver_arrived')).rejects.toMatchObject({code:'FSM_COMMAND_ACCEPT_TIMEOUT'})
  await flush();jest.advanceTimersByTime(100);await result
 })
 it('clears its timer on success and preserves server rejection',async()=>{
  await expect(withHttpDeadline(async()=>7,100)).resolves.toBe(7)
  await expect(withHttpDeadline(async()=>{throw new Error('rejected')},100)).rejects.toThrow('rejected')
  expect(jest.getTimerCount()).toBe(0)
 })
 it('does not overlap polling, resumes after failure and stops publishing after unsubscribe',async()=>{
  let resolve; const load=jest.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockResolvedValue({revision:3})
  const listener=jest.fn();const stop=subscribeRecoveryPolling(load,listener,100)
  jest.advanceTimersByTime(100);await flush();expect(load).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(100);await flush();expect(load).toHaveBeenCalledTimes(2)
  jest.advanceTimersByTime(1000);await flush();expect(load).toHaveBeenCalledTimes(2)
  stop();resolve({revision:2});await flush();expect(listener).not.toHaveBeenCalled()
  jest.advanceTimersByTime(1000);expect(load).toHaveBeenCalledTimes(2)
 })
 it('recovers a missed passenger event while the WebSocket remains open and rejects a stale later Query',async()=>{
  let revision=1
  const socket={readyState:1,close:jest.fn()}
  const fetch=jest.fn(async()=>({ok:true,json:async()=>({orderId:42,revision,state:revision===1?'searching':'arrived'})}))
  const transport=new FsmOrderSnapshotTransport({apiUrl:'https://local.test',orderId:42,recoveryPollIntervalMs:100},{fetch,socketFactory:()=>socket})
  await transport.loadSnapshot()
  const listener=jest.fn();const stop=transport.subscribeSnapshots(listener)
  // Deliberately do not deliver a WebSocket message for revision 2.
  revision=2;jest.advanceTimersByTime(100);await flush()
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({state:expect.objectContaining({domainOrder:expect.objectContaining({snapshot:expect.objectContaining({revision:2,state:'arrived'})})})}))
  revision=1;jest.advanceTimersByTime(100);await flush()
  expect(listener).toHaveBeenCalledTimes(1)
  stop();expect(socket.close).toHaveBeenCalledTimes(1)
 })
})

it('surfaces recovery failures as stale health, keeps the last success time, and clears the channel on unsubscribe',async()=>{
 jest.useFakeTimers();jest.setSystemTime(10000)
 const load=jest.fn().mockResolvedValueOnce({revision:1}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({revision:2})
 const listener=jest.fn(),stop=subscribeRecoveryPolling(load,listener,100)
 try {
  await jest.advanceTimersByTimeAsync(100);const successful=readChannels()[0].updatedAt
  await jest.advanceTimersByTimeAsync(100);expect(readChannels()[0]).toMatchObject({failed:true,failures:1,updatedAt:successful})
  expect(readHealth().failed).toBe(true);expect(listener).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(100);expect(readChannels()[0]).toMatchObject({failed:false,failures:0});expect(listener).toHaveBeenCalledTimes(2)
 } finally {stop();expect(readChannels()).toEqual([]);jest.useRealTimers()}
})
