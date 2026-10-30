import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import SheetHandle from './SheetHandle'
it('sheet handle is a keyboard accessible button with explicit expanded state',async()=>{
 ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div'),root=createRoot(host),change=jest.fn()
 await act(async()=>root.render(<SheetHandle collapsed={false} onChange={change} iso="ru"/>))
 const button=host.querySelector('button')!
 expect(button.getAttribute('aria-expanded')).toBe('true')
 await act(async()=>button.click());expect(change).toHaveBeenCalledWith(true)
 await act(async()=>root.render(<SheetHandle collapsed onChange={change} iso="ru"/>))
 expect(button.getAttribute('aria-label')).toBe('Развернуть форму')
 await act(async()=>button.click());expect(change).toHaveBeenLastCalledWith(false)
 await act(async()=>root.unmount());delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT
})
