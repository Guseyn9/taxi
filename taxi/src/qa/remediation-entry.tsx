/** Local, network-disabled acceptance fixture. Never copied into the public release. */
import '../App.scss'
import '../design/drive-v2/tokens.css'
import '../design/shadcn.generated.css'
import '../design/drive-v2/review-actions.css'
import '../design/maps/maps.css'
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createStore } from 'redux'
import { Provider } from 'react-redux'
import { HelmetProvider } from 'react-helmet-async'
import runtimeStore from '../state'
import modalsReducer from '../state/modals/reducer'
import { ActionTypes as ConfigActions } from '../state/config/constants'
import { modalsActionCreators } from '../state/modals'
import MessageModal from '../components/modals/MessageModal'
import { CancelOrderModal } from '../components/modals/CancelModal'
import RouteFailure from '../design/maps/RouteFailure'
import { RatingModal } from '../components/modals/RatingModal'
import { ProfileModalContent } from '../components/modals/ProfileModal'
import { backendGateway } from '../platform/adapters/LegacyBackendGateway'
import { CURRENCY } from '../siteConstants'
import { assertSuccessfulMutationResponse } from '../platform/adapters/backendError'
import { EStatuses, EUserRoles, EUserCheckStates, EBookingStates } from '../types/types'
import { setLocalizationLanguageReader } from '../localization/runtime'

runtimeStore.dispatch({ type: ConfigActions.SET_LANGUAGE, payload: { id: 1, iso: 'ru', native: 'Русский' } })
const original = runtimeStore.getState()
const base = {...original, user:original.user.set('user',{u_id:'fixture-client',u_role:EUserRoles.Client} as any), config:original.config.set('status',EStatuses.Success).set('language',{id:1,iso:'ru',native:'Русский'} as any)}
const store = createStore((state: typeof base = base, action: any) => ({ ...state, modals: modalsReducer(state.modals, action) }))
setLocalizationLanguageReader(() => store.getState().config.language)
const noop = () => {}
CURRENCY.NAME = 'GHS'
;(window as any).data = { site_constants:{ form_profile:{value:{fields:[{name:'u_car.seats',label:'Мест в машине',type:'number'},{name:'u_name',label:'Имя',type:'text'},{name:'save_fixture',label:'Сохранить',type:'submit',submit:false}]}}}}
;(backendGateway as any).editUser = async() => { throw new Error('fixture: profile refused after car save') }
function Fixture() {
  const [cancelOpen, setCancelOpen] = useState(false), [selected, setSelected] = useState<string | null>('fixture-order')
  const [accepted, setAccepted] = useState(false), [routeError, setRouteError] = useState(false), [attempts, setAttempts] = useState(0)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const pricingOrder = { b_id:'pricing-fixture',b_state:EBookingStates.Completed,b_currency:'MAD',b_completed:'2026-11-07T10:15:00Z',drivers:[{u_id:'fixture-driver',c_started:'2026-11-07T10:00:00Z'}],b_options:{pricingModel:{formula:'distance * rate',options:{distance:2.9,rate:2.5},calculationType:'complete'}} }
  return <main style={{padding:24,background:'#fff',height:'100%',overflow:'auto',color:'#172536'}}>
    <h1>Локальная приёмка frontend</h1><p>Сеть отключена CSP. Ответы API заданы fixture; аккаунтов и реальных заказов нет.</p>
    <button onClick={() => setRatingOpen(true)}>Цена: дроби и валюта заказа</button>
    <button onClick={() => setProfileOpen(true)}>Профиль: частичное сохранение</button>
    <button onClick={() => { setSelected('fixture-order'); setCancelOpen(true) }}>Открыть отмену</button>
    <button onClick={() => setAccepted(true)}>Следующий ответ: успех</button>
    <p role="status">Заказ: {selected || 'снят'} · ответ: {accepted ? 'успех' : 'code 200 / status error'}</p>
    <button onClick={() => { store.dispatch(modalsActionCreators.setMessageModal({isOpen:true,status:EStatuses.Fail,message:'Первая операция: отказ отмены'})); store.dispatch(modalsActionCreators.setMessageModal({isOpen:true,status:EStatuses.Fail,message:'Вторая операция: отказ загрузки'})) }}>Две одновременные ошибки</button>
    <button onClick={() => setRouteError(true)}>Маршрут: timeout</button>
    <div style={{position:'relative',height:220,maxWidth:420,marginTop:20,background:'#f3f5f8'}}>
      {routeError && <RouteFailure onRetry={() => {setAttempts(value=>value+1);setRouteError(false)}} />}
    </div><p>Повторов маршрута: {attempts}</p>
    <CancelOrderModal {...({selectedOrder:selected,isOpen:cancelOpen,setCancelModal:setCancelOpen,setMessageModal:(message:any)=>store.dispatch(modalsActionCreators.setMessageModal(message)),setVoteModal:noop,setDriverModal:noop,setOnTheWayModal:noop,setSelectedOrder:setSelected,cancelOrder:async()=>assertSuccessfulMutationResponse(accepted?{code:'200',status:'success'}:{code:'200',status:'error',message:'fixture rejection'}),refreshActiveOrders:noop} as any)} />
    <MessageModal />
    <RatingModal {...({isOpen:ratingOpen,orderID:'pricing-fixture',selectedOrder:null,detailedOrder:pricingOrder,language:{id:1,iso:'ru',native:'Русский'},setRatingModal:(value:{isOpen:boolean})=>setRatingOpen(value.isOpen)} as any)} />
    <ProfileModalContent {...({isOpen:profileOpen,user:{u_id:'fixture-driver',u_name:'Тест',u_role:EUserRoles.Driver,u_check_state:EUserCheckStates.Required,u_details:{}},car:{c_id:7,seats:4,registration_plate:'FIXTURE'},activeOrders:[],language:{iso:'ru'},getUserCars:noop,updateUser:noop,editCar:async()=>({code:'200',status:'success'}),createUserCar:async()=>({code:'200',status:'success'}),setProfileModal:()=>setProfileOpen(false),setMessageModal:(message:any)=>store.dispatch(modalsActionCreators.setMessageModal(message))} as any)} />
  </main>
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><HelmetProvider><Fixture /></HelmetProvider></Provider>)
