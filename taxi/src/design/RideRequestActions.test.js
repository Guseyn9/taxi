import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {HelmetProvider} from 'react-helmet-async'
import {RideRequestActions} from './RideRequestActions'
let host,root,submit,change
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);submit=jest.fn();change=jest.fn()})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT})
const render=props=>act(async()=>root.render(<HelmetProvider><RideRequestActions mode="order" onChange={change} onSubmit={submit} iso="en" {...props}/></HelmetProvider>))
test('direct action submits its own mode exactly once; help never submits',async()=>{
 await render()
 await act(async()=>host.querySelector('[data-testid="passenger-order-help-vote"]').click())
 expect(submit).not.toHaveBeenCalled();expect(document.querySelector('[role=dialog]').textContent).toContain('first taxi')
 await act(async()=>document.querySelector('[data-testid="passenger-order-help-close"]').click())
 await act(async()=>host.querySelector('[data-testid="passenger-order-mode-vote"]').click())
 expect(submit.mock.calls).toEqual([['vote']])
})
test('Offer opens price editor and sends only on confirmation',async()=>{
 await render({priceField:<input aria-label="Fare"/>})
 await act(async()=>host.querySelector('[data-testid="passenger-order-mode-offer"]').click())
 expect(change).toHaveBeenCalledWith('offer');expect(submit).not.toHaveBeenCalled()
 await act(async()=>document.querySelector('[data-testid="passenger-order-submit"]').click())
 expect(submit.mock.calls).toEqual([['offer']])
})
test('route change hides Vote and closes an obsolete help dialog',async()=>{
 await render();await act(async()=>host.querySelector('[data-testid="passenger-order-help-vote"]').click())
 await render({allowedModes:['order','offer']})
 expect(host.querySelector('[data-testid="passenger-order-mode-vote"]')).toBeNull()
 expect(document.querySelector('[role=dialog]')).toBeNull();expect(submit).not.toHaveBeenCalled()
})
test('unconfirmed zones block every command but leave explanations accessible',async()=>{
 await render({submitDisabled:true})
 for(const mode of ['order','vote','offer']){
  const button=host.querySelector(`[data-testid="passenger-order-mode-${mode}"]`)
  expect(button.disabled).toBe(true);await act(async()=>button.click())
 }
 expect(submit).not.toHaveBeenCalled()
 await act(async()=>host.querySelector('[data-testid="passenger-order-help-order"]').click())
 expect(document.querySelector('[role=dialog]')).not.toBeNull()
})
test('short descriptions explain each mode without changing its accessible action label',async()=>{
 await render()
 for(const mode of ['order','vote','offer']){
  const button=host.querySelector(`[data-testid="passenger-order-mode-${mode}"]`)
  expect(button.getAttribute('aria-label')).toBe(button.querySelector('.rs-booking-action__label').textContent)
  expect(document.getElementById(button.getAttribute('aria-describedby'))).toBe(button.querySelector('.rs-booking-action__detail'))
 }
 expect(host.querySelector('[data-testid="passenger-order-mode-vote"] small').textContent).toContain('First taxi to arrive')
})
test('pending state identifies the submitted mode and blocks duplicate commands',async()=>{
 await render({mode:'offer',pending:true})
 const busy=host.querySelectorAll('[aria-busy=true]')
 expect(busy).toHaveLength(1);expect(busy[0].getAttribute('data-testid')).toBe('passenger-order-mode-offer')
 for(const button of host.querySelectorAll('.rs-booking-action__submit')){expect(button.disabled).toBe(true);await act(async()=>button.click())}
 expect(submit).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled()
})
