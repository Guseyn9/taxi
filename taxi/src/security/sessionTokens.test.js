import {loadSessionTokens,saveSessionTokens,clearSessionTokens,getSessionRecoveryId} from './sessionTokens'
beforeEach(()=>{clearSessionTokens();localStorage.clear();sessionStorage.clear()})
test('migrates legacy credentials once and retains reload auth only in the current tab session',()=>{
 localStorage.setItem('state.user.tokens',JSON.stringify({token:'test-token',u_hash:'test-hash'}))
 expect(loadSessionTokens()).toEqual({token:'test-token',u_hash:'test-hash'})
 expect(localStorage.getItem('state.user.tokens')).toBeNull()
 expect(JSON.parse(sessionStorage.getItem('state.user.tokens'))).toEqual({token:'test-token',u_hash:'test-hash'})
 expect(loadSessionTokens()).toEqual({token:'test-token',u_hash:'test-hash'})
 clearSessionTokens();expect(loadSessionTokens()).toBeNull();expect(sessionStorage.getItem('state.user.tokens')).toBeNull()
})
test('rejects corrupt sessions and never persists extra server fields',()=>{
 sessionStorage.setItem('state.user.tokens','{bad');expect(loadSessionTokens()).toBeNull()
 expect(()=>saveSessionTokens({token:'',u_hash:'hash'})).toThrow()
 saveSessionTokens({token:'token',u_hash:'hash',other:'not-kept'})
 expect(sessionStorage.getItem('state.user.tokens')).not.toContain('not-kept')
})
test('logout invalidates a duplicated tab even if it restores its old sessionStorage snapshot',()=>{
 saveSessionTokens({token:'token',u_hash:'hash'})
 const snapshot=sessionStorage.getItem('state.user.tokens'),epoch=sessionStorage.getItem('taxi.auth.session-epoch')
 clearSessionTokens()
 sessionStorage.setItem('state.user.tokens',snapshot);sessionStorage.setItem('taxi.auth.session-epoch',epoch)
 expect(loadSessionTokens()).toBeNull();expect(sessionStorage.getItem('state.user.tokens')).toBeNull()
})
test('other tabs receive logout revocation while unrelated storage changes do nothing',()=>{
 const {subscribeSessionRevocation}=require('./sessionTokens'),listener=jest.fn(),stop=subscribeSessionRevocation(listener)
 saveSessionTokens({token:'token',u_hash:'hash'})
 window.dispatchEvent(new StorageEvent('storage',{key:'unrelated'}));expect(listener).not.toHaveBeenCalled()
 window.dispatchEvent(new StorageEvent('storage',{key:'taxi.auth.revocation',newValue:'changed'}));expect(listener).toHaveBeenCalledTimes(1)
 expect(loadSessionTokens()).toBeNull();stop()
})
test('recovery identity survives a module reload but rotates with credentials and logout',()=>{
 saveSessionTokens({token:'first',u_hash:'first-hash'});const first=getSessionRecoveryId()
 expect(first).toBeTruthy();expect(getSessionRecoveryId()).toBe(first)
 let reloaded
 jest.isolateModules(()=>{reloaded=require('./sessionTokens');expect(reloaded.loadSessionTokens()).toEqual({token:'first',u_hash:'first-hash'});expect(reloaded.getSessionRecoveryId()).toBe(first)})
 saveSessionTokens({token:'second',u_hash:'second-hash'});expect(getSessionRecoveryId()).not.toBe(first)
 clearSessionTokens();expect(getSessionRecoveryId()).toBeNull()
})
test('reading an initialized recovery identity does not write storage during UI rendering',()=>{
 saveSessionTokens({token:'current',u_hash:'current-hash'});const first=getSessionRecoveryId()
 const write=jest.spyOn(Storage.prototype,'setItem')
 try{expect(getSessionRecoveryId()).toBe(first);expect(write).not.toHaveBeenCalled()}finally{write.mockRestore()}
})
test('quota errors must not sign back into an old account or reuse its recovery identity',()=>{
 saveSessionTokens({token:'old',u_hash:'old-hash'});const old=getSessionRecoveryId()
 const write=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')})
 try{saveSessionTokens({token:'new',u_hash:'new-hash'});expect(loadSessionTokens()).toEqual({token:'new',u_hash:'new-hash'});expect(getSessionRecoveryId()).not.toBe(old)}finally{write.mockRestore()}
})
test('a valid new in-memory login survives an undeletable stale storage record after revocation',()=>{
 saveSessionTokens({token:'old',u_hash:'old-hash'})
 localStorage.setItem('taxi.auth.revocation','new-generation')
 const write=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked')})
 const remove=jest.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('blocked')})
 try{saveSessionTokens({token:'new',u_hash:'new-hash'});expect(loadSessionTokens()).toEqual({token:'new',u_hash:'new-hash'})}finally{write.mockRestore();remove.mockRestore()}
})
