import React,{useState,useEffect} from 'react'
import {WifiOff,RefreshCw} from 'lucide-react'
import {useSelector} from 'react-redux'
import store from '../../state'
import {userSelectors,userActionCreators} from '../../state/user'
import {configSelectors} from '../../state/config'
import {clientOrderSelectors} from '../../state/clientOrder'
import {ordersActionCreators} from '../../state/orders'
import {orderSelectors,orderActionCreators} from '../../state/order'
import {ActionTypes} from '../../state/orders/constants'
import {EUserRoles} from '../../types/types'
import {readHealth,subscribeReadHealth,subscribeResume} from './readHealth'
import './connection.css'
const words={ru:['Нет связи. Показаны последние данные поездки.','Не удалось обновить поездку. Показаны последние данные.','Обновляем данные поездки…','Повторить'],en:['Offline. Showing the last trip data.','Trip could not be refreshed. Showing the last data.','Refreshing trip data…','Retry'],fr:['Hors connexion. Dernières données du trajet.','Impossible d’actualiser le trajet. Dernières données affichées.','Actualisation du trajet…','Réessayer'],ar:['لا يوجد اتصال. تظهر آخر بيانات الرحلة.','تعذر تحديث الرحلة. تظهر آخر البيانات.','جارٍ تحديث بيانات الرحلة…','إعادة المحاولة']}
export function refreshVisibleTrip(){
 const state=store.getState(),user=userSelectors.user(state)
 if(navigator.onLine===false)return
 if(!user){if(userSelectors.tokens(state))store.dispatch(userActionCreators.initUser());return}
 store.dispatch(ordersActionCreators.refreshActiveOrders())
 if(user.u_role===EUserRoles.Driver)store.dispatch({type:ActionTypes.GET_READY_ORDERS_REQUEST})
 const detail=orderSelectors.selectedOrderId(state),selected=clientOrderSelectors.selectedOrder(state)
 for(const id of new Set([detail,selected].filter(Boolean)))store.dispatch(ordersActionCreators.refreshOrder(id!))
 if(detail)store.dispatch(orderActionCreators.getOrder(detail))
}
export default function ConnectionBar(){
 const user=useSelector(userSelectors.user),language=useSelector(configSelectors.language)
 const [online,setOnline]=useState(navigator.onLine!==false),[health,setHealth]=useState(readHealth)
 useEffect(()=>{const change=()=>setOnline(navigator.onLine!==false);window.addEventListener('online',change);window.addEventListener('offline',change);const unwatch=subscribeReadHealth(()=>setHealth(readHealth())),stop=subscribeResume(refreshVisibleTrip);return()=>{window.removeEventListener('online',change);window.removeEventListener('offline',change);unwatch();stop()}},[])
 const authWords={ru:'Не удалось восстановить вход. Сессия сохранена; повторите подключение.',en:'Sign-in could not be restored. Your session is saved; reconnect to retry.',fr:'Connexion non rétablie. La session est conservée ; réessayez.',ar:'تعذر استعادة تسجيل الدخول. الجلسة محفوظة؛ أعد الاتصال.'}
 const base=(language?.iso||'en').toLowerCase().split(/[-_]/)[0]
 const copy=words[(language?.iso||'en').toLowerCase().split(/[-_]/)[0] as keyof typeof words]||words.en
 if(!user&&!health.authRetry||online&&!health.failed&&!health.authRetry)return null
 return <aside className="ride-connection" role="status" aria-live="polite" data-online={online}><WifiOff size={18}/><span>{!user&&health.authRetry?(authWords[base as keyof typeof authWords]||authWords.en):!online?copy[0]:health.pending?copy[2]:copy[1]}</span>{online&&<button type="button" onClick={refreshVisibleTrip} disabled={health.pending}><RefreshCw size={15}/>{copy[3]}</button>}</aside>
}
