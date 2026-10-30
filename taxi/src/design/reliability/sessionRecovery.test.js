import {verifySession} from './sessionRecovery'
const tokens={token:'test',u_hash:'hash'},current=()=>tokens
it('preserves a session for network/server errors, accepts a verified profile and clears rejected auth',async()=>{
 expect(await verifySession(tokens,async()=>{throw new Error('offline')},current)).toEqual({kind:'retry'})
 expect(await verifySession(tokens,async()=>{throw {status:500}},current)).toEqual({kind:'retry'})
 expect(await verifySession(tokens,async()=>{throw {response:{status:401}}},current)).toEqual({kind:'invalid'})
 expect(await verifySession(tokens,async()=>null,current)).toEqual({kind:'invalid'})
 expect(await verifySession(tokens,async()=>({u_id:1419}),current)).toEqual({kind:'ready',user:{u_id:1419}})
})
it('cannot restore a profile after logout or after another account replaced its credentials',async()=>{
 expect(await verifySession(tokens,async()=>{throw {status:401}},()=>({...tokens,token:'new'}))).toEqual({kind:'stale'})
 expect(await verifySession(tokens,async()=>({u_id:1419}),()=>null)).toEqual({kind:'stale'})
 expect(await verifySession(tokens,async()=>({u_id:1419}),()=>({...tokens,token:'another'}))).toEqual({kind:'stale'})
})
