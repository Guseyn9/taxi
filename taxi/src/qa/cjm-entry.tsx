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
import '../design/trip3d/trip3d.css'
import '../pages/Driver/styles.scss'
/** Separate, read-only QA entry. No App/bootstrap, network commands or real orders. */
import React,{useState} from 'react'
import {HelmetProvider} from 'react-helmet-async'
import {createRoot} from 'react-dom/client'
import {Provider} from 'react-redux'
import {createStore} from 'redux'
import moment from 'moment'
import localizationStore from '../state'
import {MiniOrders} from '../components/MiniOrders'
import {backendGateway} from '../platform/adapters/LegacyBackendGateway'
import {ActionTypes} from '../state/config/constants'
import MapPriorityFixture from './MapPriorityFixture'
import PassengerLiveOrder from '../components/PassengerLiveOrder'
import DriverOrderOverview from '../components/DriverOrderOverview'
import {passengerGateway} from '../platform/adapters/LegacyPassengerGateway'
import {EBookingDriverState as S,EBookingStates as B} from '../types/types'
import {resolvePassengerUiState} from '../pages/Passenger/uiFsm'
import {getDriverFreeSeats} from '../tools/driverCapacity'
import {getPayment} from '../tools/utils'
import './cjm-styles.css'
import '../design/drive-v2/palette-finish.css'
import '../design/drive-v2/review-actions.css'
import '../design/drive-v2/review-panel.css'

