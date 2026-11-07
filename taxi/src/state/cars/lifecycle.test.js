jest.mock('../../API',()=>({getUserCars:jest.fn(),driveCar:jest.fn(),getAuthorizedUser:jest.fn(),createUserCar:jest.fn(),editCar:jest.fn()}))
jest.mock('../user/selectors',()=>({user:state=>state.user}))
jest.mock('../user/actionCreators',()=>({setUser:user=>({type:'SET_USER',payload:user})}))
jest.mock('../../security/sessionTokens',()=>({getSessionRecoveryId:jest.fn(()=> 'session-a')}))
const {runSaga} = require('redux-saga')
const API = require('../../API'), {getSessionRecoveryId} = require('../../security/sessionTokens')
const {getUserCarsSaga} = require('./sagas'), {activateVehicle,createUserCar,edit} = require('./actionCreators')
const reducer = require('./reducer').default, {ActionTypes} = require('./constants')
const {ActionTypes:UserActions} = require('../user/constants')
const {userDrivenCar,userPrimaryCar} = require('./selectors')
beforeEach(()=>{jest.clearAllMocks();getSessionRecoveryId.mockReturnValue('session-a')})
it('only the backend-driven non-first car is selected; no marked car means no active car',()=>{
  const first={c_id:'1',u_d_id:null}, active={c_id:'2',u_d_id:'driver'}
  const cars=reducer(undefined,{type:ActionTypes.GET_USER_CARS_SUCCESS,payload:[first,active]})
  expect(userDrivenCar({cars,user:{u_id:'driver'}})).toEqual(active)
  expect(userPrimaryCar({cars,user:{u_id:'driver'}})).toEqual(first)
  expect(userDrivenCar({cars,user:{u_id:'other'}})).toBeNull()
  expect(reducer(cars,{type:UserActions.LOGOUT_START}).userCars).toBeUndefined()
})
it('same-user refresh is repeatable and a response from an obsolete session is discarded',async()=>{
  const actions=[], user={u_id:'driver'}
  API.getUserCars.mockResolvedValue([{c_id:'1'}])
  for(let i=0;i<2;i++)await runSaga({dispatch:a=>actions.push(a),getState:()=>({user})},getUserCarsSaga,{type:ActionTypes.GET_USER_CARS_REQUEST}).toPromise()
  expect(API.getUserCars).toHaveBeenCalledTimes(2)
  let resolve;API.getUserCars.mockImplementation(()=>new Promise(yes=>{resolve=yes}))
  const task=runSaga({dispatch:a=>actions.push(a),getState:()=>({user})},getUserCarsSaga,{type:ActionTypes.GET_USER_CARS_REQUEST})
  getSessionRecoveryId.mockReturnValue('session-b');resolve([{c_id:'old'}]);await task.toPromise()
  expect(actions.filter(a=>a.type===ActionTypes.GET_USER_CARS_SUCCESS)).toHaveLength(2)
})
it('explicit activation waits for both canonical user and active-vehicle readback',async()=>{
  const active={c_id:'2',u_d_id:'driver'}, actions=[]
  API.driveCar.mockResolvedValue({code:'200',data:{}})
  API.getUserCars.mockResolvedValue([active]);API.getAuthorizedUser.mockResolvedValue({u_id:'driver'})
  expect(await activateVehicle(active)(a=>actions.push(a))).toEqual(active)
  expect(actions.map(a=>a.type)).toEqual([ActionTypes.GET_USER_CARS_SUCCESS,'SET_USER'])
  API.getUserCars.mockResolvedValue([{...active,u_d_id:null}])
  await expect(activateVehicle(active)(()=>{})).rejects.toThrow('reconciliation')
})
it('creation awaits authoritative membership and never retries a possibly successful create',async()=>{
  const actions=[]
  API.createUserCar.mockResolvedValue({code:'200',data:{created_car:{c_id:'3'}}})
  API.getUserCars.mockResolvedValue([])
  await expect(createUserCar({})(a=>actions.push(a))).rejects.toThrow('reconciliation')
  expect(API.createUserCar).toHaveBeenCalledTimes(1);expect(actions).toEqual([])
  API.getUserCars.mockResolvedValue([{c_id:'3'}])
  await createUserCar({})(a=>actions.push(a))
  expect(actions.map(a=>a.type)).toEqual([ActionTypes.GET_USER_CARS_SUCCESS])
})
it('vehicle edits reconcile both car and current user before reporting completion',async()=>{
  const actions=[]
  API.editCar.mockResolvedValue({code:'200',data:{}})
  API.getUserCars.mockResolvedValue([{c_id:'2',u_d_id:'driver'}])
  API.getAuthorizedUser.mockResolvedValue({u_id:'driver'})
  await edit('2',{})(a=>actions.push(a))
  expect(actions.map(a=>a.type)).toEqual([ActionTypes.START_MUTATION,ActionTypes.GET_USER_CARS_SUCCESS,'SET_USER',ActionTypes.END_MUTATION])
})

it.each(['activate','create','edit'])('vehicle %s rejects HTTP-200 business errors before any success projection',async operation=>{
 const error={code:'200',status:'error',message:'rejected'}, actions=[]
 API.driveCar.mockResolvedValue(error);API.createUserCar.mockResolvedValue(error);API.editCar.mockResolvedValue(error)
 const run=operation==='activate'?activateVehicle({c_id:'2'}):operation==='create'?createUserCar({}):edit('2',{})
 await expect(run(a=>actions.push(a))).rejects.toThrow('rejected')
 expect(API.getUserCars).not.toHaveBeenCalled();expect(actions.some(a=>a.type===ActionTypes.GET_USER_CARS_SUCCESS)).toBe(false)
})
