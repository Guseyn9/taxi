jest.mock('./workerFactory',()=>({createGraphWorker:jest.fn()}))
const fixture={id:0,nodes:[{id:1,latitude:30.4,longitude:-9.5},{id:2,latitude:30.401,longitude:-9.5}],ways:[{id:1,segments:[{nodeId:1,weight:0},{nodeId:2,weight:10}]}]}
let originalWorker
beforeEach(()=>{jest.resetModules();originalWorker=global.Worker;global.Worker=function(){}})
afterEach(()=>{global.Worker=originalWorker})
test('API to worker to Redux selector preserves a usable shared graph without rebuilding source JSON',async()=>{
 const {packArea}=require('./packed'),packet=packArea(fixture),{createGraphWorker}=require('./workerFactory')
 const worker={terminate:jest.fn(),postMessage:jest.fn(()=>Promise.resolve().then(()=>worker.onmessage({data:{id:1,packet,metrics:{source:'indexeddb',nodes:2,jsonMs:0,prepareMs:0,workerMs:1}}}))) }
 createGraphWorker.mockReturnValue(worker)
 const {getArea}=require('../API/way'),values=await Promise.all([getArea(0),getArea(0)])
 expect(createGraphWorker).toHaveBeenCalledTimes(1);expect(worker.terminate).toHaveBeenCalledTimes(1)
 expect(values[0]).toBe(values[1]);expect(values[0].nodes).toEqual([])
 const reducer=require('../state/areas/reducer').default,{ActionTypes}=require('../state/areas/constants'),{wayGraph}=require('../state/areas/selectors')
 const state={areas:reducer(undefined,{type:ActionTypes.GET_AREA_SUCCESS,payload:values[0]})},graph=wayGraph(state)
 expect(graph.findShortestPath(1,2)[1]).toBe(10);expect(wayGraph(state)).toBe(graph)
 expect((await getArea(0))).toBe(values[0]);expect(createGraphWorker).toHaveBeenCalledTimes(1)
})
test('worker startup errors stay recoverable and do not permanently cache a failed load',async()=>{
 const {createGraphWorker}=require('./workerFactory');createGraphWorker.mockImplementation(()=>{throw new Error('worker blocked')})
 const {getArea}=require('../API/way'),{graphState}=require('./client')
 await expect(getArea(0)).rejects.toThrow('worker blocked');await expect(getArea(0)).rejects.toThrow('worker blocked')
 expect(createGraphWorker).toHaveBeenCalledTimes(2);expect(graphState().status).toBe('error')
})
test('postMessage failure terminates the worker immediately and a later attempt can recover',async()=>{
 const {createGraphWorker}=require('./workerFactory'),worker={terminate:jest.fn(),postMessage:jest.fn(()=>{throw new Error('post blocked')})}
 createGraphWorker.mockReturnValue(worker)
 const {loadRoadArea}=require('./client')
 await expect(loadRoadArea()).rejects.toThrow('post blocked')
 expect(worker.terminate).toHaveBeenCalledTimes(1);expect(worker.onmessage).toBeNull();expect(worker.onerror).toBeNull()
 await expect(loadRoadArea()).rejects.toThrow('post blocked');expect(createGraphWorker).toHaveBeenCalledTimes(2)
})
test('timeout terminates one shared worker, rejects all consumers, and permits retry',async()=>{
 jest.useFakeTimers()
 try{
  const {createGraphWorker}=require('./workerFactory'),worker={terminate:jest.fn(),postMessage:jest.fn()};createGraphWorker.mockReturnValue(worker)
  const {loadRoadArea}=require('./client'),pending=loadRoadArea(),assertion=expect(pending).rejects.toThrow('timed out')
  expect(loadRoadArea()).toBe(pending);jest.advanceTimersByTime(30000);await assertion
  expect(worker.terminate).toHaveBeenCalledTimes(1);expect(worker.onmessage).toBeNull()
  const retry=loadRoadArea(),next=expect(retry).rejects.toThrow('timed out');jest.advanceTimersByTime(30000);await next
  expect(createGraphWorker).toHaveBeenCalledTimes(2)
 }finally{jest.useRealTimers()}
})
