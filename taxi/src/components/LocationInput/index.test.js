import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import LocationInput from './index'
import {EPointType} from '../../types/types'
jest.mock('react-redux',()=>({connect:()=>component=>component}))
jest.mock('../../state/config',()=>({configSelectors:{}}))
jest.mock('../../state/clientOrder',()=>({clientOrderSelectors:{},clientOrderActionCreators:{}}))
jest.mock('../../siteConstants',()=>({__esModule:true,default:{BOOKING_LOCATION_CLASSES:[{id:'city',kind:0}]}}))
jest.mock('../../platform/adapters/LegacyBackendGateway',()=>({backendGateway:{getPointSuggestions:jest.fn()}}))
jest.mock('../../tools/hooks',()=>({useCachedState:()=>[true,jest.fn()]}))
jest.mock('../../tools/utils',()=>({cachedOrderDataStateKey:'qa'}))
jest.mock('../Input',()=>({__esModule:true,default:({inputProps})=><input {...inputProps}/>,EInputStyles:{RedDesign:'red'}}))
jest.mock('../modals/Overlay',()=>({__esModule:true,default:()=>null}))
test('a stale or missing location class cannot crash editable addresses',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host)
 const props={language:{iso:'ru'},from:null,to:null,locationClass:'removed',setFrom:jest.fn(),setTo:jest.fn(),type:EPointType.From,onOpenMap:jest.fn()}
 await act(async()=>root.render(<LocationInput {...props}/>))
 expect(host.querySelector('input')).not.toBeNull()
 await act(async()=>root.render(<LocationInput {...props} locationClass="city"/>))
 expect(host.querySelector('input').disabled).toBe(false)
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
