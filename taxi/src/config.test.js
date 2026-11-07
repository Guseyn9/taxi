jest.mock('./security/tenantDictionary',()=>({loadTenantDictionary:jest.fn()}))
jest.mock('./state',()=>({__esModule:true,default:{dispatch:jest.fn()}}))
jest.mock('./state/config/actionCreators',()=>({setConfigError:()=>({type:'CONFIG_ERROR'}),setConfigLoaded:()=>({type:'CONFIG_LOADED'})}))
let Config,version,dispatch
const dictionary = {dictionary:{langs:{1:{iso:'en',native:'English'}}},metadata:{version:'v1'}}
const endpointEnvKeys=['REACT_APP_API_ROOT','REACT_APP_DICTIONARY_ROOT','REACT_APP_SERVICE_CONFIG','REACT_APP_ALLOWED_SERVICE_CONFIGS']
let endpointEnv
beforeEach(()=>{
 endpointEnv=Object.fromEntries(endpointEnvKeys.map(key=>[key,process.env[key]]))
 endpointEnvKeys.forEach(key=>{delete process.env[key]})
 jest.useFakeTimers();jest.resetModules();localStorage.clear()
 document.body.innerHTML='<div id="preloader" class="active"></div>'
 version=require('./security/tenantDictionary').loadTenantDictionary;dispatch=require('./state').default.dispatch
})
afterEach(()=>{
 jest.clearAllTimers();jest.useRealTimers();document.body.innerHTML=''
 endpointEnvKeys.forEach(key=>{if(endpointEnv[key]===undefined)delete process.env[key];else process.env[key]=endpointEnv[key]})
})
test('configuration JSON refusal reveals a retryable error instead of a permanent black loader',async()=>{
 version.mockRejectedValue(new Error('offline'));Config=require('./config').default
 await Promise.resolve();await Promise.resolve()
 expect(dispatch).toHaveBeenCalledWith({type:'CONFIG_ERROR'})
 expect(document.getElementById('preloader').classList.contains('active')).toBe(false)
})
test('a stalled JSON transfer has a bounded lifetime and late results cannot succeed',async()=>{
 let resolve;version.mockImplementation(()=>new Promise(yes=>{resolve=yes}));Config=require('./config').default
 jest.advanceTimersByTime(15000)
 expect(dispatch).toHaveBeenCalledWith({type:'CONFIG_ERROR'})
 resolve(1);await Promise.resolve()
 // Once timed out, the transfer must not restart or append its script.
 expect(document.querySelectorAll('script')).toHaveLength(0)
})
test('JSON dictionary uses the configured stand and fixed tenant without executing scripts',async()=>{
 const oldRoot=process.env.REACT_APP_API_ROOT,oldConfig=process.env.REACT_APP_SERVICE_CONFIG
 try{
  process.env.REACT_APP_API_ROOT='http://127.0.0.1:57100/taxi';process.env.REACT_APP_SERVICE_CONFIG='local'
  localStorage.setItem('config','gruzvill')
  version.mockResolvedValue(dictionary);Config=require('./config').default
  await Promise.resolve();await Promise.resolve()
  expect(version).toHaveBeenCalledWith('http://127.0.0.1:57100/taxi/c/local/api/v1')
  expect(document.querySelector('script')).toBeNull();expect(window.data).toEqual(dictionary.dictionary)
 }finally{
  if(oldRoot===undefined)delete process.env.REACT_APP_API_ROOT;else process.env.REACT_APP_API_ROOT=oldRoot
  if(oldConfig===undefined)delete process.env.REACT_APP_SERVICE_CONFIG;else process.env.REACT_APP_SERVICE_CONFIG=oldConfig
 }
})
test('query parameters cannot select unapproved tenant data',async()=>{
 const previous=process.env.REACT_APP_ALLOWED_SERVICE_CONFIGS;process.env.REACT_APP_ALLOWED_SERVICE_CONFIGS='approved'
 try{
  window.history.replaceState(null,'','/?config=untrusted');version.mockResolvedValue(dictionary);Config=require('./config').default
  await Promise.resolve();await Promise.resolve()
  expect(Config.SavedConfig).toBe('gruzvill');expect(version).toHaveBeenCalledWith('https://ibronevik.ru/taxi/c/gruzvill/api/v1')
  Config.setConfig('approved');await Promise.resolve();await Promise.resolve();expect(Config.SavedConfig).toBe('approved')
 }finally{window.history.replaceState(null,'','/');if(previous===undefined)delete process.env.REACT_APP_ALLOWED_SERVICE_CONFIGS;else process.env.REACT_APP_ALLOWED_SERVICE_CONFIGS=previous}
})
test('clearing browser configuration keeps the fixed stand tenant for API and dictionary',async()=>{
 process.env.REACT_APP_API_ROOT='http://127.0.0.1:57110/taxi'
 process.env.REACT_APP_SERVICE_CONFIG='local'
 localStorage.setItem('config','gruzvill')
 window.history.replaceState(null,'','/?clearConfig')
 version.mockResolvedValue(dictionary);Config=require('./config').default
 await Promise.resolve();await Promise.resolve()
 expect(Config.API_URL).toBe('http://127.0.0.1:57110/taxi/c/local/api/v1')
 expect(version).toHaveBeenCalledWith(Config.API_URL)
 expect(document.querySelector('script')).toBeNull();expect(window.data).toEqual(dictionary.dictionary)
})
