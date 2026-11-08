/** @jest-environment node */
const {assertBrowserEnvironment}=require('../../tools/client-env-policy.js')
test('rejects shared FSM credentials without putting the value in the error',()=>{
 const secret='test-only-do-not-publish'
 expect(()=>assertBrowserEnvironment({REACT_APP_FSM_API_TOKEN:secret})).toThrow('must not be bundled')
 try{assertBrowserEnvironment({REACT_APP_FSM_API_TOKEN:secret})}catch(error){expect(error.message).not.toContain(secret)}
 expect(()=>assertBrowserEnvironment({REACT_APP_MAP_API_KEY:'public-browser-key',REACT_APP_FSM_API_TOKEN:''})).not.toThrow()
})
test.each(['../../config/env.js','../config/env.js'])('both webpack environment entry points reject secret injection: %s',entry=>{
 const old=process.env.REACT_APP_FSM_API_TOKEN;process.env.REACT_APP_FSM_API_TOKEN='test-only-fsm-secret'
 try{expect(()=>require(entry)('')).toThrow('must not be bundled')}finally{if(old===undefined)delete process.env.REACT_APP_FSM_API_TOKEN;else process.env.REACT_APP_FSM_API_TOKEN=old}
})

test('legacy build entry points delegate to one canonical configuration',()=>{
 expect(require('../config/env.js')).toBe(require('../../config/env.js'))
 expect(require('../config/webpack.config.js')).toBe(require('../../config/webpack.config.js'))
 expect(require('../config/paths.js')).toBe(require('../../config/paths.js'))
})
test('production rejects mixed FSM flags and fixed impersonation IDs',()=>{
 expect(()=>assertBrowserEnvironment({NODE_ENV:'production',REACT_APP_FSM_API_URL:'https://example.test'})).toThrow('COMMAND_STATUS')
 expect(()=>assertBrowserEnvironment({NODE_ENV:'production',REACT_APP_FSM_API_URL:'https://example.test',REACT_APP_FSM_COMMAND_STATUS_ENABLED:'true',REACT_APP_FSM_DRIVER_USER_ID:'1420'})).toThrow('identity')
 expect(()=>assertBrowserEnvironment({NODE_ENV:'production',REACT_APP_FSM_API_URL:'https://example.test',REACT_APP_FSM_COMMAND_STATUS_ENABLED:'true'})).not.toThrow()
})
