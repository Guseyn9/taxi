import {claimDriverOfferNotification as claim} from './driverOfferNotifications'
import {saveSessionTokens,clearSessionTokens} from '../security/sessionTokens'
jest.mock('../config',()=>({__esModule:true,default:{API_URL:'test-service'}}))
beforeEach(()=>{clearSessionTokens();sessionStorage.clear();saveSessionTokens({token:Math.random().toString(),u_hash:'test-only'})})
it('three mounted views and reload display an acceptance only once for the same login',()=>{
 expect(claim('42','driver1','accepted')).toBe(true)
 expect(claim('42','driver1','accepted')).toBe(false)
 let fresh:any;jest.isolateModules(()=>{fresh=require('./driverOfferNotifications')})
 expect(fresh.claimDriverOfferNotification('42','driver1','accepted')).toBe(false)
 expect(claim('43','driver1','accepted')).toBe(true)
})
it('another driver or a new login has its own notification history',()=>{
 expect(claim('42','driver1','accepted')).toBe(true)
 expect(claim('42','driver2','accepted')).toBe(true)
 clearSessionTokens();saveSessionTokens({token:'new-login',u_hash:'test-only'})
 expect(claim('42','driver1','accepted')).toBe(true)
})
it('blocked storage still deduplicates competing mounted views',()=>{
 const write=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')})
 try{expect(claim('77','driver1','accepted')).toBe(true);expect(claim('77','driver1','accepted')).toBe(false)}finally{write.mockRestore()}
})
