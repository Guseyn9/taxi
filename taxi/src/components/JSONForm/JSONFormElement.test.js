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

test('checkbox blur validates a boolean and checking clears the required error',async()=>{
 const schema=yup.boolean().oneOf([true],'Accept required')
 function Form(){const [value,setValue]=React.useState(false);return <JSONFormElement element={{name:'consent',type:'checkbox',label:'Accept'}} validationSchema={schema} values={{consent:value}} onChange={(_,name,next)=>setValue(next)}/>}
 await act(async()=>root.render(<Form/>));const input=host.querySelector('input')
 await act(async()=>input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})))
 expect(host.textContent).toContain('Accept required')
 await act(async()=>input.click());expect(host.textContent).not.toContain('Accept required')
})
test('file selection and removal update local required validation using the actual file array',async()=>{
 const schema=yup.array().nullable().required('File required').min(1,'File required')
 function Form(){const [value,setValue]=React.useState(null);return <JSONFormElement element={{name:'photo',type:'file',label:'Photo',accept:'image/png'}} validationSchema={schema} values={{photo:value}} onChange={(_,name,next)=>setValue(next)}/>}
 await act(async()=>root.render(<Form/>));const input=host.querySelector('input[type=file]')
 await act(async()=>input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));expect(host.textContent).toContain('File required')
 Object.defineProperty(input,'files',{configurable:true,value:[new File(['image'],'photo.png',{type:'image/png'})]})
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(host.textContent).not.toContain('File required')
 await act(async()=>host.querySelector('.element__file_value').click());expect(host.textContent).toContain('File required')
})
test('uses a new dependent validation schema after rerender',async()=>{
 const soft=yup.string(),hard=yup.string().required('Now required')
 const render=schema=>root.render(<JSONFormElement element={{name:'name',type:'text',label:'Name'}} validationSchema={schema} values={{name:''}} onChange={()=>{}} />)
 await act(async()=>render(soft));await act(async()=>render(hard))
 await act(async()=>host.querySelector('input').dispatchEvent(new FocusEvent('focusout',{bubbles:true})))
 expect(host.textContent).toContain('Now required')
})
