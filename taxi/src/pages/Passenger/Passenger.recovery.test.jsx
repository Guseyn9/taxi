import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import Passenger from './index'
import {passengerGateway} from '../../platform/adapters/LegacyPassengerGateway'
jest.mock('../../platform/adapters/LegacyPassengerChannelStoreAdapter',()=>({passengerScreenConnector:component=>component}))
jest.mock('../../platform/adapters/LegacyPassengerGateway',()=>({passengerGateway:{getOrder:jest.fn()}}))
jest.mock('../../platform/platform-interface',()=>({usePassengerSurface:()=>({uiConfig:{state:'draft',bottomSheet:'draft',mapMode:'draft',pinBottomSheet:false,legacy:true}})}))
jest.mock('../../components/Map',()=>({__esModule:true,default:()=>null}))
jest.mock('../../components/MiniOrders',()=>({__esModule:true,default:()=>null}))
jest.mock('../../components/BoundaryButtons',()=>({__esModule:true,default:()=>null}))
jest.mock('../../components/Layout',()=>({__esModule:true,default:({children})=><div>{children}</div>}))
jest.mock('../../components/PassengerLiveOrder',()=>({__esModule:true,default:()=>null}))
jest.mock('./VotingForm',()=>({__esModule:true,default:props=><div data-id={props.lockedOrderId||''} data-locked={Boolean(props.lockedOrder||props.lockedDraft)}>
 {props.lockedOrder?.b_start_address||props.lockedDraft?.fromAddress||'draft'}
 {!props.lockedOrder&&!props.lockedDraft&&<button onClick={()=>props.onSubmit({b_id:'42'},{fromAddress:'Saved pickup',toAddress:'Saved destination'})}>Create fixture</button>}
 </div>}))
jest.mock('../../localization',()=>({t:(key,options)=>options?.fallback||key||'',TRANSLATION:new Proxy({},{get:(_,key)=>String(key)})}))
jest.mock('../../state',()=>({__esModule:true,default:{getState:()=>({})}}))
jest.mock('../../tools/frontendLog',()=>({writeFrontendLog:jest.fn(),summarizeOrder:()=>({})}))
let host,root
beforeEach(()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true; jest.useFakeTimers();jest.clearAllMocks();localStorage.clear();sessionStorage.clear()
 window.matchMedia=()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{},addListener:()=>{},removeListener:()=>{}})
 host=document.createElement('div');root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());jest.useRealTimers();delete global.IS_REACT_ACT_ENVIRONMENT})
function Screen(){
 const [selected,setSelected]=React.useState(null)
 return <Passenger {...{activeOrders:[],selectedOrder:selected,user:{u_id:'client',u_role:1},language:{iso:'ru'},
  setVoteModal:jest.fn(),setDriverModal:jest.fn(),setMessageModal:jest.fn(),setCancelModal:jest.fn(),setOnTheWayModal:jest.fn(),setRatingModal:jest.fn(),setCandidatesModal:jest.fn(),
  watchActiveOrders:()=>()=>{},refreshActiveOrders:jest.fn(),setFrom:jest.fn(),setTo:jest.fn(),setSelectedOrder:setSelected,resetClientOrder:jest.fn(),setPickupPrice:jest.fn()}}/>
}
test('acknowledged creation stays locked through failed list/detail reads and recovers by its ID',async()=>{
 passengerGateway.getOrder.mockRejectedValueOnce(new Error('read unavailable')).mockResolvedValue({b_id:'42',u_id:'client',b_state:1,b_start_address:'Canonical pickup',drivers:[]})
 await act(async()=>root.render(<Screen/>))
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Create fixture').click())
 expect(host.querySelector('[data-id="42"]').getAttribute('data-locked')).toBe('true')
 expect(host.textContent).toContain('Saved pickup');expect(host.querySelector('[data-id="42"] button')).toBeNull()
 expect(passengerGateway.getOrder).toHaveBeenCalledWith('42')
 await act(async()=>{jest.advanceTimersByTime(5000)})
 expect(host.textContent).toContain('Canonical pickup');expect(host.querySelector('[data-id="42"]').getAttribute('data-locked')).toBe('true')
 expect(passengerGateway.getOrder).toHaveBeenCalledTimes(2)
})
