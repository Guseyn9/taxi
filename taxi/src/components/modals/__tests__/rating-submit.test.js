import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { RatingModal } from '../RatingModal'
import { backendGateway } from '../../../platform/adapters/LegacyBackendGateway'

jest.mock('react-redux', () => ({ connect: () => Component => Component }))
jest.mock('../../../tools/order', () => ({ calculateFinalPrice: jest.fn(), calculateFinalPriceFormula: jest.fn(), getOrderDriveStartedAt: () => null }))
jest.mock('../../../tools/hooks', () => ({ useSimpleSelector: () => undefined }))
jest.mock('../../../siteConstants', () => ({ CURRENCY: { SIGN: 'GHS' } }))
jest.mock('../../../platform/adapters/LegacyBackendGateway', () => ({ backendGateway: { setOrderRating: jest.fn() } }))
jest.mock('../../../state/modals', () => ({ modalsActionCreators: { setRatingModal: jest.fn() }, modalsSelectors: {} }))
jest.mock('../../../state/clientOrder', () => ({ clientOrderSelectors: {} }))
jest.mock('../../../state/orders', () => ({ ordersSelectors: {} }))
jest.mock('../../../state/order', () => ({ orderSelectors: {} }))
jest.mock('../../../state/config', () => ({ configSelectors: {} }))
jest.mock('../../../tools/flowLog', () => ({ writeFlowEvent: jest.fn() }))
jest.mock('../../../localization', () => ({ t: value => value, TRANSLATION: { ERROR: 'Could not send rating', LOADING: 'Sending', RATE: 'Rate', YOUR_RATING: 'Your rating', RATING_HEADER: 'Rate ride', ONLY_ONE_TIME: 'Only once' } }))
jest.mock('../Overlay', () => ({ __esModule: true, default: ({ isOpen, children }) => isOpen ? <div role="dialog">{children}</div> : null }))
jest.mock('../../OrderId', () => ({ __esModule: true, default: () => null }))
jest.mock('../../Button', () => ({ __esModule: true, default: ({ text, ...props }) => <button {...props}>{text}</button> }))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

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
    act(() => root.unmount()); host.remove(); consoleError.mockRestore(); jest.clearAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT
  }
})
