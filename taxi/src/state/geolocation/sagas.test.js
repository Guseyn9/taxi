jest.mock('../../tools/utils',()=>({getCurrentPosition:jest.fn(),HIGH_ACCURACY_GEOLOCATION_OPTIONS:{},firstItem:items=>items[0]}))
jest.mock('../../API/location',()=>({sendPosition:jest.fn()}))
const {runSaga}=require('redux-saga'),{getCurrentPosition}=require('../../tools/utils'),{sendPosition}=require('../../API/location')
const {getGeopositionSaga,sendPositionSaga}=require('./sagas'),reducer=require('./reducer').default
const {geoposition}=require('./selectors')
beforeEach(()=>jest.clearAllMocks())
it('an older timeout cannot invalidate a newer successful GPS read',async()=>{
  let rejectOld,resolveNew,state=reducer(undefined,{type:'INIT'})
  getCurrentPosition.mockImplementationOnce(()=>new Promise((_,no)=>{rejectOld=no})).mockImplementationOnce(()=>new Promise(yes=>{resolveNew=yes}))
  const options={dispatch:a=>{state=reducer(state,a)},getState:()=>({geolocation:state})}
  const old=runSaga(options,getGeopositionSaga),fresh=runSaga(options,getGeopositionSaga)
  const position={timestamp:Date.now(),coords:{latitude:0,longitude:0,accuracy:10}}
  resolveNew(position);await fresh.toPromise();rejectOld(Error('timeout'));await old.toPromise()
  expect(geoposition({geolocation:state})).toBe(position)
  sendPosition.mockResolvedValue({code:'200'})
  await runSaga(options,sendPositionSaga).toPromise();expect(sendPosition).toHaveBeenCalledWith(position.coords)
})
it('a current failed read clears the old fix and no stale position is sent',async()=>{
  const position={timestamp:Date.now(),coords:{latitude:0,longitude:0,accuracy:10}}
  let state=reducer(undefined,{type:require('./constants').ActionTypes.GET_SUCCESS,payload:position})
  const options={dispatch:a=>{state=reducer(state,a)},getState:()=>({geolocation:state})}
  getCurrentPosition.mockRejectedValue(Error('permission denied'))
  await runSaga(options,getGeopositionSaga).toPromise();await runSaga(options,sendPositionSaga).toPromise()
  expect(geoposition({geolocation:state})).toBeUndefined();expect(sendPosition).not.toHaveBeenCalled()
})
