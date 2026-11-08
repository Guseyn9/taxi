import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {CarClassSlider} from './index'
jest.mock('react-redux',()=>({connect:()=>component=>component}))
jest.mock('../../state/clientOrder',()=>({clientOrderSelectors:{},clientOrderActionCreators:{}}))
jest.mock('../../tools/utils',()=>({formatCurrency:v=>`${v} GHS`}))
jest.mock('../../localization',()=>({t:v=>v,TRANSLATION:{CAR_CLASSES:{50:'PETIT',51:'GRAND'}}}))
test('class cards survive hidden search layout and select exactly one class without a width-based carousel',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),select=jest.fn()
 const props={carClasses:[{id:50,courier_call_rate:10},{id:51,courier_call_rate:10}],carClass:50,locationClass:null,locationClasses:[],setCarClass:select}
 await act(async()=>root.render(<div hidden><CarClassSlider {...props}/></div>))
 await act(async()=>root.render(<div><CarClassSlider {...props}/></div>))
 expect(host.querySelectorAll('button')).toHaveLength(2)
 expect(host.querySelector('ul').style.width).toBe('')
 await act(async()=>host.querySelectorAll('button')[1].click())
 expect(select).toHaveBeenCalledTimes(1);expect(select).toHaveBeenCalledWith(51)
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
test.each([1,2,12])('%s configured classes stay available without inventing IDs',async count=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),select=jest.fn()
 const classes=Array.from({length:count},(_,i)=>({id:50+i,courier_call_rate:10}))
 await act(async()=>root.render(<CarClassSlider carClasses={classes} carClass={classes[0].id} locationClass={null} locationClasses={[]} setCarClass={select}/>))
 expect(host.querySelectorAll('button')).toHaveLength(count)
 expect(host.querySelector('[data-class-count]').getAttribute('data-class-count')).toBe(String(count))
 await act(async()=>host.querySelectorAll('button')[count-1].click())
 expect(select).toHaveBeenLastCalledWith(classes[count-1].id)
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
