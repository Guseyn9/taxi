import {driverPickupStage,performPickupStage,readDriverDepartures,rememberDriverDeparture} from './driverPickupJourney'
import {EBookingDriverState as S,EBookingStates} from '../types/types'
import {resolvePassengerUiState} from '../pages/Passenger/uiFsm'

beforeEach(()=>sessionStorage.clear())
it('depart does not publish arrived; arrival requires the actual pickup point',async()=>{
  let backend=S.Performer,departed=false
  const passengerState=()=>resolvePassengerUiState({selectedOrder:{b_id:'journey',b_state:EBookingStates.Processing,drivers:[]} as any,selectedDriver:{u_id:'driver',c_state:backend} as any})
  const actions={atPickup:false,depart:jest.fn(()=>{departed=true}),arrive:jest.fn(async()=>{backend=S.Arrived}),board:jest.fn(async()=>{backend=S.Started})}
  expect(driverPickupStage(backend,departed)).toBe('depart')
  await performPickupStage('depart',actions)
  expect(backend).toBe(S.Performer)
  expect(actions.arrive).not.toHaveBeenCalled()
  expect(passengerState()).toBe('DRIVER_ASSIGNED')
  expect(driverPickupStage(backend,departed)).toBe('arrive')
  expect(await performPickupStage('arrive',actions)).toBe(false)
  expect(await performPickupStage('board',actions)).toBe(false)
  expect(backend).toBe(S.Performer)
  actions.atPickup=true
  await performPickupStage('arrive',actions)
  expect(backend).toBe(S.Arrived)
  expect(passengerState()).toBe('DRIVER_ARRIVED')
  expect(driverPickupStage(backend,departed)).toBe('board')
  await performPickupStage('board',actions)
  expect(backend).toBe(S.Started)
  expect(passengerState()).toBe('TRIP_STARTED')
  expect(driverPickupStage(backend,departed)).toBeNull()
})
it('retains departure across reload for that driver without leaking to another account',()=>{
  rememberDriverDeparture('a',[],'18512')
  expect(readDriverDepartures('a')).toEqual(['18512'])
  expect(readDriverDepartures('b')).toEqual([])
  expect(driverPickupStage(S.Performer,readDriverDepartures('a').includes('18512'))).toBe('arrive')
})
it('a refusal never advances the backend or triggers boarding',async()=>{
  const board=jest.fn(),arrive=jest.fn(async()=>{throw new Error('refused')})
  await expect(performPickupStage('arrive',{atPickup:true,depart:()=>{},arrive,board})).rejects.toThrow('refused')
  expect(board).not.toHaveBeenCalled()
})
