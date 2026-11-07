import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {CancelDriverOrderModal} from '../DriverCancelModal'
import {driverMapGateway} from '../../../platform/adapters/DriverMapGateway'
import {wasOrderCancelledByDriver} from '../../../tools/driverSelfCancel'

const mockNavigate = jest.fn()
jest.mock('react-redux', () => ({connect: () => Component => Component}))
jest.mock('../../../platform/adapters/DriverMapGateway', () => ({driverMapGateway:{cancel:jest.fn()}}))
jest.mock('../../../platform/platform-interface', () => ({PLATFORM_ROUTES:{DriverOrders:'/driver-order'},usePlatformNavigate:()=>mockNavigate}))
jest.mock('../../../state/modals', () => ({modalsActionCreators:{setDriverCancelModal:jest.fn()},modalsSelectors:{}}))
jest.mock('../../../state/order', () => ({orderSelectors:{}}))
jest.mock('../../../state/user', () => ({userSelectors:{}}))
jest.mock('../../../tools/apiMessages', () => ({getApiErrorMessage:()=> 'Не удалось отменить'}))
jest.mock('../../../localization', () => ({t:value=>value,TRANSLATION:{OK:'OK',LOADING:'Ожидание',CANCEL_ORDER:'Отказ',CANCEL_ORDER_CONFIRMATION:'Подтвердите'}}))
jest.mock('../Overlay', () => ({__esModule:true,default:({isOpen,onClick,children})=>isOpen?<div role="dialog"><button data-testid="overlay-close" onClick={onClick}>Закрыть</button>{children}</div>:null}))
jest.mock('../../OrderId', () => ({__esModule:true,default:()=>null}))
jest.mock('../../Button', () => ({__esModule:true,default:({text,...props})=><button {...props}>{text}</button>}))

const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
let host,root,close,dismiss
beforeEach(()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true
  localStorage.clear();jest.clearAllMocks()
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);close=jest.fn();dismiss=jest.fn()
  act(()=>root.render(<CancelDriverOrderModal isOpen selectedOrderId="1931" user={{u_id:'1306'}} setDriverCancelModal={dismiss} closeAllModals={close}/>))
})
afterEach(()=>{act(()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT})
const confirm=()=>host.querySelector('[data-testid="driver-order-cancel-confirm"]')

test('waits for server completion, prevents double confirmation, and cannot dismiss a pending cancellation',async()=>{
  const request=deferred();driverMapGateway.cancel.mockReturnValue(request.promise)
  act(()=>{confirm().click();confirm().click();host.querySelector('[data-testid="overlay-close"]').click()})
  expect(driverMapGateway.cancel).toHaveBeenCalledTimes(1)
  expect(driverMapGateway.cancel).toHaveBeenCalledWith('1931')
  expect(confirm().disabled).toBe(true)
  expect(confirm().getAttribute('aria-busy')).toBe('true')
  expect(close).not.toHaveBeenCalled();expect(dismiss).not.toHaveBeenCalled();expect(mockNavigate).not.toHaveBeenCalled()
  expect(wasOrderCancelledByDriver('1931','1306')).toBe(true)
  await act(async()=>{request.resolve();await request.promise})
  expect(close).toHaveBeenCalledTimes(1)
  expect(mockNavigate).toHaveBeenCalledTimes(1)
  expect(mockNavigate).toHaveBeenCalledWith('/driver-order')
})

test('keeps a rejected cancellation open, rolls back the self-cancel mark, and permits a deliberate retry',async()=>{
  const first=deferred(),retry=deferred()
  driverMapGateway.cancel.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
  act(()=>confirm().click())
  await act(async()=>{first.reject(new Error('wrong booking state'));await Promise.resolve()})
  expect(host.querySelector('[role="alert"]').textContent).toBe('Не удалось отменить')
  expect(confirm().disabled).toBe(false)
  expect(wasOrderCancelledByDriver('1931','1306')).toBe(false)
  expect(close).not.toHaveBeenCalled();expect(dismiss).not.toHaveBeenCalled();expect(mockNavigate).not.toHaveBeenCalled()
  act(()=>confirm().click())
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(driverMapGateway.cancel).toHaveBeenCalledTimes(2)
  await act(async()=>{retry.resolve();await retry.promise})
  expect(close).toHaveBeenCalledTimes(1);expect(mockNavigate).toHaveBeenCalledTimes(1)
})
