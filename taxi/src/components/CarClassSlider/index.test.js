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
