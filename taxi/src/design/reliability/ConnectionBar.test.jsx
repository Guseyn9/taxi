import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import ConnectionBar,{refreshVisibleTrip} from './ConnectionBar'
import {readHealthMiddleware,readHealth} from './readHealth'
import {EUserRoles} from '../../types/types'
let mockState, mockDispatch=jest.fn()
jest.mock('react-redux',()=>({useSelector:selector=>selector(mockState)}))
jest.mock('../../state',()=>({__esModule:true,default:{getState:()=>mockState,dispatch:action=>mockDispatch(action)}}))
jest.mock('../../state/user',()=>({userSelectors:{user:s=>s.user,tokens:s=>s.tokens},userActionCreators:{initUser:()=>({type:'user/INIT_READ'})}}))
jest.mock('../../state/config',()=>({configSelectors:{language:s=>s.language}}))
jest.mock('../../state/clientOrder',()=>({clientOrderSelectors:{selectedOrder:s=>s.selected}}))
jest.mock('../../state/order',()=>({orderSelectors:{selectedOrderId:s=>s.detail},orderActionCreators:{getOrder:id=>({type:'order/GET_ORDER_REQUEST',payload:id})}}))
jest.mock('../../state/orders',()=>({ordersActionCreators:{refreshActiveOrders:()=>({type:'orders/GET_ACTIVE_ORDERS_REQUEST'}),refreshOrder:id=>({type:'orders/GET_ORDER_REQUEST',payload:id})}}))
jest.mock('../../localization',()=>({t:(key,options)=>options?.fallback||key}))
let host,root
const dispatch=readHealthMiddleware({})(action=>action)
beforeEach(()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 mockState={user:{u_id:'client',u_role:EUserRoles.Client},language:{iso:'ru'},selected:'42',detail:'42'}
 mockDispatch.mockClear();dispatch({type:'user/LOGIN_START'});host=document.createElement('div');root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());delete global.IS_REACT_ACT_ENVIRONMENT})
test('a list refresh failure does not claim that a draft trip was lost; success removes the status',async()=>{
 dispatch({type:'orders/GET_ACTIVE_ORDERS_FAIL'})
 await act(async()=>root.render(<ConnectionBar/>))
 expect(host.textContent).toContain('Не удалось обновить')
 expect(host.textContent).not.toContain('обновить поездку')
 await act(async()=>dispatch({type:'orders/GET_ACTIVE_ORDERS_SUCCESS'}))
 expect(host.textContent).toBe('')
})
test('retry only requests reads, deduplicates a selected ID and never replays a create command',()=>{
 refreshVisibleTrip()
 expect(mockDispatch.mock.calls.map(([action])=>action.type)).toEqual(['orders/GET_ACTIVE_ORDERS_REQUEST','orders/GET_ORDER_REQUEST','order/GET_ORDER_REQUEST'])
 expect(mockDispatch.mock.calls.filter(([action])=>action.type==='orders/GET_ORDER_REQUEST')).toHaveLength(1)
 mockState.user.u_role=EUserRoles.Driver;mockDispatch.mockClear();refreshVisibleTrip()
 expect(mockDispatch.mock.calls.map(([action])=>action.type).some(type=>/CREATE|TAKE|SET_STATE/.test(type))).toBe(false)
})
test('dismissing the compact inline status preserves failure and does not reopen for repeated failures in the same outage',async()=>{
 dispatch({type:'orders/GET_ACTIVE_ORDERS_FAIL'})
 await act(async()=>root.render(<ConnectionBar/>))
 expect(host.querySelector('aside').dataset.placement).toBe('inline')
 const dismiss=host.querySelector('button[aria-label="Скрыть сообщение"]')
 await act(async()=>dismiss.click())
 expect(host.textContent).toBe('')
 expect(readHealth().failed).toBe(true)
 await act(async()=>dispatch({type:'orders/GET_ACTIVE_ORDERS_FAIL'}))
 expect(host.textContent).toBe('')
 await act(async()=>dispatch({type:'orders/GET_ACTIVE_ORDERS_SUCCESS'}))
 await act(async()=>dispatch({type:'orders/GET_ACTIVE_ORDERS_FAIL'}))
 expect(host.textContent).toContain('Не удалось обновить')
})
test('the global auth fallback does not duplicate a logged-in layout status',async()=>{
 dispatch({type:'orders/GET_ACTIVE_ORDERS_FAIL'})
 await act(async()=>root.render(<ConnectionBar authOnly/>))
 expect(host.textContent).toBe('')
})
