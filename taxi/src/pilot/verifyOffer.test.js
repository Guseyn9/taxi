import {verifyCreatedOffer} from './verifyOffer'
const execute=(overrides={})=>{
 const cancel=jest.fn(async()=>{})
 const read=jest.fn(async()=>({mode:'order'}))
 return {cancel,read,run:()=>verifyCreatedOffer({read,cancel,isOffer:o=>o.mode==='offer',...overrides})}
}
test('a server-normalized ordinary order is rolled back instead of displaying a creator-only Offer',async()=>{
 const t=execute();expect(await t.run()).toBe('canceled');expect(t.cancel).toHaveBeenCalledTimes(1)
})
test('a persisted Offer stays active',async()=>{const t=execute({read:async()=>({mode:'offer'})});expect(await t.run()).toBe('verified');expect(t.cancel).not.toHaveBeenCalled()})
test('read failures keep the created order visible and do not retry creation or cancel blindly',async()=>{const t=execute({read:async()=>{throw Error('offline')}});expect(await t.run()).toBe('unverified');expect(t.cancel).not.toHaveBeenCalled()})
test('cancellation failure reports retained order',async()=>{const t=execute({cancel:async()=>{throw Error('server')}});expect(await t.run()).toBe('retained')})
