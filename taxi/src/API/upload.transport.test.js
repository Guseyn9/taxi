import axios from 'axios'
import { uploadFile, makeRoutePoints } from './index'
jest.mock('axios',()=>({__esModule:true,default:{post:jest.fn(),get:jest.fn()}}))
jest.mock('./httpPolicy',()=>({}))
jest.mock('../state',()=>({__esModule:true,default:{getState:()=>({})}}))
jest.mock('../state/user',()=>({userSelectors:{tokens:()=>null,user:()=>null}}))
jest.mock('../state/config',()=>({configSelectors:{config:()=>null}}))
jest.mock('../config',()=>({__esModule:true,default:{API_URL:'https://local.example.invalid/api/v1'}}))
jest.mock('../siteConstants',()=>({__esModule:true,default:{TEST_USER_IDS:[]}}))
jest.mock('../localization',()=>({t:value=>value,TRANSLATION:{}}))
jest.mock('../tools/utils',()=>({getBase64:jest.fn(async()=> 'data:image/png;base64,test')}))
jest.mock('../tools/emulatorMode',()=>({isAnyBrowserEmulatorOrder:()=>false,isBrowserEmulatorRunning:()=>false}))
beforeEach(()=>jest.clearAllMocks())
it('does not send a shared route-provider credential when no public provider key is configured', async()=>{
  await expect(makeRoutePoints({latitude:30,longitude:-9},{latitude:31,longitude:-8})).rejects.toThrow('not configured')
  expect(axios.post).not.toHaveBeenCalled()
})
it('requests document privacy inside the JSON field the PHP handler actually reads',async()=>{
  axios.post.mockResolvedValue({data:{code:'200',status:'success',data:{dl_id:42}}})
  const result=await uploadFile({file:{},u_id:7,token:'test-token',u_hash:'test-hash'})
  const [url,form]=axios.post.mock.calls[0]
  expect(url).toBe('https://local.example.invalid/api/v1/dropbox/file')
  expect(JSON.parse(form.get('file'))).toEqual({base64:'data:image/png;base64,test',u_id:7,private:1})
  expect(form.get('private')).toBeNull();expect(result.dl_id).toBe('42')
})
it.each([{code:'404',status:'error',data:{}},{code:'200',status:'success',data:{}},{code:'200',status:'success',data:{dl_id:'1 OR 1=1'}}])('rejects business and malformed upload responses %p',async body=>{
  axios.post.mockResolvedValue({data:body})
  await expect(uploadFile({file:{},u_id:7})).rejects.toThrow('not confirmed')
})
