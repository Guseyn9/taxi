import {serviceEndpoints} from './serviceEndpoints'
const keys=['REACT_APP_API_ROOT','REACT_APP_DICTIONARY_ROOT'] as const
let saved:Record<string,string|undefined>
beforeEach(()=>{saved={};keys.forEach(key=>{saved[key]=process.env[key];delete process.env[key]})})
afterEach(()=>keys.forEach(key=>{if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]}))
it('keeps the existing default and derives the API and dictionary from the same tenant',()=>{
 expect(serviceEndpoints('gruzvill')).toEqual({serverUrl:'https://ibronevik.ru/taxi/c/gruzvill',apiUrl:'https://ibronevik.ru/taxi/c/gruzvill/api/v1',dictionaryUrl:'https://ibronevik.ru/taxi/cache/data_gruzvill.js'})
})
it('connects an isolated stand without leaving the dictionary on the old server',()=>{
 process.env.REACT_APP_API_ROOT='http://127.0.0.1:57100/taxi/'
 expect(serviceEndpoints('local')).toEqual({serverUrl:'http://127.0.0.1:57100/taxi/c/local',apiUrl:'http://127.0.0.1:57100/taxi/c/local/api/v1',dictionaryUrl:'http://127.0.0.1:57100/taxi/cache/data_local.js'})
 process.env.REACT_APP_DICTIONARY_ROOT='https://dictionary.example.test/config'
 expect(serviceEndpoints('local').dictionaryUrl).toBe('https://dictionary.example.test/config/data_local.js')
})
it('rejects insecure remote endpoints, URL credentials and query injection',()=>{
 for(const url of ['http://remote.example.test/taxi','https://user:password@example.test/taxi','javascript:alert(1)','https://example.test/taxi?token=secret']){
  process.env.REACT_APP_API_ROOT=url;expect(()=>serviceEndpoints('local')).toThrow()
 }
})
