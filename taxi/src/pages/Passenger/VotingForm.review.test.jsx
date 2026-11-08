import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {HelmetProvider} from 'react-helmet-async'
import {VotingForm} from './VotingForm'
import {EBookingLocationKinds} from '../../types/types'
import {markBookingCreationReview} from '../../design/bookingCreationReview'
let mockSubmission
jest.mock('react-redux',()=>({...jest.requireActual('react-redux'),connect:()=>component=>component}))
jest.mock('../../tools/hooks',()=>({
 useCachedState:(_key,initial)=>jest.requireActual('react').useState(initial),
 useReliableNow:()=>Date.now(),
 useVisibility:(initial)=>{const [visible,setVisible]=jest.requireActual('react').useState(initial);return [visible,()=>setVisible(value=>!value)]},
}))
jest.mock('../../tools/frontendLog',()=>({writeFrontendLog:jest.fn(),summarizeOrder:()=>({})}))
jest.mock('../../state',()=>({__esModule:true,default:{getState:()=>({})}}))
jest.mock('../../platform/adapters/LegacyPassengerGateway',()=>({passengerGateway:{getOrder:jest.fn()}}))
jest.mock('../../localization',()=>({t:(key,options)=>options?.fallback || key || '',TRANSLATION:new Proxy({},{get:(_,key)=>String(key)})}))
jest.mock('../../platform/adapters/LegacyPassengerChannelStoreAdapter',()=>({passengerVotingFormConnector:component=>component,usePassengerOrderSubmissionReader:()=>()=>mockSubmission}))
jest.mock('../../components/LocationInput',()=>({__esModule:true,default:()=>null}))
jest.mock('../../components/CarClassSlider',()=>({__esModule:true,default:()=>null}))
jest.mock('../../components/SeatSlider',()=>({__esModule:true,default:()=>null}))
jest.mock('../../components/ShortInfo',()=>({__esModule:true,default:()=>null}))
jest.mock('../../components/PriceInput',()=>({__esModule:true,default:()=> <input aria-label="Fare" defaultValue="100"/>}))
let host,root,create,refresh,submit
beforeEach(()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();sessionStorage.clear();markBookingCreationReview('review-client',false)
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
 create=jest.fn();refresh=jest.fn();submit=jest.fn()
 HTMLElement.prototype.scrollIntoView=jest.fn();HTMLElement.prototype.scrollTo=jest.fn()
 mockSubmission={allowedModes:['order','offer','vote'],locationClass:'city',zonesReady:true,carClass:'petit',seats:1,pickupPrice:10,customerPrice:100}
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();markBookingCreationReview('review-client',false);delete global.IS_REACT_ACT_ENVIRONMENT})
function Form({phone=null,lockedOrder=null}){
 const [expanded,setExpanded]=React.useState(false)
 return <HelmetProvider><VotingForm {...{
  from:{address:'Agadir',latitude:30.42,longitude:-9.6},to:{address:'Agadir Center',latitude:30.43,longitude:-9.61},
  fromZoneStatus:'ready',toZoneStatus:'ready',zonesReady:true,comments:{ids:[]},time:'now',phone,
  user:{u_id:'review-client',u_role:1},locationClass:'city',locationClassSelectionMode:'auto',algorithmLocationClass:'city',
  locationClasses:[{id:'city',kind:EBookingLocationKinds.City}],orderFormLayout:{classResolution:{availableClassIds:['petit']},orderModeResolution:{allowedModes:['order','offer','vote']}},
  language:{iso:'ru'},setPickTimeModal:jest.fn(),setCommentsModal:jest.fn(),setLoginModal:jest.fn(),setMessageModal:jest.fn(),setRatingModal:jest.fn(),
  createOrder:create,refreshActiveOrders:refresh,setPhone:jest.fn(),setPickupPrice:jest.fn(),setCustomerPrice:jest.fn(),resetClientOrder:jest.fn(),setFrom:jest.fn(),setTo:jest.fn(),
  isExpanded:expanded,setIsExpanded:setExpanded,syncFrom:jest.fn(),syncTo:jest.fn(),onSubmit:submit,minimizedPartRef:React.createRef(),noSwipeElementsRef:React.createRef(),lockedOrder,lockedOrderId:lockedOrder?.b_id,
 }}/></HelmetProvider>
}
test('the real form opens phone options only on booking intent and sends no request without a phone',async()=>{
 await act(async()=>root.render(<Form/>))
 expect(host.textContent).not.toContain('Указать телефон');expect(host.textContent).not.toContain('Укажите корректный телефон в параметрах')
 expect(host.querySelector('[data-testid="passenger-order-phone"]')).toBeNull()
 await act(async()=>host.querySelector('[data-testid="passenger-order-mode-order"]').click())
 expect(host.querySelector('[data-testid="passenger-order-phone"]')).not.toBeNull()
 expect(host.querySelector('.rs-phone-field').textContent.length).toBeGreaterThan(0)
 expect(create).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled()
})

test('a known booking uses the same From/To labels in its readonly route',async()=>{
 await act(async()=>root.render(<Form phone={233555555555} lockedOrder={{b_id:'42',u_id:'review-client',b_state:1,b_start_address:'Pickup',b_destination_address:'Destination',drivers:[]}}/>))
 expect([...host.querySelectorAll('.rs-readonly-location>span')].map(node=>node.textContent)).toEqual(['Откуда','Куда'])
 expect(create).not.toHaveBeenCalled()
})
test('a valid phone sends once and retains the confirmed identity for the parent',async()=>{
 create.mockResolvedValue({b_id:'42'})
 await act(async()=>root.render(<Form phone={233555555555}/>))
 await act(async()=>host.querySelector('[data-testid="passenger-order-mode-order"]').click())
 expect(create).toHaveBeenCalledTimes(1);expect(create.mock.calls[0][0].b_contact).toBe('233555555555')
 expect(submit.mock.calls[0][0]).toEqual({b_id:'42'})
})
test('a lost response keeps the fare, requires review across remount and only refreshes reads',async()=>{
 create.mockRejectedValue({isAxiosError:true,message:'Network Error'})
 await act(async()=>root.render(<Form phone={233555555555}/>))
 await act(async()=>host.querySelector('[data-testid="passenger-order-mode-offer"]').click())
 await act(async()=>document.querySelector('[data-testid="passenger-order-submit"]').click())
 expect(create).toHaveBeenCalledTimes(1);expect(submit).not.toHaveBeenCalled();expect(refresh).toHaveBeenCalledTimes(1)
 expect(document.querySelector('[role=dialog] input').value).toBe('100')
 expect(document.querySelector('[data-testid="passenger-order-submit"]').disabled).toBe(true)
 await act(async()=>[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Проверить заказы').click())
 expect(refresh).toHaveBeenCalledTimes(2);expect(create).toHaveBeenCalledTimes(1)
 await act(async()=>root.render(<Form key="reload" phone={233555555555}/>))
 expect(host.querySelector('[data-testid="passenger-order-mode-order"]').disabled).toBe(true)
 expect(host.textContent).toContain('Результат отправки не подтверждён')
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Проверить заказы').click())
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Начать новый заказ').click())
 await act(async()=>document.querySelector('[data-testid="booking-review-new-intent"]').click())
 expect(host.querySelector('[data-testid="passenger-order-mode-order"]').disabled).toBe(false)
 expect(create).toHaveBeenCalledTimes(1)
})
