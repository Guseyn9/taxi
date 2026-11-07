import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import PassengerHistory from './index'
import { backendGateway } from '../../platform/adapters/LegacyBackendGateway'
import { EBookingStates, EOrderTypes } from '../../types/types'
jest.mock('../../platform/adapters/LegacyBackendGateway', () => ({ backendGateway: { getOrders: jest.fn() } }))
jest.mock('../modals/Overlay', () => ({ children }) => <div role="dialog">{children}</div>)
let root, container
beforeEach(() => { jest.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })
const trip = (id, owner, state = EBookingStates.Completed) => ({ b_id: id, u_id: owner, b_state: state, b_start_address: `Pickup ${id}`, b_destination_address: 'Agadir' })
const show = (owner = 'A') => act(async () => root.render(<PassengerHistory owner={owner} iso="en" onClose={() => {}} />))
test('uses the existing archive contract and displays only this passenger’s past trips', async () => {
  backendGateway.getOrders.mockResolvedValue({ data: { booking: [trip('1', 'A'), trip('2', 'B'), trip('3', 'A', EBookingStates.Processing)] } })
  await show()
  expect(backendGateway.getOrders).toHaveBeenCalledWith(EOrderTypes.History)
  expect(container.textContent).toContain('Pickup 1')
  expect(container.textContent).not.toMatch(/Pickup 2|Pickup 3/)
})
test('shows a failure with retry and then a real empty state', async () => {
  backendGateway.getOrders.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({ data: { booking: [] } })
  await show(); expect(container.querySelector('[role="alert"]').textContent).toContain('Could not load')
  await act(async () => container.querySelector('button').click())
  expect(container.textContent).toContain('No past trips yet')
})
test('an old account response cannot refill the new account’s dialog', async () => {
  let old
  backendGateway.getOrders.mockImplementationOnce(() => new Promise(resolve => { old = resolve })).mockResolvedValueOnce({ data: { booking: [trip('B-trip', 'B')] } })
  await show('A'); await show('B')
  await act(async () => old({ data: { booking: [trip('A-trip', 'A')] } }))
  expect(container.textContent).toContain('Pickup B-trip')
  expect(container.textContent).not.toContain('A-trip')
})
