import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {RegisterForm} from './RegisterJSON'
import {EStatuses,EUserRoles} from '../../../types/types'
let mockJsonProps
jest.mock('react-redux',()=>({connect:()=>component=>component}))
jest.mock('../../JSONForm',()=>({__esModule:true,default:props=>{mockJsonProps=props;return <div/>}}))
jest.mock('../../../localization',()=>({t:key=>key,TRANSLATION:new Proxy({},{get:(_,key)=>String(key)})}))
test('driver JSON registration defaults and submits Driver even if a stale service value says Client',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const original=window.data,host=document.createElement('div'),root=createRoot(host),register=jest.fn()
 window.data={site_constants:{form_register:{value:JSON.stringify({fields:[{name:'u_role',type:'hidden',defaultValue:EUserRoles.Client}]})}},car_models:{model:{}},car_colors:{red:{}},car_classes:{petit:{}}}
 try{
  await act(async()=>root.render(<MemoryRouter initialEntries={['/driver-order']}><RegisterForm status={EStatuses.Default} register={register} setStatus={jest.fn()} setMessage={jest.fn()} setMessageModal={jest.fn()}/></MemoryRouter>))
  expect(mockJsonProps.defaultValues.u_role).toBe(EUserRoles.Driver)
  await act(async()=>mockJsonProps.onSubmit({u_role:EUserRoles.Client,u_phone:'233555555555',password:'test-local-password',password_confirm:'test-local-password',u_car:{cm_id:'model',registration_plate:'TEST',seats:4,color:'red',cc_id:'petit'}}))
  expect(register).toHaveBeenCalledTimes(1);expect(register.mock.calls[0][0].u_role).toBe(EUserRoles.Driver)
 }finally{await act(async()=>root.unmount());window.data=original;delete global.IS_REACT_ACT_ENVIRONMENT}
})
