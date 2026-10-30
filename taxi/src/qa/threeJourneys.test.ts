import {EBookingDriverState as S,EBookingStates as B,IOrder,ICar} from '../types/types'
import {passengerRequestMode} from '../tools/passengerRequestMode'
import {driverOrderMode} from '../design/driverOrderPresentation'
import {resolvePassengerUiState} from '../pages/Passenger/uiFsm'
import {driverPickupStage,performPickupStage} from '../tools/driverPickupJourney'
import {getDriverFreeSeats,canDriverTakeOrderBySeats} from '../tools/driverCapacity'
import {isBoardingCodeAccepted,confirmDriverBoarding} from '../tools/driverBoarding'
import {quotedFare} from '../design/reliability/rideData'
import {tripToRestore} from '../design/restoreTrip'
import {serverPickupEta,validOfferPrice} from '../pilot/rules'
import {isConfirmedDriverHistory} from '../tools/recentDriverHistory'

// Response fixtures exercise frontend transitions. They do not prove a server contract.
describe.each(['order','vote','offer'])('two-role local journey %s',(mode:string)=>{
 const make=()=>({b_id:`QA-${mode}`,u_id:'client',b_state:B.Processing,b_car_class:'1',b_passengers_count:1,b_cars_count:mode==='offer'?0:1,b_voting:mode==='vote',b_price_estimate:22.5,b_options:mode==='offer'?{customer_price:150}:{},drivers:[]} as unknown as IOrder)
 beforeEach(()=>{localStorage.clear();sessionStorage.clear()})
 it('keeps the request type and quote consistent before and after assignment',()=>{
  const order=make();expect(passengerRequestMode({order,selectedMode:'offer'})).toBe(mode)
  expect(driverOrderMode(order)).toBe(mode==='vote'?'voting':mode)
  expect(quotedFare(order)?.value).toBe(mode==='offer'?150:22.5)
  order.drivers=[{u_id:'driver',c_state:S.Considering,c_options:{driver_offer_price:180}} as any]
  expect(quotedFare(order)?.value).toBe(mode==='offer'?150:22.5)
  if(mode==='offer'){expect(validOfferPrice(0)).toBe(false);expect(validOfferPrice(150)).toBe(true)}
  order.drivers[0].c_state=S.Performer
  expect(quotedFare(order)?.value).toBe(180)
  expect(serverPickupEta({c_pickup_time:5})).toBe('5');expect(serverPickupEta({})).toBe('')
 })
 it('separates departure, arrival and boarding; preserves active trip and releases terminal seats',async()=>{
  const order=make();order.drivers=[{u_id:'driver',c_state:S.Performer} as any]
  const car={seats:4} as ICar;let departed=false
  const actions={atPickup:false,depart:()=>{departed=true},arrive:async()=>{order.drivers![0].c_state=S.Arrived},board:async()=>{order.drivers![0].c_state=S.Started}}
  expect(getDriverFreeSeats(car,[order],'driver')).toBe(3)
  await performPickupStage('depart',actions);expect(order.drivers[0].c_state).toBe(S.Performer)
  expect(driverPickupStage(S.Performer,departed)).toBe('arrive')
  expect(await performPickupStage('arrive',actions)).toBe(false)
  actions.atPickup=true;await performPickupStage('arrive',actions)
  expect(isBoardingCodeAccepted('111','000')).toBe(false)
  expect(isBoardingCodeAccepted('111','111')).toBe(true)
  const sync=jest.fn(),boarded=jest.fn()
  await expect(confirmDriverBoarding({orderId:order.b_id,code:'111',confirmBoarding:async()=>{throw Error('offline')},syncOrderState:sync,onBoarded:boarded})).rejects.toThrow('offline')
  expect(sync).not.toHaveBeenCalled();expect(boarded).not.toHaveBeenCalled()
  await performPickupStage('board',actions)
  expect(tripToRestore([order],order.b_id)?.b_id).toBe(order.b_id)
  // Delayed driver snapshot must not revive a completed/cancelled booking.
  for(const state of [B.Completed,B.Canceled]){
   const terminal={...order,b_state:state}
   expect(resolvePassengerUiState({selectedOrder:terminal})).toBe(state===B.Completed?'TRIP_FINISHED':'CANCELLED')
   expect(getDriverFreeSeats(car,[terminal],'driver')).toBe(4)
   expect(canDriverTakeOrderBySeats(terminal,4,'driver')).toBe(false)
   expect(tripToRestore([terminal])).toBeNull()
   expect(isConfirmedDriverHistory(terminal,'driver')).toBe(true)
  }
 })
})
