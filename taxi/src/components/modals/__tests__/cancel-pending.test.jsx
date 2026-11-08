import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {DriverTripCancelModal} from '../DriverTripCancelModal'
import {CancelOrderModal} from '../CancelModal'
import {driverMapGateway} from '../../../platform/adapters/DriverMapGateway'

const mockNavigate=jest.fn()
jest.mock('react-redux',()=>({connect:()=>Component=>Component}))
jest.mock('react-router-dom',()=>({useNavigate:()=>mockNavigate}))
jest.mock('../../../platform/adapters/DriverMapGateway',()=>({driverMapGateway:{cancel:jest.fn()}}))
jest.mock('../../../state/modals',()=>({modalsActionCreators:{},modalsSelectors:{}}))
jest.mock('../../../state/orders',()=>({ordersActionCreators:{},ordersSelectors:{}}))
jest.mock('../../../state/user',()=>({userSelectors:{}}))
jest.mock('../../../state/clientOrder',()=>({clientOrderActionCreators:{},clientOrderSelectors:{}}))
jest.mock('../../../siteConstants',()=>({__esModule:true,default:{DRIVER_TRIP_CANCEL_REASONS:[{id:'0',label:'Первый вариант'},{id:'1',label:'Поломка автомобиля'}],CANCEL_ORDER_REASONS:[{id:'0',label:'Долго ждать'}]}}))
jest.mock('../../../localization',()=>({t:value=>value,TRANSLATION:{ERROR:'Ошибка',LOADING:'Ожидание',CANCEL:'Назад',CANCEL_ORDER:'Отменить',DRIVER_TRIP_CANCEL_TITLE:'Причина',INTERRUPT_TRIP:'Прервать'}}))
jest.mock('../../../tools/apiMessages',()=>({getApiErrorMessage:()=> 'Сервер отклонил отмену'}))
jest.mock('../Overlay',()=>({__esModule:true,default:({isOpen,onClick,children})=>isOpen?<div role="dialog"><button data-testid="overlay-close" onClick={onClick}>Закрыть</button>{children}</div>:null}))
jest.mock('../../OrderId',()=>({__esModule:true,default:()=>null}))
jest.mock('../../Button',()=>({__esModule:true,default:({text,intent,...props})=><button {...props}>{text}</button>}))
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
let root,host
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();jest.clearAllMocks();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT})
const renderDriver=()=>{
 const close=jest.fn(),message=jest.fn()
 act(()=>root.render(<DriverTripCancelModal modal={{isOpen:true,orderId:'1935'}} activeOrders={[]} user={{u_id:'1306'}} setDriverTripCancelModal={close} setMessageModal={message}/>))
 return {close,message,confirm:()=>host.querySelector('[data-testid="driver-trip-cancel-confirm"]')}
}
test('driver interruption offers native radios, sends the selected reason once, and awaits completion',async()=>{
 const request=deferred();driverMapGateway.cancel.mockReturnValue(request.promise)
 const ui=renderDriver(),radios=host.querySelectorAll('input[type="radio"]')
 expect(radios).toHaveLength(2)
 act(()=>radios[1].click());expect(radios[1].checked).toBe(true)
 act(()=>{ui.confirm().click();ui.confirm().click();host.querySelector('[data-testid="overlay-close"]').click()})
 expect(driverMapGateway.cancel).toHaveBeenCalledTimes(1)
 expect(driverMapGateway.cancel).toHaveBeenCalledWith('1935','Поломка автомобиля')
 expect(ui.close).not.toHaveBeenCalled();expect(mockNavigate).not.toHaveBeenCalled()
 expect(ui.confirm().getAttribute('aria-busy')).toBe('true')
 await act(async()=>{request.resolve();await request.promise})
 expect(ui.close).toHaveBeenCalledTimes(1);expect(mockNavigate).toHaveBeenCalledWith('/driver-order')
})
test('failed driver interruption retains the selected reason and permits deliberate retry',async()=>{
 const request=deferred();driverMapGateway.cancel.mockReturnValue(request.promise)
 const ui=renderDriver();act(()=>host.querySelectorAll('input')[1].click());act(()=>ui.confirm().click())
 await act(async()=>{request.reject(new Error('offline'));await Promise.resolve()})
 expect(host.querySelector('[role="alert"]').textContent).toBe('Сервер отклонил отмену')
 expect(host.querySelectorAll('input')[1].checked).toBe(true)
 expect(ui.confirm().disabled).toBe(false);expect(ui.close).not.toHaveBeenCalled();expect(ui.message).not.toHaveBeenCalled()
})
test('passenger cancellation neither closes early on double click nor dismisses while pending',async()=>{
 const request=deferred(),cancelOrder=jest.fn(()=>request.promise),close=jest.fn(),selection=jest.fn(),refresh=jest.fn()
 act(()=>root.render(<CancelOrderModal selectedOrder="1935" isOpen setCancelModal={close} setMessageModal={jest.fn()} setVoteModal={jest.fn()} setDriverModal={jest.fn()} setOnTheWayModal={jest.fn()} setSelectedOrder={selection} cancelOrder={cancelOrder} refreshActiveOrders={refresh}/>))
 const confirm=host.querySelector('[data-testid="passenger-order-cancel-confirm"]')
 act(()=>{confirm.click();confirm.click();host.querySelector('[data-testid="overlay-close"]').click()})
 expect(cancelOrder).toHaveBeenCalledTimes(1);expect(close).not.toHaveBeenCalled();expect(selection).not.toHaveBeenCalled()
 await act(async()=>{request.resolve();await request.promise})
 expect(close).toHaveBeenCalledWith(false);expect(selection).toHaveBeenCalledWith(null);expect(refresh).toHaveBeenCalledTimes(1)
})
