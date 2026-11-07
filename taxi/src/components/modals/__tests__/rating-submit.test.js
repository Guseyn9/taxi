import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { RatingModal } from '../RatingModal'
import { backendGateway } from '../../../platform/adapters/LegacyBackendGateway'
import { ordersSelectors } from '../../../state/orders'
import { calculateFinalPrice, calculateRawFinalPriceValue, calculateFinalPriceFormula, getOrderDriveStartedAt } from '../../../tools/order'

jest.mock('react-redux', () => ({ connect: () => Component => Component }))
jest.mock('../../../tools/order', () => ({ calculateFinalPrice: jest.fn(() => '25'), calculateRawFinalPriceValue: jest.fn(() => 25), calculateFinalPriceFormula: jest.fn(() => '25'), getOrderDriveStartedAt: jest.fn(() => '2026-11-04T10:00:00Z') }))
jest.mock('../../../tools/hooks', () => ({ useSimpleSelector: selector => selector({}) }))
jest.mock('../../../siteConstants', () => ({ CURRENCY: { NAME: 'GHS', SIGN: 'GHS' } }))
jest.mock('../../../platform/adapters/LegacyBackendGateway', () => ({ backendGateway: { setOrderRating: jest.fn() } }))
jest.mock('../../../state/modals', () => ({ modalsActionCreators: { setRatingModal: jest.fn() }, modalsSelectors: {} }))
jest.mock('../../../state/clientOrder', () => ({ clientOrderSelectors: {} }))
jest.mock('../../../state/orders', () => ({ ordersSelectors: { order: jest.fn() } }))
jest.mock('../../../state/order', () => ({ orderSelectors: {} }))
jest.mock('../../../state/config', () => ({ configSelectors: {} }))
jest.mock('../../../tools/flowLog', () => ({ writeFlowEvent: jest.fn() }))
jest.mock('../../../localization', () => ({ t: value => value, TRANSLATION: { ERROR: 'Could not send rating', LOADING: 'Sending', RATE: 'Rate', YOUR_RATING: 'Your rating', RATING_HEADER: 'Rate ride', ONLY_ONE_TIME: 'Only once' } }))
jest.mock('../Overlay', () => ({ __esModule: true, default: ({ isOpen, children }) => isOpen ? <div role="dialog">{children}</div> : null }))
jest.mock('../../OrderId', () => ({ __esModule: true, default: () => null }))
jest.mock('../../Button', () => ({ __esModule: true, default: ({ text, ...props }) => <button {...props}>{text}</button> }))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function withModal(run) {
  global.IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host), close = jest.fn()
  const render = async props => act(async() => root.render(<RatingModal isOpen setRatingModal={close} language={{ iso: 'en' }} {...props} />))
  try { await run({ host, render, close }) }
  finally { act(() => root.unmount()); host.remove(); jest.clearAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT }
}

const completed = b_id => ({ b_id, b_completed: '2026-11-04T10:15:00Z', b_options: { pricingModel: { options: {} } } })

it('uses the explicit review order for the fare even when another order is open', async() => withModal(async({ render }) => {
  const other = completed('A'), target = completed('B')
  ordersSelectors.order.mockReturnValue(target)
  await render({ orderID: 'B', detailedOrder: other })
  expect(getOrderDriveStartedAt).toHaveBeenLastCalledWith(target)
  expect(calculateFinalPrice).toHaveBeenLastCalledWith(expect.objectContaining({ b_id: 'B' }))
}))

it('updates the fare when the explicit review order changes behind the same detail screen', async() => withModal(async({ render }) => {
  ordersSelectors.order.mockImplementation((state, id) => completed(id))
  const other = completed('A')
  await render({ orderID: 'B', detailedOrder: other })
  await render({ orderID: 'C', detailedOrder: other })
  expect(getOrderDriveStartedAt).toHaveBeenLastCalledWith(expect.objectContaining({ b_id: 'C' }))
}))

it('preserves chosen stars when data for the same order arrives later', async() => withModal(async({ host, render }) => {
  ordersSelectors.order.mockReturnValue(undefined)
  await render({ orderID: 'B' })
  act(() => host.querySelector('input[value="4"]').click())
  ordersSelectors.order.mockReturnValue(completed('B'))
  await render({ orderID: 'B' })
  expect(host.querySelector('input[value="4"]').checked).toBe(true)
}))

