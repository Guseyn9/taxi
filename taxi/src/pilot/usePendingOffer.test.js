import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
jest.mock('../platform/adapters/LegacyPassengerGateway',()=>({passengerGateway:{getOrder:jest.fn()}}))
jest.mock('../tools/driverOffer',()=>({isOfferOrder:o=>o.mode==='offer',setStoredChoiceOrderMode:jest.fn()}))
import {usePendingOffer} from './usePendingOffer'
import {markPendingOffer,pendingOffer} from './pendingOffer'
import {passengerGateway} from '../platform/adapters/LegacyPassengerGateway'
import {setStoredChoiceOrderMode} from '../tools/driverOffer'
let root,host
function View({done}){const pending=usePendingOffer('u','A',done);return <p>{pending?'unconfirmed':'confirmed'}</p>}
beforeEach(()=>{jest.useFakeTimers();global.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');root=createRoot(host);markPendingOffer('u','A')})
afterEach(async()=>{await act(async()=>root.unmount());markPendingOffer('u','A',false);jest.useRealTimers();jest.clearAllMocks();delete global.IS_REACT_ACT_ENVIRONMENT})
it('keeps unknown mode through a failed read, then confirms the same booking after recovery without ordinary-mode writes',async()=>{
 const done=jest.fn();passengerGateway.getOrder.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({mode:'offer'})
 await act(async()=>root.render(<View done={done}/>))
 expect(host.textContent).toBe('unconfirmed');expect(setStoredChoiceOrderMode).not.toHaveBeenCalled()
 await act(async()=>jest.advanceTimersByTime(5000))
 expect(host.textContent).toBe('confirmed');expect(setStoredChoiceOrderMode).toHaveBeenCalledWith('A','offer')
 expect(pendingOffer('u','A')).toBe(false);expect(done).toHaveBeenCalledTimes(1)
 expect(passengerGateway.getOrder.mock.calls).toEqual([['A'],['A']])
})
it('retains the pending booking when the server returns another mode and stops polling on unmount',async()=>{
 passengerGateway.getOrder.mockResolvedValue({mode:'order'})
 await act(async()=>root.render(<View done={jest.fn()}/>))
 expect(host.textContent).toBe('unconfirmed');expect(setStoredChoiceOrderMode).not.toHaveBeenCalled()
 await act(async()=>root.unmount())
 await act(async()=>jest.advanceTimersByTime(30000))
 expect(passengerGateway.getOrder).toHaveBeenCalledTimes(1)
 // The booking marker must survive leaving the screen.
 expect(pendingOffer('u','A')).toBe(true)
 root=createRoot(host)
})
