import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
jest.mock('react-helmet-async',()=>({Helmet:({children})=><>{children}</>}))
jest.mock('../../Button',()=>({__esModule:true,default:props=><button type="button" onClick={props.onClick}>{props.text}</button>,EButtonShapes:{Flat:0}}))
jest.mock('../../../localization',()=>({t:value=>value,TRANSLATION:{}}))
import Input from '../index'
const originalScrollIntoView=HTMLElement.prototype.scrollIntoView
beforeAll(()=>{HTMLElement.prototype.scrollIntoView=jest.fn()})
afterAll(()=>{HTMLElement.prototype.scrollIntoView=originalScrollIntoView})
test.each([false,true])('suggestions (floating=%s) require an explicit choice; arrows and Enter select the highlighted result and Escape dismisses',async(floating)=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);const select=jest.fn()
 const suggestions=[{point:{address:'Agadir first'}},{point:{address:'Agadir second'}}]
 await act(async()=>root.render(<Input floatingSuggestions={floating} inputProps={{'aria-label':'Address',value:'Agadir',onChange:()=>{}}} suggestions={suggestions} onSuggestionClick={select}/>))
 const input=host.querySelector('input')
 host.querySelector('.input__wrapper').getBoundingClientRect=()=>({x:20,y:120,top:120,left:20,right:320,bottom:164,width:300,height:44})
 await act(async()=>input.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));expect(input.getAttribute('aria-expanded')).toBe('true')
 if(floating){expect(host.querySelector('[role=listbox]')).toBeNull();expect(document.querySelector('.rs-address-suggestions-popup [role=listbox]')).not.toBeNull()}
 const key=key=>input.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}))
 await act(async()=>key('Enter'));expect(select).not.toHaveBeenCalled()
 await act(async()=>key('ArrowDown'));expect(input.getAttribute('aria-activedescendant')).toContain('result-0');await act(async()=>key('ArrowDown'));expect(input.getAttribute('aria-activedescendant')).toContain('result-1');await act(async()=>key('Enter'))
 expect(select).toHaveBeenCalledWith(suggestions[1]);expect(input.getAttribute('aria-expanded')).toBe('false')
 await act(async()=>input.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));await act(async()=>key('Escape'));expect(input.getAttribute('aria-expanded')).toBe('false')
 await act(async()=>input.click());expect(input.getAttribute('aria-expanded')).toBe('true')
 await act(async()=>key('Escape'));await act(async()=>key('ArrowDown'));expect(input.getAttribute('aria-expanded')).toBe('true')
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
test('a translated suggestion label does not change the selected point or its original address',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div'),root=createRoot(host),select=jest.fn()
 document.body.appendChild(host)
 const item=Object.freeze({point:Object.freeze({address:'Avenue Hassan II شارع الحسن الثاني',latitude:30.414728,longitude:-9.594088})})
 await act(async()=>root.render(<Input inputProps={{value:'Hassan',onChange:()=>{}}} suggestions={[item]} getSuggestionLabel={()=>'Avenue Hassan II'} onSuggestionClick={select}/>))
 await act(async()=>host.querySelector('input').dispatchEvent(new FocusEvent('focusin',{bubbles:true})))
 expect(host.querySelector('.input__suggestion-text').textContent).toBe('Avenue Hassan II')
 await act(async()=>host.querySelector('[role=option]').click())
 expect(select).toHaveBeenCalledWith(item)
 expect(select.mock.calls[0][0].point.address).toContain('شارع')
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
