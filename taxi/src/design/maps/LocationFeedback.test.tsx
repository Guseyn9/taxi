import React from 'react'
import {createRoot,Root} from 'react-dom/client'
import {act} from 'react'
import LocationFeedback from './LocationFeedback'
let host:HTMLDivElement,root:Root
beforeEach(()=>{host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(()=>{act(()=>{root.unmount()});host.remove()})
it('retries permission on explicit action and explains an existing browser block',()=>{
 const allow=jest.fn(),close=jest.fn()
 act(()=>{root.render(<LocationFeedback code={1} iso="ru" busy={false} onAllow={allow} onClose={close}/>)})
 const button=host.querySelector('.map-location-feedback__allow') as HTMLButtonElement
 expect(button.textContent).toBe('Разрешить геолокацию')
 act(()=>{button.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
 expect(allow).toHaveBeenCalledTimes(1)
 expect(host.textContent).toMatch(/Если окно разрешения не появилось/)
 act(()=>{host.querySelector('.map-location-feedback__close')!.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
 expect(close).toHaveBeenCalledTimes(1)
})
it('disables repeated requests while waiting for GPS',()=>{
 act(()=>{root.render(<LocationFeedback code={3} iso="en" busy={true} onAllow={()=>{}} onClose={()=>{}}/>)})
 const button=host.querySelector('.map-location-feedback__allow') as HTMLButtonElement
 expect(button.disabled).toBe(true)
 expect(button.textContent).toBe('Locating…')
})
