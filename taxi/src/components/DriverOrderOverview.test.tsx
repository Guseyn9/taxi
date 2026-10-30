import { driverOrderStatusIndex } from './DriverOrderOverview'
import DriverOrderOverview from './DriverOrderOverview'
import React, {act} from 'react'
import {createRoot, Root} from 'react-dom/client'
import { EBookingDriverState, EBookingStates, IOrder, IUser } from '../types/types'

jest.mock('../siteConstants', () => ({ __esModule: true, default: { CAR_CLASSES: {} }, CURRENCY: { NAME: 'MAD' } }))
jest.mock('../tools/utils', () => ({ getPayment: (order:any) => ({ value: order.b_price_estimate || 0 }) }))
jest.mock('../localization', () => ({ t: (key: string) => key, TRANSLATION: {} }))
jest.mock('../tools/driverOffer', () => ({
  isOfferOrder: (order: any) => order.testMode === 'offer',
  isVotingOrder: (order: any) => order.testMode === 'voting',
}))

const user = { u_id: 'driver-1' } as IUser
function order(overrides: Partial<IOrder> = {}) {
  return { b_id: '1001', drivers: [], ...overrides } as IOrder
}

it('shows terminal booking status before the driver’s previous trip status', () => {
  const drivers = [{ u_id: user.u_id, c_state: EBookingDriverState.Started }] as IOrder['drivers']
  expect(driverOrderStatusIndex(order({ b_state: EBookingStates.Canceled, drivers }), user)).toBe(8)
  expect(driverOrderStatusIndex(order({ b_state: EBookingStates.Completed, drivers }), user)).toBe(7)
})

it('only uses the signed-in driver’s assignment status', () => {
  const drivers = [{ u_id: 'other-driver', c_state: EBookingDriverState.Started }] as IOrder['drivers']
  expect(driverOrderStatusIndex(order({ drivers }), user)).toBe(0)
  drivers![0].u_id = user.u_id
  expect(driverOrderStatusIndex(order({ drivers }), user)).toBe(6)
})

it('distinguishes an unanswered fare offer from a driver awaiting the passenger decision', () => {
  const offer = { ...order(), testMode: 'offer' } as IOrder
  expect(driverOrderStatusIndex(offer, user)).toBe(2)
  offer.drivers = [{ u_id: user.u_id, c_state: EBookingDriverState.Considering }] as IOrder['drivers']
  expect(driverOrderStatusIndex(offer, user)).toBe(3)
})

let host: HTMLDivElement, root: Root
beforeEach(() => {
 (global as any).IS_REACT_ACT_ENVIRONMENT = true
 host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete (global as any).IS_REACT_ACT_ENVIRONMENT })

it('keeps different modes, price and profit visible together after both drivers have responded',async()=>{
 const drivers=[{u_id:user.u_id,c_state:EBookingDriverState.Considering}] as IOrder['drivers']
 const first={...order({drivers,b_price_estimate:299,profit:12.01,profitPerEmptyKm:12.91}),testMode:'offer'} as IOrder
 const second={...order({b_id:'1002',drivers,b_price_estimate:272,profit:12.90,profitPerEmptyKm:10.08}),testMode:'voting'} as IOrder
 await act(async()=>root.render(<><DriverOrderOverview order={first} user={user} iso="ru"/><DriverOrderOverview order={second} user={user} iso="ru"/></>))
 expect([...host.querySelectorAll('.driver-order-overview__mode')].map(e=>e.textContent)).toEqual(['Своя цена','Голосование'])
 expect(host.querySelectorAll('.driver-order-overview__profit').length).toBe(2)
 expect(host.querySelector('.driver-order-overview__price')!.textContent).toContain('299')
 expect(host.querySelector('.driver-order-overview__profit')!.textContent).toMatch(/12,01/)
 expect(host.querySelector('.driver-order-overview__profit')!.textContent).toMatch(/12,91/)
})
it('distinguishes a loss, zero profit and unavailable calculations',async()=>{
 for(const value of [-2,0,undefined]){
  await act(async()=>root.render(<DriverOrderOverview order={order({profit:value})} user={user} iso="en"/>))
  expect(host.querySelector('dl')!.getAttribute('data-loss')).toBe(value===-2?'true':'false')
  expect(host.textContent).toContain(value===undefined?'Calculation unavailable':value===-2?'Possible loss':'0')
 }
})
