/** Local visual acceptance only. Build with connect-src none; never publish. */
import '../App.scss'
import '../design/shadcn.generated.css'
import '../design/rsale.css'
import '../design/mobile.css'
import '../design/address-fields.css'
import '../design/trip-options.css'
import '../design/system-ui.css'
import '../design/mobile-dialogs.css'
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
import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Provider} from 'react-redux'
import {createStore, applyMiddleware} from 'redux'
import {MemoryRouter} from 'react-router-dom'
import {HelmetProvider} from 'react-helmet-async'
import runtimeStore from '../state'
import Layout from '../components/Layout'
import ConnectionBar from '../design/reliability/ConnectionBar'
import {readHealthMiddleware} from '../design/reliability/readHealth'
import {ActionTypes as OrdersActions} from '../state/orders/constants'
import {EStatuses, EUserRoles} from '../types/types'
import {setLocalizationLanguageReader} from '../localization/runtime'
import PassengerPhoneField from '../pages/Passenger/PassengerPhoneField'
import {RideRequestActions} from '../design/RideRequestActions'
import {bookingSubmissionError} from '../design/bookingSubmissionError'

const language = {id:1, iso:'ru', native:'Русский'}
const original = runtimeStore.getState()
const base = {...original, user:original.user.set('user', {u_id:'fixture-client',u_role:EUserRoles.Client,u_name:'QA'} as any),
  config:original.config.set('status',EStatuses.Success).set('language',language as any)}
const store = createStore((state: typeof base = base) => state, applyMiddleware(readHealthMiddleware))
setLocalizationLanguageReader(() => store.getState().config.language)
function Fixture() {
  const [phone, setPhone] = useState<number | null>(null)
  const [mode, setMode] = useState<'order'|'offer'|'vote'>('order')
  const [amount, setAmount] = useState('100'), [error, setError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0), [reads, setReads] = useState(0), [uncertain, setUncertain] = useState(false)
  return <><ConnectionBar/><Layout><div style={{padding:16,overflow:'auto',background:'#fff',height:'100%',color:'#222'}}>
    <h1 style={{fontSize:18}}>Приёмка замечаний Валентина</h1><p>Локальные ответы. Сеть запрещена CSP; реальных заказов нет.</p>
    <button onClick={() => store.dispatch({type:OrdersActions.GET_ACTIVE_ORDERS_FAIL})}>Показать сбой обновления</button>
    <div className="rs-ride-body"><PassengerPhoneField phone={phone} onChange={setPhone} iso="ru"/></div>
    <div style={{padding:12,marginTop:12,background:'var(--drive-wine)',borderRadius:16}}>
      <RideRequestActions mode={mode} onChange={setMode} iso="ru" submitDisabled={uncertain} error={error}
        onStartNew={uncertain ? () => {setUncertain(false);setError(null)} : undefined}
        onRefresh={() => setReads(value => value + 1)} recoveryLabel="Проверить заказы"
        priceField={<input aria-label="Сумма предложения" value={amount} onChange={event => setAmount(event.target.value)}/>}
        onSubmit={() => {setAttempts(value => value + 1); setError(bookingSubmissionError(uncertain ? {code:'ECONNABORTED'} : {status:'error',code:'404'}, 'offer','ru'))}}/>
    </div>
    <button onClick={() => {setUncertain(true);setError(bookingSubmissionError({code:'ECONNABORTED'},'offer','ru'))}}>Неподтверждённая отправка</button>
    <p>Отправок fixture: {attempts}; проверок: {reads}</p>
  </div></Layout></>
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><HelmetProvider><MemoryRouter initialEntries={['/passenger-order']}><Fixture/></MemoryRouter></HelmetProvider></Provider>)
