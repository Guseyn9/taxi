import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import PendingVotingConfirmation from './PendingVotingConfirmation'
import {passengerGateway} from '../platform/adapters/LegacyPassengerGateway'
jest.mock('../platform/adapters/LegacyPassengerGateway',()=>({passengerGateway:{confirmOrder:jest.fn()}}))
jest.mock('../localization',()=>({t:key=>key,TRANSLATION:{LOADING:'Loading'}}))
jest.mock('../tools/apiMessages',()=>({getApiErrorMessage:()=> 'Confirmation failed'}))
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
let host,root
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;jest.clearAllMocks();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT})
test('retry confirms the existing order once, keeps errors visible, and refreshes only after success',async()=>{
 const failure=deferred(),success=deferred(),refresh=jest.fn(),order={b_id:'42',b_voting:true,b_confirm_state:false,b_state:1}
 passengerGateway.confirmOrder.mockReturnValueOnce(failure.promise).mockReturnValueOnce(success.promise)
 act(()=>root.render(<PendingVotingConfirmation order={order} onUpdated={refresh}/>))
 const click=()=>host.querySelector('button').click()
 act(()=>{click();click()})
 expect(passengerGateway.confirmOrder).toHaveBeenCalledTimes(1);expect(passengerGateway.confirmOrder).toHaveBeenCalledWith('42')
 expect(host.querySelector('button').disabled).toBe(true);expect(refresh).not.toHaveBeenCalled()
 await act(async()=>{failure.reject(new Error('offline'));await Promise.resolve()})
 expect(host.querySelector('[role="alert"]').textContent).toBe('Confirmation failed')
 expect(host.querySelector('button').disabled).toBe(false);expect(refresh).not.toHaveBeenCalled()
 act(()=>click())
 await act(async()=>{success.resolve({code:'200',status:'success'});await success.promise})
 expect(passengerGateway.confirmOrder).toHaveBeenCalledTimes(2);expect(refresh).toHaveBeenCalledTimes(1);expect(host.querySelector('button')).toBeNull()
})
test('does not offer confirmation for an ordinary, confirmed, unknown or terminal booking',()=>{
 const base={b_id:'42',b_voting:true,b_confirm_state:false,b_state:1}
 for(const patch of [{b_voting:false},{b_confirm_state:true},{b_confirm_state:undefined},{b_state:3},{b_state:4}]){
  act(()=>root.render(<PendingVotingConfirmation order={{...base,...patch}} onUpdated={jest.fn()}/>))
  expect(host.querySelector('button')).toBeNull()
 }
 expect(passengerGateway.confirmOrder).not.toHaveBeenCalled()
})