const language={id:'1',iso:'ru',name:'Русский'}
localizationStore.dispatch({type:ActionTypes.SET_LANGUAGE,payload:language})
const base=localizationStore.getState()
const user:any={u_id:'qa-passenger',u_name:'Тестовый клиент'}
const driver:any={u_id:'qa-driver',u_name:'Тестовый водитель'}
const car:any={c_id:'QA-CAR',cc_id:'1',seats:4,registration_plate:'QA 001',manufacturer:'Dacia',model:'Logan'}
const state={...base,config:base.config.set('language',language as any),user:base.user.set('user',user)}
const store=createStore((value=state)=>value)
// QA only: route and identity reads resolve locally. CSP blocks every outbound request.
Object.assign(backendGateway,{makeRoutePoints:async()=>({points:[],distance:1200,duration:240})})
// These read fixtures only supply identity cards; order actions are inert.
Object.assign(passengerGateway,{getUser:async()=>driver,getCar:async()=>car,getUsers:async(ids:any[])=>ids.map((id,index)=>({...driver,u_id:id,u_name:`Водитель ${index+1}`})),getCars:async(ids:any[])=>ids.map(id=>({...car,c_id:id}))})
const params=new URLSearchParams(location.search),role=params.get('role')||'client',stage=params.get('stage')||'offers'
const stages:any={offers:'Отклик',assigned:'Подача',started:'Поездка',finished:'Завершение'}
function make(mode:string):any{
 const status=stage==='offers'?(mode==='order'?S.Performer:S.Considering):stage==='assigned'?S.Performer:stage==='started'?S.Started:S.Finished
 return {b_id:`QA-${mode}`,u_id:user.u_id,b_state:stage==='finished'?B.Completed:B.Processing,b_cars_count:mode==='offer'?0:1,b_voting:mode==='vote',b_car_class:'1',b_location_class:'1',b_passengers_count:1,b_created:moment(),b_start_datetime:moment().add(10,'minutes'),b_currency:'GHS',b_price_estimate:22.5,b_payment_way:1,b_contact:[],b_services:[],b_comments:[],b_rating:0,b_start_address:'Avenue Hassan II, Agadir',b_destination_address:'Marina, Agadir',b_start_latitude:30.416,b_start_longitude:-9.6,b_destination_latitude:30.425,b_destination_longitude:-9.615,b_options:mode==='offer'?{customer_price:150}:{},profit:mode==='offer'?14.43:8.5,profitPerEmptyKm:11.19,drivers:[{...driver,c_id:'QA-CAR',c_state:status,c_arrive_state:false,c_latitude:30.417,c_longitude:-9.602,c_options:mode==='offer'?{driver_offer_price:180,driver_offer_eta:5}:{},c_pickup_time:5}]}
}
function MultiOrderView(){
 const bookings=React.useMemo(()=>['order','vote','offer'].map((mode,index)=>({...make(mode),b_id:`QA-${index+1}`,drivers:[],b_start_address:['Avenue Hassan II, Agadir','Marina, Agadir','Souk El Had, Agadir'][index],b_destination_address:['Place Al Amal, Agadir','Talborjt, Agadir','Founty, Agadir'][index]})),[])
 const [selected,setSelected]=useState(bookings[0].b_id)
 const order=bookings.find(item=>item.b_id===selected)!
 const noop=()=>{}
 return <main className="qa-page qa-multi"><header><b>Клиент · несколько заказов</b><span>Локальные данные · без запросов к backend</span></header><MiniOrders {...({ownerId:user.u_id,activeOrders:bookings,selectedOrder:selected,language,handleOrderClick:(item:any)=>setSelected(item.b_id),setSelectedOrder:setSelected,setRatingModal:noop,setMessageModal:noop,setSosModal:noop,refreshActiveOrders:noop} as any)}/><section className="qa-selected-booking" aria-live="polite"><h2>Заказ {selected}</h2><p>Откуда: {order.b_start_address}</p><p>Куда: {order.b_destination_address}</p><p>Нажмите другую плашку: выбранный заказ и его адреса изменятся.</p></section></main>
}
function CompactDriverView(){return <main className="qa-page"><header><b>QA · Кратко · 6 заказов</b><span>Тестовые данные · backend не подключён</span></header><section className="driver--mobile-first driver--lite"><div className="driver-orders__list">{Array.from({length:6},(_,index)=>{const mode=['order','vote','offer'][index%3],order={...make(mode),b_id:`QA-${index+1}`};return <article className="mini-order driver-card--overview" key={order.b_id}><DriverOrderOverview order={order} user={driver} iso="ru"/></article>})}</div></section></main>}
function View(){if(role==='client'&&stage==='map'){const order={...make('vote'),b_id:'QA-MAP',drivers:[{...make('vote').drivers[0],u_id:'qa-driver-1',u_name:'',u_family:'',c_id:'QA-1',c_state:S.Considering},{...make('vote').drivers[0],u_id:'qa-driver-2',u_name:'',u_family:'',c_id:'QA-2',c_state:S.Considering}]};return <MapPriorityFixture order={order}/>};if(role==='client'&&stage==='multi')return <MultiOrderView/>;if(role==='driver'&&stage==='compact')return <CompactDriverView/>;return <main className="qa-page"><header><b>QA · {role==='client'?'Клиент':'Водитель'} · {stages[stage]}</b><span>Локальные данные · backend не подключён</span></header><nav>{Object.keys(stages).map(key=><a key={key} href={`?role=${role}&stage=${key}`} aria-current={stage===key?'step':undefined}>{stages[key]}</a>)}<a href={`?role=${role==='client'?'driver':'client'}&stage=${stage}`}>Сменить роль</a></nav><div className="qa-grid">{['order','vote','offer'].map(mode=>{const order=make(mode);return <section key={mode}><h2>{{order:'Такси',vote:'Голосование',offer:'Своя цена'}[mode]}</h2><p className="qa-caption">{mode==='offer'?'Клиент 150 → отклик 180':mode==='vote'?'Еду на первом прибывшем такси':'Водитель принимает заказ'}</p><div className={`qa-readonly ${role==='driver'?'driver--mobile-first':''}`} ref={node=>node?.setAttribute('inert','')}>{role==='client'?(stage==='finished'?<div className="qa-terminal"><h3>{resolvePassengerUiState({selectedOrder:order})==='TRIP_FINISHED'?'Поездка завершена':'Ошибка статуса'}</h3><p>Стоимость {getPayment(order).value} GHS</p><p>Следующий шаг — оценка поездки</p></div>:<PassengerLiveOrder order={order}/>):<DriverOrderOverview order={order} user={driver} iso="ru"/>}</div>{role==='driver'&&<p className="qa-caption">Свободных мест: {getDriverFreeSeats(car,[order],driver.u_id)} / 4</p>}</section>})}</div><footer>Скриншот реальных карточек на тестовых данных. Это проверка отображения, не подтверждение серверной поездки. Экран завершения клиента — сводка результата FSM.</footer></main>}
createRoot(document.getElementById('root')!).render(<HelmetProvider><Provider store={store}><View/></Provider></HelmetProvider>)
