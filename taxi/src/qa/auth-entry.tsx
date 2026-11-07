import '../App.scss'
import '../design/rtl.css'
import '../design/shadcn.generated.css'
import '../design/rsale.css'
import '../design/mobile.css'
import '../design/address-fields.css'
import '../design/trip-options.css'
import '../design/system-ui.css'
import '../design/driver-chat.css'
import '../design/mobile-driver.css'
import '../design/mobile-dialogs.css'
import '../design/mobile-journey.css'
import '../design/order-switcher.css'
import '../design/mobile-card-modal.css'
import '../design/mobile-chat-status.css'
import '../design/drive-v2/tokens.css'
import '../design/drive-v2/surfaces.css'
import '../design/drive-v2/booking-layout.css'
import '../design/drive-v2/comfort-layout.css'
import '../design/drive-v2/header-layout.css'
import '../design/drive-v2/control-layout.css'
import '../design/drive-v2/journey-layout.css'
import '../design/drive-v2/booking-fit.css'
import '../design/drive-v2/auth-layout.css'
import '../design/drive-v2/dark-booking.css'
import '../design/drive-v2/palette-finish.css'
import '../design/drive-v2/review-actions.css'
import '../design/drive-v2/review-panel.css'
import '../design/trip3d/trip3d.css'

import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Provider} from 'react-redux'
import {createStore} from 'redux'
import {MemoryRouter} from 'react-router-dom'
import {HelmetProvider} from 'react-helmet-async'
import runtimeStore from '../state'
import {ActionTypes} from '../state/config/constants'
import {LoginForm} from '../components/modals/LoginModal/Login'
import {RegisterForm} from '../components/modals/LoginModal/Register'
import {JSONForm} from '../components/JSONForm'
import {EStatuses} from '../types/types'
import {TRANSLATION} from '../localization'
const language={id:1,iso:'ru',name:'Русский'}
runtimeStore.dispatch({type:ActionTypes.SET_LANGUAGE,payload:language})
const base=runtimeStore.getState(),store=createStore((state={...base,config:base.config.set('language',language as any)})=>state)
const noop=()=>{}
function Forms(){
 const [tab,setTab]=useState('sign-in'),[role,setRole]=useState('passenger'),[status,setStatus]=useState(EStatuses.Default)
 const props:any={isOpen:true,language,user:null,status,tab,message:status===EStatuses.Fail?'QA: пример отказа сервера':'',login:()=>setStatus(EStatuses.Fail),register:()=>setStatus(EStatuses.Fail),logout:noop,setStatus:noop,setMessage:noop,setLoginModal:noop,setRefOpen:noop,setWAOpen:noop,remindPassword:noop,googleLogin:noop}
 const fields:any=[{name:'u_name',label:TRANSLATION.NAME,type:'text',validation:{required:true}},{name:'u_email',label:TRANSLATION.EMAIL,type:'email',validation:{required:true}},{name:'u_phone',label:TRANSLATION.PHONE,type:'phone',validation:{required:true}},{name:'password',label:TRANSLATION.PASSWORD,type:'password',validation:{required:true,min:8}},{name:'password_confirm',label:TRANSLATION.PASSWORD_CONFIRM,type:'password',validation:{required:true,min:8}},{name:'submit',label:TRANSLATION.SIGNUP,type:'submit'}]
 return <><style>{`:root{--taxi-viewport-height:calc(100dvh - 48px)} .qa-forms-tools,.qa-forms-tools *{font:600 11px/16px Manrope,sans-serif}`}</style><div className="qa-forms-tools" style={{position:'fixed',top:0,insetInline:0,zIndex:10000,background:'white',padding:8,font:'12px Manrope,sans-serif',display:'flex',gap:12,alignItems:'center'}}><strong>QA · формы · локально · запросы запрещены</strong><button onClick={()=>setRole(role==='passenger'?'driver':'passenger')}>{role==='passenger'?'Клиент':'Водитель'}</button></div><div className="overlay__wrapper overlay__wrapper--active login-modal-overlay" style={{display:'flex',top:48,height:'calc(100dvh - 48px)',padding:12}}><div className="modal login-modal"><fieldset><legend>{tab==='sign-in'?'Вход':'Регистрация'}</legend><div className="login"><div className="tabs"><button type="button" onClick={()=>{setStatus(EStatuses.Default);setTab('sign-in')}}>Вход</button><button type="button" onClick={()=>{setStatus(EStatuses.Default);setTab('sign-up')}}>Регистрация</button></div><MemoryRouter key={role} initialEntries={[role==='driver'?'/driver-order':'/passenger-order']}>
 {tab==='sign-in'?<LoginForm {...props}/>:role==='passenger'?<RegisterForm {...props}/>:<JSONForm className="json-registration-form" {...({language,configStatus:EStatuses.Success,fields,onSubmit:()=>setStatus(EStatuses.Fail)} as any)}/>}</MemoryRouter></div></fieldset></div></div></>
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><HelmetProvider><Forms/></HelmetProvider></Provider>)
