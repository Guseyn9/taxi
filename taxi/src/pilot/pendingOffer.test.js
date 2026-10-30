import {pendingOffer,markPendingOffer,recoverOffer} from './pendingOffer'
import {verifyCreatedOffer} from './verifyOffer'
const opts={isOffer:o=>o.mode==='offer',isTerminal:o=>o.closed===true}
afterEach(()=>{markPendingOffer('u','A',false);localStorage.clear()})
it('persists the exact identity across module reload, isolated by account and booking',()=>{
 markPendingOffer('u','A')
 expect(pendingOffer('other','A')).toBe(false)
 expect(pendingOffer('u','B')).toBe(false)
 jest.resetModules()
 expect(require('./pendingOffer').pendingOffer('u','A')).toBe(true)
 markPendingOffer('u','A',false)
 expect(pendingOffer('u','A')).toBe(false)
})
it('failed verification and failed cancellation retain a marker until a confirmed read, without another mutation',async()=>{
 const read=jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({mode:'order'}).mockResolvedValueOnce({mode:'offer'})
 const cancel=jest.fn().mockRejectedValue(Error('refused'))
 markPendingOffer('u','A')
 expect(await verifyCreatedOffer({read,isOffer:opts.isOffer,cancel})).toBe('unverified')
 expect(pendingOffer('u','A')).toBe(true)
 expect(await verifyCreatedOffer({read,isOffer:opts.isOffer,cancel})).toBe('retained')
 expect(pendingOffer('u','A')).toBe(true)
 expect(await recoverOffer({...opts,read})).toBe('verified')
 expect(cancel).toHaveBeenCalledTimes(1)
})
it('keeps unknown and mismatch separate from successful or terminal recovery',async()=>{
 for(const [value,state] of [[null,'unknown'],[{mode:'order'},'mismatch'],[{mode:'offer'},'verified'],[{mode:'order',closed:true},'terminal']])
  expect(await recoverOffer({...opts,read:async()=>value})).toBe(state)
 expect(await recoverOffer({...opts,read:async()=>{throw Error('offline')}})).toBe('unknown')
})
