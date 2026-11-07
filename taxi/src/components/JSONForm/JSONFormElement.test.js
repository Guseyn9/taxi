import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import * as yup from 'yup'
import JSONFormElement from './JSONFormElement'
jest.mock('../Button',()=>()=>null)
jest.mock('./utils',()=>({getCalculation:v=>v,isRequired:()=>true,getTranslation:v=>v,parseVariable:v=>v}))
let host,root
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT})
test('driver JSON email does not complain during initial input; blur validates and corrections clear the error',async()=>{
 const schema=yup.string().email('Invalid email').required('Required')
 function Form(){const [value,setValue]=React.useState('');return <JSONFormElement element={{name:'email',type:'email',label:'Email'}} validationSchema={schema} values={{email:value}} onChange={(_,name,value)=>setValue(value)}/>}
 await act(async()=>root.render(<Form/>))
 const input=host.querySelector('input'),set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
 await act(async()=>{set.call(input,'ma');input.dispatchEvent(new Event('input',{bubbles:true}))})
 expect(host.textContent).not.toContain('Invalid email')
 await act(async()=>input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})))
 expect(host.textContent).toContain('Invalid email')
 await act(async()=>{set.call(input,'max@example.com');input.dispatchEvent(new Event('input',{bubbles:true}))})
 expect(host.textContent).not.toContain('Invalid email')
})
