import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { CancelOrderModal } from '../CancelModal'
import { cancel } from '../../../state/orders/actionCreators'
import * as API from '../../../API'
jest.mock('react-redux', () => ({ connect: () => C => C }))
jest.mock('../../../state/modals', () => ({ modalsActionCreators: {}, modalsSelectors: {} }))
jest.mock('../../../state/orders', () => ({ ordersActionCreators: {}, ordersSelectors: {} }))
jest.mock('../../../state/clientOrder', () => ({ clientOrderActionCreators: {}, clientOrderSelectors: {} }))
jest.mock('../../../siteConstants', () => ({ __esModule: true, default: { CANCEL_ORDER_REASONS: [{ id: '0', label: 'Waited too long' }] } }))
jest.mock('../../../localization', () => ({ t: value => value, TRANSLATION: { CANCEL_ORDER: 'Cancel', CANCEL: 'Back', ERROR: 'Error', LOADING: 'Loading' } }))
jest.mock('../../../tools/order', () => ({ candidateMode: () => false }))
jest.mock('../../../state/orders/selectors', () => ({ order: () => null }))
jest.mock('../../../API', () => ({ cancelDrive: jest.fn() }))
jest.mock('../Overlay', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }))
jest.mock('../../OrderId', () => ({ __esModule: true, default: () => null }))
jest.mock('../../Button', () => ({ __esModule: true, default: ({ text, intent, ...props }) => <button {...props}>{text}</button> }))

test.each(['200', '404'])('retains cancellation and selected order after a resolved business error code=%s', async code => {
  API.cancelDrive.mockResolvedValue({ code, status: 'error', message: 'wrong booking state' })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const close = jest.fn(), selection = jest.fn(), message = jest.fn(), actions = []
  try {
    await act(async () => root.render(<CancelOrderModal selectedOrder="audit-order" isOpen setCancelModal={close} setMessageModal={message} setVoteModal={jest.fn()} setDriverModal={jest.fn()} setOnTheWayModal={jest.fn()} setSelectedOrder={selection} cancelOrder={(...args) => cancel(...args)(action => actions.push(action))} refreshActiveOrders={jest.fn()} />))
    await act(async () => host.querySelector('[data-testid="passenger-order-cancel-confirm"]').click())
    expect(API.cancelDrive).toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(selection).not.toHaveBeenCalled()
    expect(message).toHaveBeenCalledWith(expect.objectContaining({isOpen:true}))
    expect(actions.some(a=>a.type.endsWith('GET_ORDER_REQUEST'))).toBe(true)
  } finally { act(() => root.unmount()); host.remove() }
})

test('an obsolete cancellation failure cannot open an error for a different session',async()=>{
 const {advanceSessionGeneration}=require('../../../security/sessionLifecycle')
 let reject;API.cancelDrive.mockImplementation(()=>new Promise((_,no)=>{reject=no}))
 const host=document.createElement('div'),root=createRoot(host),message=jest.fn(),close=jest.fn();document.body.append(host)
 try {
  await act(async()=>root.render(<CancelOrderModal selectedOrder="old" isOpen setCancelModal={close} setMessageModal={message} setVoteModal={jest.fn()} setDriverModal={jest.fn()} setOnTheWayModal={jest.fn()} setSelectedOrder={jest.fn()} cancelOrder={(...args)=>cancel(...args)(()=>{})} refreshActiveOrders={jest.fn()} />))
  await act(async()=>host.querySelector('[data-testid="passenger-order-cancel-confirm"]').click())
  advanceSessionGeneration()
  await act(async()=>{reject(new Error('obsolete'));await Promise.resolve()})
  expect(message).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled()
 } finally {act(()=>root.unmount());host.remove()}
})
