import {runSaga} from 'redux-saga'
import {setLanguageSaga} from './sagas'
import * as API from '../../API'
import {ActionTypes} from './constants'
jest.mock('../../state',()=>({__esModule:true,default:{getState:()=>({})}}))
jest.mock('../../config',()=>({__esModule:true,default:{}}))
jest.mock('../../siteConstants',()=>({__esModule:true,default:{},CURRENCY:{}}))
jest.mock('../../API',()=>({editUser:jest.fn()}))
jest.mock('../user',()=>({userSelectors:{user:state=>state.user}}))
const language={id:9,iso:'ar-Arab'}
beforeEach(()=>jest.clearAllMocks())
it('changes and persists a guest language without a protected profile request',async()=>{
 const actions=[]
 await runSaga({dispatch:action=>actions.push(action),getState:()=>({user:null})},setLanguageSaga,{payload:language}).toPromise()
 expect(actions).toEqual([{type:ActionTypes.SET_LANGUAGE,payload:language}]);expect(document.cookie).toContain('user_lang=ar-Arab');expect(API.editUser).not.toHaveBeenCalled()
})
it('also saves the selected language for an authenticated profile',async()=>{
 API.editUser.mockResolvedValue({code:'200'})
 await runSaga({dispatch:()=>{},getState:()=>({user:{u_id:'fixture'}})},setLanguageSaga,{payload:language}).toPromise()
 expect(API.editUser).toHaveBeenCalledWith({u_lang:9})
})
it('keeps the local selection when saving an authenticated preference fails',async()=>{
 const actions=[],log=jest.spyOn(console,'error').mockImplementation(()=>{})
 API.editUser.mockRejectedValue(new Error('offline'))
 try {await runSaga({dispatch:action=>actions.push(action),getState:()=>({user:{u_id:'fixture'}})},setLanguageSaga,{payload:language}).toPromise();expect(actions).toEqual([{type:ActionTypes.SET_LANGUAGE,payload:language}])} finally {log.mockRestore()}
})
