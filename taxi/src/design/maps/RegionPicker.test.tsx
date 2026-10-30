import React,{act} from 'react'
import {createRoot,Root} from 'react-dom/client'
import RegionPicker from './RegionPicker'
let host:HTMLDivElement,root:Root
const regions=[{id:'morocco',label:'Марокко'},{id:'rabat',label:'Rabat'},{id:'agadir',label:'Agadir'}]
beforeEach(()=>{(global as any).IS_REACT_ACT_ENVIRONMENT=true;jest.useFakeTimers();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();jest.useRealTimers();delete (global as any).IS_REACT_ACT_ENVIRONMENT})
it('opens a keyboard-accessible list and changes the region only after confirmation',async()=>{
 const change=jest.fn();await act(async()=>root.render(<RegionPicker value="rabat" regions={regions} label="Область карты" onChange={change}/>))
 const trigger=host.querySelector('button')!
 await act(async()=>{trigger.click();jest.advanceTimersByTime(40)})
 expect(document.querySelector('[role=listbox]')).not.toBeNull()
 const selected=document.querySelector<HTMLButtonElement>('[aria-selected=true]')!
 selected.focus()
 await act(async()=>selected.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})))
 expect(document.activeElement?.textContent).toBe('Agadir');expect(change).not.toHaveBeenCalled()
 await act(async()=>(document.activeElement as HTMLButtonElement).click())
 expect(change).toHaveBeenCalledWith('agadir');expect(document.querySelector('[role=listbox]')).toBeNull();expect(document.activeElement).toBe(trigger)
})
it('Escape and outside clicks close the list without changing the camera region',async()=>{
 const change=jest.fn();await act(async()=>root.render(<RegionPicker value="morocco" regions={regions} label="Область карты" onChange={change}/>))
 const trigger=host.querySelector('button')!
 await act(async()=>trigger.click())
 await act(async()=>document.querySelector('[role=listbox]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(change).not.toHaveBeenCalled();expect(document.activeElement).toBe(trigger)
 await act(async()=>trigger.click())
 await act(async()=>document.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})))
 expect(document.querySelector('[role=listbox]')).toBeNull();expect(change).not.toHaveBeenCalled()
})
