import React,{act} from 'react'
import {createRoot,Root} from 'react-dom/client'
import ZoneEditor from './ZoneEditor'
jest.mock('./ZoneMap',()=>({onPoint}:any)=> <button type="button" onClick={()=>onPoint([30.435,-9.60])}>test map point</button>)
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
