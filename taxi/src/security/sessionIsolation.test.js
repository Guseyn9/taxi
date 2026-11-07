jest.mock('../state',()=>({__esModule:true,default:{dispatch:jest.fn(),getState:()=>({})}}))
jest.mock('../API',()=>({login:jest.fn(),logout:jest.fn()}))
jest.mock('../state/user/helpers',()=>({uploadRegisterFiles:jest.fn(),uploadFiles:jest.fn()}))
const {createStore,applyMiddleware}=require('redux'),thunk=require('redux-thunk').default
const {sessionLifecycleMiddleware}=require('../state/sessionLifecycleMiddleware')
const {SESSION_DOMAIN_RESET,sessionGeneration,advanceSessionGeneration,setPrivateDataOwner}=require('./sessionLifecycle')
const {ActionTypes:U}=require('../state/user/constants'),{ActionTypes:C}=require('../state/clientOrder/constants')
const rootReducer=require('../state/rootReducer').default
const {saveSessionTokens,loadSessionTokens,clearSessionTokens}=require('./sessionTokens')
beforeEach(()=>{localStorage.clear();sessionStorage.clear();clearSessionTokens();setPrivateDataOwner(null);jest.clearAllMocks()})
it('clears private Redux and storage state on logout even if revocation fails; config/language remain',()=>{
  const store=createStore(rootReducer,applyMiddleware(sessionLifecycleMiddleware,thunk))
  const user={u_id:'A'},tokens={token:'a',u_hash:'a-hash'}
  store.dispatch({type:U.LOGIN_SUCCESS,payload:{user,tokens}})
  store.dispatch({type:C.SET_PHONE,payload:'+212600000001'})
  localStorage.setItem('state.clientOrder.phone','"+212600000001"')
  const config=store.getState().config
  store.dispatch({type:U.LOGOUT_START})
  expect(store.getState().clientOrder.phone).toBeNull()
  expect(store.getState().cars.userCars).toBeUndefined()
  expect(store.getState().geolocation.geoposition).toBeUndefined()
  expect(store.getState().config).toBe(config)
  expect(localStorage.getItem('state.clientOrder.phone')).toBeNull()
})
it('a guest can retain the booking draft across initial login while an authenticated account switch cannot',()=>{
  const store=createStore(rootReducer,applyMiddleware(sessionLifecycleMiddleware,thunk))
  store.dispatch({type:C.SET_PHONE,payload:'+212600000001'})
  store.dispatch({type:U.LOGIN_START})
  expect(store.getState().clientOrder.phone).toBe('+212600000001')
  store.dispatch({type:U.LOGIN_SUCCESS,payload:{user:{u_id:'A'},tokens:{token:'a',u_hash:'a'}}})
  store.dispatch({type:U.LOGIN_START})
  expect(store.getState().clientOrder.phone).toBeNull()
})
it('late asynchronous thunk completions cannot repopulate state for another identity',async()=>{
  const store=createStore(rootReducer,applyMiddleware(sessionLifecycleMiddleware,thunk))
  let resolve
  const task=store.dispatch(async dispatch=>{await new Promise(yes=>{resolve=yes});dispatch({type:C.SET_PHONE,payload:'OLD'})})
  store.dispatch({type:SESSION_DOMAIN_RESET})
  resolve();await task
  expect(store.getState().clientOrder.phone).toBeNull()
})
it('external revocation clears credentials once without echoing another storage revocation',()=>{
  const store=createStore(rootReducer,applyMiddleware(sessionLifecycleMiddleware,thunk))
  saveSessionTokens({token:'a',u_hash:'a'})
  const writes=jest.spyOn(Storage.prototype,'setItem')
  try {
    store.dispatch({type:U.LOGOUT_START,payload:{externalRevocation:true}})
    expect(loadSessionTokens()).toBeNull()
    expect(writes.mock.calls.filter(([key])=>key==='taxi.auth.revocation')).toEqual([])
  } finally {writes.mockRestore()}
})
it('registration credentials and signup identity never survive logout or another login',()=>{
  const store=createStore(rootReducer,applyMiddleware(sessionLifecycleMiddleware,thunk))
  store.dispatch({type:U.REGISTER_SUCCESS,payload:{u_id:'A',token:'OLD_TOKEN',u_hash:'OLD_HASH',string:'OLD_PASSWORD'}})
  expect(JSON.stringify(store.getState().user.response)).not.toMatch(/OLD_TOKEN|OLD_HASH|OLD_PASSWORD/)
  store.dispatch({type:U.LOGIN_SUCCESS,payload:{user:{u_id:'A'},tokens:{token:'a',u_hash:'a'}}})
  store.dispatch({type:U.LOGOUT_START});store.dispatch({type:U.LOGIN_START})
  store.dispatch({type:U.LOGIN_SUCCESS,payload:{user:{u_id:'B'},tokens:{token:'b',u_hash:'b'}}})
  expect(store.getState().user.response).toBeNull()
  expect(store.getState().user.whatsappSignUpData.u_phone).toBe('')
})
it('old diagnostic trackers cannot refill cleared logs after an account boundary',()=>{
  const {trackOrderDecisions,emitDecisionHeartbeatNow}=require('../tools/orderDecisionTracker')
  const {getDecisionLogSnapshot}=require('../tools/decisionLog')
  const store=createStore(rootReducer,applyMiddleware(sessionLifecycleMiddleware,thunk))
  trackOrderDecisions({stage:'POLL_READY',orders:[{b_id:'OLD_ORDER',b_state:1,drivers:[]}],context:{user:{u_id:'OLD_DRIVER',u_role:2},car:{c_id:'old',seats:4},driverPosition:[30,-9],freeSeats:4,carCapacity:4,hiddenOrderIds:[],emulatorAnyModeRunning:false,externalEmulatorEnabled:false}})
  expect(JSON.stringify(getDecisionLogSnapshot())).toContain('OLD_DRIVER')
  store.dispatch({type:SESSION_DOMAIN_RESET})
  emitDecisionHeartbeatNow()
  expect(JSON.stringify(getDecisionLogSnapshot())).not.toMatch(/OLD_ORDER|OLD_DRIVER/)
})
it('personal address books are scoped to verified identity, with legacy unowned data excluded',()=>{
  const {rememberPersonalAddress,getPersonalAddressSuggestions}=require('../tools/addressBook')
  localStorage.setItem('taxi.personalAddressBook.v1',JSON.stringify([{address:'Legacy',latitude:1,longitude:2}]))
  setPrivateDataOwner('A');rememberPersonalAddress({address:'Private A',latitude:30,longitude:-9})
  expect(getPersonalAddressSuggestions('Private').map(item=>item.point.address)).toEqual(['Private A'])
  setPrivateDataOwner('B');expect(getPersonalAddressSuggestions('Private')).toEqual([])
  setPrivateDataOwner('A');expect(getPersonalAddressSuggestions('Private')).toHaveLength(1)
})
it('late login completion after logout never saves credentials or navigates',async()=>{
  const {runSaga}=require('redux-saga'),API=require('../API'),{loginSaga,logoutSaga}=require('../state/user/sagas')
  let resolve;API.login.mockImplementation(()=>new Promise(yes=>{resolve=yes}));API.logout.mockResolvedValue({status:'success'})
  const actions=[],navigate=jest.fn(),login=runSaga({dispatch:a=>actions.push(a)},loginSaga,{payload:{navigate}})
  await runSaga({dispatch:a=>actions.push(a)},logoutSaga).toPromise()
  resolve({data:null,tokens:{token:'obsolete',u_hash:'obsolete'},user:{u_id:'A',u_role:'client'}});await login.toPromise()
  expect(loadSessionTokens()).toBeNull();expect(navigate).not.toHaveBeenCalled()
  expect(actions.some(a=>a.type===U.LOGIN_SUCCESS)).toBe(false)
})

it('session reset clears queued messages but cannot reuse an old dialog acknowledgement id',()=>{
 const {ActionTypes:M}=require('../state/modals/constants')
 const store=createStore(rootReducer)
 const show=message=>({type:M.SET_MESSAGE_MODAL,payload:{isOpen:true,message}})
 store.dispatch(show('old'));const id=store.getState().modals.messageModal.id
 store.dispatch(show('old queued'));store.dispatch({type:SESSION_DOMAIN_RESET})
 expect(store.getState().modals.messageQueue).toHaveLength(0)
 store.dispatch(show('new'));store.dispatch({type:M.SET_MESSAGE_MODAL,payload:{isOpen:false,id}})
 expect(store.getState().modals.messageModal.message).toBe('new')
})
