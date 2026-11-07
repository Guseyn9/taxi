import {writeRawLog} from '../tools/rawLog'
import {recordPlatformProvider,getPlatformProviderDiagnostics} from './platformProvider'
jest.mock('../tools/rawLog',()=>({writeRawLog:jest.fn()}))
test('provider diagnostics distinguish legacy commands from conditional FSM lifecycle without secrets',()=>{
 const old=process.env.REACT_APP_FSM_API_URL
 try{
  delete process.env.REACT_APP_FSM_API_URL;recordPlatformProvider('legacy-redux')
  expect(getPlatformProviderDiagnostics()).toMatchObject({snapshot:'legacy-redux',driverLifecycle:'legacy',completion:'legacy-response'})
  process.env.REACT_APP_FSM_API_URL='https://private.test';recordPlatformProvider('fsm-driver')
  expect(getPlatformProviderDiagnostics()).toMatchObject({snapshot:'fsm-driver',driverLifecycle:'fsm',otherBusinessCommands:'legacy'})
  expect(JSON.stringify(writeRawLog.mock.calls)).not.toContain('private.test')
 }finally{if(old===undefined)delete process.env.REACT_APP_FSM_API_URL;else process.env.REACT_APP_FSM_API_URL=old}
})
