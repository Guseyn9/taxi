const mockResolvers={}
function* mockIdle(){yield require('redux-saga/effects').take('NEVER')}
jest.mock('./geolocation/sagas',()=>({saga:mockIdle}))
jest.mock('./user/sagas',()=>({saga:mockIdle}))
jest.mock('./cars/sagas',()=>({saga:mockIdle}))
jest.mock('./orders/sagas',()=>({saga:mockIdle}))
jest.mock('./ordersDetails/sagas',()=>({saga:mockIdle}))
jest.mock('./order/sagas',()=>({saga:mockIdle}))
jest.mock('./config/sagas',()=>({saga:mockIdle}))
jest.mock('./areas/sagas',()=>({saga:mockIdle}))
jest.mock('./clientOrder/sagas',()=>({saga:function*(){
  const {takeEvery,call,put}=require('redux-saga/effects')
  yield takeEvery('LOOKUP',function*({id}){
    yield call(()=>new Promise(resolve=>{mockResolvers[id]=resolve}))
    yield put({type:'PRIVATE_RESULT',payload:id})
  })
}}))
it('cancels old domain tasks at an identity boundary and restarts fresh watchers',async()=>{
  const {runSaga,stdChannel}=require('redux-saga'),{domainSupervisor}=require('./rootSaga'),{SESSION_DOMAIN_RESET}=require('../security/sessionLifecycle')
  const channel=stdChannel(),results=[]
  const task=runSaga({channel,dispatch:action=>{results.push(action);channel.put(action)}},domainSupervisor)
  try {
    channel.put({type:'LOOKUP',id:'A'})
    channel.put({type:SESSION_DOMAIN_RESET})
    mockResolvers.A();await Promise.resolve();await Promise.resolve()
    expect(results).toEqual([])
    channel.put({type:'LOOKUP',id:'B'});mockResolvers.B()
    await Promise.resolve();await Promise.resolve()
    expect(results).toEqual([{type:'PRIVATE_RESULT',payload:'B'}])
  } finally {task.cancel();await task.toPromise()}
})
