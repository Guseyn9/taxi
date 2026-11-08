import React,{act} from 'react'
import {createRoot,Root} from 'react-dom/client'
import ZoneEditor from './ZoneEditor'
jest.mock('./ZoneMap',()=>({onPoint,onMoveVertex,onInsertVertex,onSelectVertex}:any)=> <><button type="button" onClick={()=>onPoint([30.435,-9.60])}>test map point</button><button type="button" onClick={()=>onMoveVertex(0,[30.1,-9.1])}>test drag vertex</button><button type="button" onClick={()=>onInsertVertex(0,[30.5,-9])}>test insert vertex</button><button type="button" onClick={()=>onSelectVertex(0)}>test select vertex</button></>)
let host:HTMLDivElement,root:Root
beforeEach(()=>{(global as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete (global as any).IS_REACT_ACT_ENVIRONMENT})
const zone={id:'79',var:'agadir',json:{lat:30,lng:-9,radius:200}}
it('requires explicit confirmation and sends exactly the validated geometry',async()=>{
 const save=jest.fn()
 await act(async()=>root.render(<ZoneEditor zone={zone} iso="ru" busy={false} blocked={false} onDirty={()=>{}} onSave={save} onCancel={()=>{}}/>))
 const submit=host.querySelector('button[type=submit]') as HTMLButtonElement
 expect(submit.disabled).toBe(true)
 await act(async()=>submit.click());expect(save).not.toHaveBeenCalled()
 await act(async()=>(host.querySelector('input[type=checkbox]') as HTMLInputElement).click())
 await act(async()=>submit.click());expect(save).toHaveBeenCalledTimes(1)
 expect(save).toHaveBeenCalledWith(expect.objectContaining({id:'79',var:'agadir',json:{lat:30,lng:-9,radius:200}}),'circle')
})
it('blocks double writes while pending or the previous result is uncertain',async()=>{
 const save=jest.fn()
 for(const state of [{busy:true,blocked:false},{busy:false,blocked:true}]){
 await act(async()=>root.render(<ZoneEditor zone={zone} iso="en" {...state} onDirty={()=>{}} onSave={save} onCancel={()=>{}}/>))
 expect((host.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true)
 expect((host.querySelector('input') as HTMLInputElement).disabled||host.querySelector('fieldset')?.disabled).toBe(true)
 }
 expect(save).not.toHaveBeenCalled()
})

it('map selection updates a circle centre and invalidates the confirmation',async()=>{
 const save=jest.fn(),dirty=jest.fn()
 await act(async()=>root.render(<ZoneEditor zone={zone} iso="ru" busy={false} blocked={false} onDirty={dirty} onSave={save} onCancel={()=>{}}/>))
 await act(async()=>(host.querySelector('input[type=checkbox]') as HTMLInputElement).click())
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='test map point')!.click())
 expect((host.querySelector('input[name=zone-lat]') as HTMLInputElement).value).toBe('30.435')
 expect((host.querySelector('input[name=zone-lng]') as HTMLInputElement).value).toBe('-9.6')
 expect((host.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false)
 expect(dirty).toHaveBeenCalledWith(true)
})
it('keeps an edited polygon closed when a point is added and blocks repeated closure',async()=>{
 const polygon={id:'79',var:'area',coordinates:[[[30,-9],[31,-9],[31,-8],[30,-9]] as [number,number][]]}
 await act(async()=>root.render(<ZoneEditor zone={polygon} iso="en" busy={false} blocked={false} onDirty={()=>{}} onSave={()=>{}} onCancel={()=>{}}/>))
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='test map point')!.click())
 const coordinates=JSON.parse((host.querySelector('textarea') as HTMLTextAreaElement).value)
 expect(coordinates[0]).toEqual(coordinates[coordinates.length-1]);expect(coordinates).toHaveLength(5)
 expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Close boundary')!.disabled).toBe(true)
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Remove last point')!.click())
 expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Close boundary')!.disabled).toBe(false)
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Close boundary')!.click())
 expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Close boundary')!.disabled).toBe(true)
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Clear boundary')!.click())
 expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('[]')
})
it('invalidates confirmation after dragging, inserting or deleting a vertex',async()=>{
 const polygon={id:'79',var:'area',coordinates:[[[30,-9],[31,-9],[31,-8],[30,-8],[30,-9]] as [number,number][]]}
 await act(async()=>root.render(<ZoneEditor zone={polygon} iso="en" busy={false} blocked={false} onDirty={()=>{}} onSave={()=>{}} onCancel={()=>{}}/>))
 const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text)!
 const read=()=>JSON.parse((host.querySelector('textarea') as HTMLTextAreaElement).value)
 await act(async()=>(host.querySelector('input[type=checkbox]') as HTMLInputElement).click())
 await act(async()=>button('test drag vertex').click())
 expect(read()[0]).toEqual([30.1,-9.1]);expect(read().at(-1)).toEqual(read()[0])
 expect((host.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false)
 await act(async()=>button('test insert vertex').click());expect(read()).toHaveLength(6)
 await act(async()=>button('test select vertex').click())
 await act(async()=>button('Delete selected point').click());expect(read()).toHaveLength(5);expect(read()[0]).toEqual(read().at(-1))
})
it('updates the exact circle radius from the slider and requires confirmation again',async()=>{
 await act(async()=>root.render(<ZoneEditor zone={zone} iso="en" busy={false} blocked={false} onDirty={()=>{}} onSave={()=>{}} onCancel={()=>{}}/>))
 await act(async()=>(host.querySelector('input[type=checkbox]') as HTMLInputElement).click())
 const slider=host.querySelector('input[type=range]') as HTMLInputElement
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'750');slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}))})
 expect((host.querySelector('input[name=zone-radius]') as HTMLInputElement).value).toBe('750')
 expect((host.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false)
})
it('keeps malformed coordinate text intact when the map emits a point or drag',async()=>{
 const polygon={var:'area',coordinates:[[[30,-9],[31,-9],[31,-8],[30,-9]] as [number,number][]]},save=jest.fn()
 await act(async()=>root.render(<ZoneEditor zone={polygon} iso="en" busy={false} blocked={false} onDirty={()=>{}} onSave={save} onCancel={()=>{}}/>))
 const field=host.querySelector('textarea') as HTMLTextAreaElement,bad='[[30,-9], BROKEN'
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,bad);field.dispatchEvent(new Event('input',{bubbles:true}))})
 for(const text of ['test map point','test drag vertex','test insert vertex'])await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text)!.click())
 expect(field.value).toBe(bad);expect(field.getAttribute('aria-invalid')).toBe('true');expect(host.querySelector('[role=alert]')!.textContent).toContain('Your text has been kept')
 expect(save).not.toHaveBeenCalled()
})
