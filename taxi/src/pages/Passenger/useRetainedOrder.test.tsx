import React, {act} from 'react'
import {createRoot, Root} from 'react-dom/client'
import {useRetainedOrder} from './useRetainedOrder'
import {EBookingStates, IOrder} from '../../types/types'
let host: HTMLDivElement, root: Root
beforeEach(() => {jest.useFakeTimers(); (global as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); root = createRoot(host)})
afterEach(async () => {await act(async () => root.unmount()); jest.useRealTimers(); delete (global as any).IS_REACT_ACT_ENVIRONMENT})
const order = {b_id:'42',u_id:'client-1',b_start_address:'From',b_destination_address:'To',b_state:1,drivers:[]} as unknown as IOrder
function View({owner='client-1', id='42', orders, read}: {owner?: string; id?: string; orders: IOrder[] | null; read: (id: string) => Promise<IOrder>}) {
  const retained = useRetainedOrder(owner, id, orders, read)
  return <p data-terminal={retained.terminal}>{retained.order?.b_id || 'pending'}</p>
}
it('retains the known identity through list disappearance and failed detail reads; recovers without creating again', async () => {
  const read = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({...order,b_start_address:'Updated'})
  await act(async () => root.render(<View orders={[order]} read={read}/>)); expect(host.textContent).toBe('42')
  await act(async () => root.render(<View orders={[]} read={read}/>)); expect(host.textContent).toBe('42')
  await act(async () => {jest.advanceTimersByTime(5000)}); expect(host.textContent).toBe('42')
  expect(read.mock.calls).toEqual([['42'],['42']])
})
it('clears the visible trip only after an explicit terminal detail, not an empty list', async () => {
  const read = jest.fn().mockResolvedValue({...order,b_state:EBookingStates.Canceled})
  await act(async () => root.render(<View orders={[order]} read={read}/>))
  await act(async () => root.render(<View orders={[]} read={read}/>))
  expect(host.textContent).toBe('pending'); expect(host.querySelector('p')!.getAttribute('data-terminal')).toBe('true')
})
it('does not leak a snapshot or late response to another owner', async () => {
  let resolve: (value: IOrder) => void = () => {}
  const read = jest.fn(() => new Promise<IOrder>(done => {resolve = done}))
  await act(async () => root.render(<View orders={[order]} read={read}/>))
  await act(async () => root.render(<View orders={[]} read={read}/>))
  const old = resolve
  await act(async () => root.render(<View owner="client-2" id="99" orders={[]} read={read}/>))
  await act(async () => old(order)); expect(host.textContent).toBe('pending')
})
it('normalizes numeric IDs when the active list returns the submitted trip', async () => {
  const read = jest.fn()
  await act(async () => root.render(<View orders={[{...order,b_id:42} as unknown as IOrder]} read={read}/>))
  expect(host.textContent).toBe('42'); expect(read).not.toHaveBeenCalled()
})
