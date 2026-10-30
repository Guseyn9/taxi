import {createHash} from 'crypto'
import {loadPreparedGraph} from './loader'
const fixture={id:0,nodes:[{id:1,latitude:30.4,longitude:-9.5},{id:2,latitude:30.401,longitude:-9.5}],ways:[{id:1,segments:[{nodeId:1,weight:0},{nodeId:2,weight:10}]}]}
const digest=async text=>createHash('sha256').update(text).digest('hex')
function setup(){const store=new Map();let text=JSON.stringify(fixture),version=createHash('sha256').update(text).digest('hex');const cache={read:async key=>store.get(key),write:async(key,value)=>{store.set(key,value)}};const fetcher=jest.fn(async url=>url.includes('version.json')?{ok:true,json:async()=>({schema:1,version})}:{ok:true,text:async()=>text});return {store,cache,fetcher,change:()=>{text=JSON.stringify({...fixture,id:1});version=createHash('sha256').update(text).digest('hex')}}}
test('reopens a prepared persistent graph without downloading or parsing the 9MB JSON again',async()=>{
 const env=setup(),cold=await loadPreparedGraph(env.cache,env.fetcher,()=>0,digest),warm=await loadPreparedGraph(env.cache,env.fetcher,()=>0,digest)
 expect(cold.metrics.source).toBe('network');expect(cold.metrics.cacheStored).toBe(true);expect(warm.metrics.source).toBe('indexeddb');expect(warm.metrics.jsonMs).toBe(0);expect(warm.metrics.prepareMs).toBe(0)
 expect(env.fetcher.mock.calls.filter(([url])=>url.includes('agadir.json'))).toHaveLength(1)
 env.change();expect((await loadPreparedGraph(env.cache,env.fetcher,()=>0,digest)).metrics.source).toBe('network')
 expect(env.fetcher.mock.calls.filter(([url])=>url.includes('agadir.json'))).toHaveLength(2)
})
test('recovers corrupted cache, supports offline last-good data, and tolerates storage failure',async()=>{
 const env=setup();await loadPreparedGraph(env.cache,env.fetcher,()=>0,digest)
 const key=[...env.store.keys()].find(key=>key.startsWith('agadir:'));env.store.get(key).targets[0]=999
 expect((await loadPreparedGraph(env.cache,env.fetcher,()=>0,digest)).metrics.source).toBe('network')
 expect((await loadPreparedGraph(env.cache,async()=>{throw new Error('offline')},()=>0,digest)).metrics.source).toBe('offline-cache')
 const broken={read:async()=>{throw new Error('blocked')},write:async()=>{throw new Error('quota')}}
 expect((await loadPreparedGraph(broken,env.fetcher,()=>0,digest)).metrics.cacheStored).toBe(false)
})
test('does not accept a mismatched asset fingerprint or malformed manifest as a good cached graph',async()=>{
 const env=setup();await expect(loadPreparedGraph(env.cache,env.fetcher,()=>0,async()=> '0'.repeat(64))).rejects.toThrow('version mismatch')
 await expect(loadPreparedGraph(env.cache,async()=>({ok:true,json:async()=>({schema:1,version:'not-a-hash'})}),()=>0,digest)).rejects.toThrow('Invalid graph manifest')
})
test('manifest HTTP outage uses the last validated graph',async()=>{
 const env=setup();await loadPreparedGraph(env.cache,env.fetcher,()=>0,digest)
 const result=await loadPreparedGraph(env.cache,async()=>({ok:false,status:503}),()=>0,digest)
 expect(result.metrics.source).toBe('offline-cache');expect(result.metrics.jsonMs).toBe(0)
})
test('timeout also covers a stalled response body',async()=>{
 jest.useFakeTimers()
 try {
  const env=setup()
  const fetcher=async(url,{signal})=>({ok:true,json:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('body timeout'))))})
  const pending=loadPreparedGraph(env.cache,fetcher,()=>0,digest)
  const assertion=expect(pending).rejects.toThrow('body timeout')
  await Promise.resolve();jest.advanceTimersByTime(12000);await assertion
 } finally {jest.useRealTimers()}
})
