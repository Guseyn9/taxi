import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {RideRequestActions} from './RideRequestActions'
test('changing a ride mode never submits; the explicit primary action submits the selected mode once',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host)
 const submit=jest.fn(),change=jest.fn()
 const render=mode=>root.render(<RideRequestActions mode={mode} onChange={change} onSubmit={submit} iso="en"/> )
 await act(async()=>render('order'))
 await act(async()=>host.querySelector('[value="offer"]').click())
 expect(change).toHaveBeenCalledWith('offer');expect(submit).not.toHaveBeenCalled()
 await act(async()=>render('offer'));await act(async()=>host.querySelector('[data-testid="passenger-order-submit"]').click())
 expect(submit).toHaveBeenCalledTimes(1);expect(submit).toHaveBeenCalledWith('offer')
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
