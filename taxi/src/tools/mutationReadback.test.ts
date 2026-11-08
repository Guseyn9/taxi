import {isAmbiguousMutationError, MutationReadbackGuard} from './mutationReadback'
beforeEach(()=>sessionStorage.clear())
const timeout=()=>Object.assign(new Error('request timed out'),{code:'ECONNABORTED'})
it('does not retry a timed-out write and acknowledges only a matching real readback',async()=>{
 const guard=new MutationReadbackGuard(),write=jest.fn().mockRejectedValue(timeout()),read=jest.fn().mockResolvedValue(5),checking=jest.fn()
 await expect(guard.run('driver:42',5,write,read,checking)).resolves.toEqual({verifiedState:5})
 expect(write).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(1)
 expect(checking.mock.calls).toEqual([[true],[false]])
})
it('recognizes the actual Axios 0.21 network error and server timeouts without treating a refusal as success',()=>{
 expect(isAmbiguousMutationError(Object.assign(new Error('Network Error'),{isAxiosError:true,code:null}))).toBe(true)
 expect(isAmbiguousMutationError({isAxiosError:true,response:{status:503}})).toBe(true)
 expect(isAmbiguousMutationError({isAxiosError:true,response:{status:403}})).toBe(false)
 expect(isAmbiguousMutationError(new Error('wrong PIN'))).toBe(false)
})
it('keeps an unknown outcome after reload and reads it before allowing another write',async()=>{
 const network=Object.assign(new Error('Network Error'),{isAxiosError:true,code:null})
 const first=new MutationReadbackGuard(),write=jest.fn().mockRejectedValue(network)
 await expect(first.run('d:43',5,write,async()=>{throw new Error('offline')},jest.fn())).rejects.toMatchObject({code:'ORDER_STATE_UNKNOWN'})
 const reloaded=new MutationReadbackGuard(),read=jest.fn().mockResolvedValue(5)
 await expect(reloaded.run('d:43',5,write,read,jest.fn())).resolves.toEqual({verifiedState:5})
 expect(read).toHaveBeenCalledTimes(1);expect(write).toHaveBeenCalledTimes(1)
})
it('records the pending write before the response, so a reload cannot lose it',async()=>{
 let resolve:(value:string)=>void=()=>{}
 const first=new MutationReadbackGuard(),request=jest.fn(()=>new Promise<string>(done=>{resolve=done}))
 const pending=first.run('d:44',5,request,async()=>4,jest.fn())
 const reloaded=new MutationReadbackGuard(),write=jest.fn()
 await expect(reloaded.run('d:44',5,write,async()=>{throw new Error('offline')},jest.fn())).rejects.toThrow('offline')
 expect(write).not.toHaveBeenCalled()
 resolve('ok');await pending
 expect(JSON.parse(sessionStorage.getItem('taxi.lifecycle.pending.v1')||'{}')).toEqual({})
})
it('keeps a refused transition refused and does not turn an unchanged state into success',async()=>{
 const guard=new MutationReadbackGuard(),read=jest.fn().mockResolvedValue(4)
 await expect(guard.run('d:42',5,async()=>{throw timeout()},read,jest.fn())).rejects.toMatchObject({code:'ECONNABORTED'})
 const rejected=Object.assign(new Error('wrong PIN'),{code:'BACKEND_RESPONSE_ERROR'})
 await expect(guard.run('d:42',5,async()=>{throw rejected},read,jest.fn())).rejects.toBe(rejected)
 expect(read).toHaveBeenCalledTimes(1)
})
it('an unknown outcome blocks later writes until readback succeeds; an applied write is never sent twice',async()=>{
 const guard=new MutationReadbackGuard(),write=jest.fn().mockRejectedValue(timeout()),read=jest.fn().mockRejectedValue(new Error('offline'))
 await expect(guard.run('d:42',5,write,read,jest.fn())).rejects.toMatchObject({code:'ORDER_STATE_UNKNOWN'})
 await expect(guard.run('d:42',5,write,read,jest.fn())).rejects.toThrow('offline')
 expect(write).toHaveBeenCalledTimes(1)
 read.mockResolvedValue(5)
 await expect(guard.run('d:42',5,write,read,jest.fn())).resolves.toEqual({verifiedState:5})
 expect(write).toHaveBeenCalledTimes(1)
})
it('waits for verification before another click can send a command',async()=>{
 let finish:(state:number)=>void=()=>{}
 const guard=new MutationReadbackGuard(),write=jest.fn().mockRejectedValue(timeout())
 const pending=guard.run('d:42',5,write,()=>new Promise<number>(resolve=>{finish=resolve}),jest.fn())
 await Promise.resolve();await Promise.resolve()
 await expect(guard.run('d:42',5,write,async()=>5,jest.fn())).rejects.toMatchObject({code:'MUTATION_IN_PROGRESS'})
 finish(5);await pending;expect(write).toHaveBeenCalledTimes(1)
})