it('disables submission if the review has no order identity', async() => withModal(async({ host, render }) => {
  ordersSelectors.order.mockReturnValue(undefined)
  await render({})
  act(() => host.querySelector('input[value="4"]').click())
  expect(host.querySelector('button[type="submit"]').disabled).toBe(true)
}))

it('uses matching detailed data when the completed order is absent from the list', async() => withModal(async({ render }) => {
  ordersSelectors.order.mockReturnValue(undefined)
  const target = completed('B')
  await render({ orderID: 'B', detailedOrder: target })
  expect(getOrderDriveStartedAt).toHaveBeenLastCalledWith(target)
}))

it('resets stars on a different order and ignores the previous submission acknowledgement', async() => withModal(async({ host, render, close }) => {
  ordersSelectors.order.mockReturnValue(undefined)
  const request = deferred()
  backendGateway.setOrderRating.mockReturnValueOnce(request.promise)
  await render({ orderID: 'B' })
  act(() => host.querySelector('input[value="4"]').click())
  act(() => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await render({ orderID: 'C' })
  expect(host.querySelectorAll('input:checked')).toHaveLength(0)
  act(() => host.querySelector('input[value="5"]').click())
  await act(async() => { request.resolve(); await request.promise })
  expect(close).not.toHaveBeenCalled()
  expect(host.querySelector('input[value="5"]').checked).toBe(true)
  expect(host.querySelector('button[type="submit"]').disabled).toBe(false)
}))

it('keeps a rejected review open, preserves its rating, and sends a retried submission once until acknowledgement', async() => {
  global.IS_REACT_ACT_ENVIRONMENT = true
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host)
  const close = jest.fn(), first = deferred(), retry = deferred()
  backendGateway.setOrderRating.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
  const submit = () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  try {
    await act(async() => root.render(<RatingModal isOpen orderID="18429" setRatingModal={close} language={{ iso: 'en' }} />))
    act(() => host.querySelector('input[value="4"]').click())
    act(() => { submit(); submit() })
    expect(backendGateway.setOrderRating).toHaveBeenCalledTimes(1)
    expect(backendGateway.setOrderRating).toHaveBeenCalledWith('18429', 4)
    expect(host.querySelector('button[type="submit"]').disabled).toBe(true)
    expect(close).not.toHaveBeenCalled()
    await act(async() => { first.reject(new Error('Network failure')); await Promise.resolve() })
    expect(host.querySelector('[role="alert"]').textContent).toBe('Could not send rating')
    expect(host.querySelector('input[value="4"]').checked).toBe(true)
    expect(host.querySelector('button[type="submit"]').disabled).toBe(false)
    expect(close).not.toHaveBeenCalled()
    act(() => { submit(); submit() })
    expect(backendGateway.setOrderRating).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(close).not.toHaveBeenCalled()
    await act(async() => { retry.resolve(); await retry.promise })
    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith({ isOpen: false })
  } finally {
    act(() => root.unmount()); host.remove(); consoleError.mockRestore(); jest.clearAllMocks()
    delete global.IS_REACT_ACT_ENVIRONMENT
  }
})

it.each(['MAD','USD'])('uses the review order currency %s even when the tenant is GHS',async currency=>withModal(async({host,render})=>{
 ordersSelectors.order.mockReturnValue({...completed('B'),b_currency:currency})
 await render({orderID:'B'})
 const price=host.querySelector('.final-price').textContent
 expect(price).toContain(currency);expect(price).not.toContain('GHS')
}))
it('explains final truncation while retaining fractional calculation parameters',async()=>withModal(async({host,render})=>{
 calculateFinalPrice.mockReturnValue('7');calculateRawFinalPriceValue.mockReturnValue(7.25);calculateFinalPriceFormula.mockReturnValue('2.9 * 2.5')
 ordersSelectors.order.mockReturnValue({...completed('B'),b_currency:'MAD'})
 await render({orderID:'B'})
 expect(host.querySelector('.final-price').textContent).toContain('MAD')
 expect(host.querySelectorAll('.final-price')[1].textContent).toContain('2.9 * 2.5')
 expect(host.querySelector('.fare-rounding-note')).not.toBeNull()
}))
