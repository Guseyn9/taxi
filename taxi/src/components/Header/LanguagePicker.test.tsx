import React,{act} from 'react'
import {createRoot,Root} from 'react-dom/client'
import LanguagePicker from './LanguagePicker'
import {ILanguage} from '../../types/types'
const languages=[{id:1,iso:'ru',native:'Русский',logo:'ru'},{id:2,iso:'ar',native:'العربية',logo:'ma'},{id:3,iso:'fr',native:'Français',logo:'fr'}] as ILanguage[]
let host:HTMLDivElement,root:Root
beforeEach(()=>{(global as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete (global as any).IS_REACT_ACT_ENVIRONMENT})
it('offers languages from the header, supports arrows/selection and returns focus to the trigger',async()=>{
 const choose=jest.fn();await act(async()=>root.render(<LanguagePicker language={languages[0]} languages={languages} label="Язык" onChange={choose}/>))
 const trigger=host.querySelector('button')!
 await act(async()=>trigger.click());expect(trigger.getAttribute('aria-expanded')).toBe('true')
 expect(document.activeElement?.getAttribute('aria-checked')).toBe('true')
 await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})))
 expect(document.activeElement!.textContent).toBe('العربية')
 await act(async()=>(document.activeElement as HTMLButtonElement).click())
 expect(choose).toHaveBeenCalledWith(languages[1]);expect(host.querySelector('[role=menu]')).toBeNull();expect(document.activeElement).toBe(trigger)
})
it('Escape closes without changing language',async()=>{
 const choose=jest.fn();await act(async()=>root.render(<LanguagePicker language={languages[0]} languages={languages} label="Язык" onChange={choose}/>))
 await act(async()=>host.querySelector('button')!.click())
 await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(choose).not.toHaveBeenCalled();expect(host.querySelector('[role=menu]')).toBeNull()
})
it('notifies the host on open and dismisses when the main menu opens',async()=>{
 const opened=jest.fn(),choose=jest.fn()
 const render=(dismiss=false)=>root.render(<LanguagePicker language={languages[0]} languages={languages} label="Язык" onChange={choose} onOpen={opened} dismiss={dismiss}/>)
 await act(async()=>render())
 await act(async()=>host.querySelector('button')!.click())
 expect(opened).toHaveBeenCalledTimes(1)
 await act(async()=>render(true))
 expect(host.querySelector('[role=menu]')).toBeNull()
 expect(host.querySelector('button')!.getAttribute('aria-expanded')).toBe('false')
 expect(choose).not.toHaveBeenCalled()
})
