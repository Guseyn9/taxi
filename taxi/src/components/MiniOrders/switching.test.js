import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
jest.mock('react-redux', () => ({connect: () => Component => Component}))
jest.mock('../../state/user', () => ({userSelectors:{}}))
jest.mock('../../state/orders', () => ({ordersSelectors: {}, ordersActionCreators: {}}))
jest.mock('../../state/clientOrder', () => ({clientOrderSelectors: {}, clientOrderActionCreators: {}}))
jest.mock('../../state/modals', () => ({modalsActionCreators: {}}))
jest.mock('../../state/config', () => ({configSelectors: {}}))
jest.mock('../../localization', () => ({t: key => key, TRANSLATION: {CAR_CLASSES: {}, BOOKING_DRIVER_STATES: {}}}))
jest.mock('../../siteConstants', () => ({__esModule: true, default: {WAITING_INTERVAL: 300}}))
jest.mock('../../tools/hooks', () => ({useReliableNow: () => 1793347200000}))
jest.mock('../../tools/utils', () => ({getOrderIcon: () => '', distanceBetweenEarthCoordinates: () => 0}))
jest.mock('../../tools/order', () => ({candidateMode: () => false}))
jest.mock('../../tools/driverOffer', () => ({
 getPassengerConfirmedChoice: () => null, getPassengerConfirmedChoiceStartedAt: () => null,
 getPassengerChoiceSearchRestartedAt: () => null, isChoiceOrder: () => false,
 isOfferOrder: () => false, isVotingOrder: () => false, isStoredSimpleOrderMode: () => true,
 isVisibleChoiceDriverState: () => true,
}))
jest.mock('../../platform/adapters/LegacyBackendGateway', () => ({backendGateway: {makeRoutePoints: jest.fn()}}))
jest.mock('../../platform/adapters/DriverMapGateway', () => ({driverMapGateway: {finish: jest.fn().mockResolvedValue({})}}))
jest.mock('../Chat/Toggler', () => ({__esModule: true, default: () => <button>Chat</button>}))
jest.mock('../CarClassBadge', () => ({__esModule: true, default: () => <span>PETIT</span>, getRequiredCarClassKind: () => 'petit'}))
import {MiniOrders} from './index'
import {EBookingDriverState} from '../../types/types'
import {driverMapGateway} from '../../platform/adapters/DriverMapGateway'
let host, root
beforeEach(() => {
 global.IS_REACT_ACT_ENVIRONMENT = true
 host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
 HTMLElement.prototype.scrollIntoView = jest.fn()
})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; jest.clearAllMocks()})
function props(overrides = {}) {
 return {activeOrders: [{b_id:'A',drivers:[]}, {b_id:'B',drivers:[]}], selectedOrder:'A', language:{iso:'ru'},
  handleOrderClick:jest.fn(), setSelectedOrder:jest.fn(), setRatingModal:jest.fn(), setMessageModal:jest.fn(),
  setSosModal:jest.fn(), refreshActiveOrders:jest.fn(), ...overrides}
}
it('selects the exact second order and exposes the current selection without losing either plaque', async () => {
 const p = props()
 await act(async () => root.render(<MiniOrders {...p}/>))
 expect(host.querySelector('nav,[role=navigation]').getAttribute('aria-label')).toBe('Активные заказы: 2')
 const buttons = host.querySelectorAll('.mini-orders__select-target')
 expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
 await act(async () => buttons[1].click())
 expect(p.handleOrderClick).toHaveBeenCalledTimes(1)
 expect(p.handleOrderClick).toHaveBeenCalledWith(p.activeOrders[1])
 await act(async () => root.render(<MiniOrders {...p} selectedOrder="B"/>))
 expect(host.querySelectorAll('.mini-orders__card').length).toBe(2)
 expect(host.querySelectorAll('.mini-orders__select-target')[1].getAttribute('aria-pressed')).toBe('true')
})
it('keeps SOS and finish independent of switching, and completes only the selected booking', async () => {
 const current={b_id:'A',drivers:[{u_id:'driver',c_state:EBookingDriverState.Started}]}
 const p=props({activeOrders:[current,{b_id:'B',drivers:[]}]})
 await act(async () => root.render(<MiniOrders {...p}/>))
 expect(host.querySelectorAll('button button').length).toBe(0)
 await act(async () => host.querySelector('.mini-orders__sos').click())
 expect(p.setSosModal).toHaveBeenCalledWith({isOpen:true,orderId:'A'})
 expect(p.handleOrderClick).not.toHaveBeenCalled()
 await act(async () => host.querySelector('.mini-orders__finish').click())
 expect(driverMapGateway.finish).toHaveBeenCalledWith('A')
 expect(p.setRatingModal).toHaveBeenCalledWith({isOpen:true,orderID:'A'})
 expect(p.handleOrderClick).not.toHaveBeenCalled()
})

it('labels an unresolved Offer without presenting it as a confirmed ordinary request',async()=>{
 const {markPendingOffer}=require('../../pilot/pendingOffer')
 markPendingOffer('u','B')
 const p=props({ownerId:'u'})
 await act(async()=>root.render(<MiniOrders {...p}/>))
 expect(host.querySelectorAll('.mini-orders__status')[1].textContent).toBe('Тип уточняется')
 expect(host.querySelectorAll('.mini-orders__mode-icon')[1].textContent).toBe('?')
 markPendingOffer('u','B',false)
})

it('keeps three simultaneous orders reachable after polling and switches by exact id',async()=>{
 const p=props({activeOrders:[{b_id:'A',drivers:[]},{b_id:'B',drivers:[]},{b_id:'C',drivers:[]}]})
 await act(async()=>root.render(<MiniOrders {...p}/>))
 await act(async()=>host.querySelectorAll('.mini-orders__select-target')[2].click())
 expect(p.handleOrderClick).toHaveBeenCalledWith(p.activeOrders[2])
 await act(async()=>root.render(<MiniOrders {...p} activeOrders={[...p.activeOrders]} selectedOrder="C"/>))
 expect(host.querySelectorAll('.mini-orders__card')).toHaveLength(3)
 expect(host.querySelectorAll('.mini-orders__select-target')[2].getAttribute('aria-pressed')).toBe('true')
})
