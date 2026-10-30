import React from 'react'
import { UserRound } from 'lucide-react'
import ClientInfo from './ClientInfo'
import { EBookingStates, IOrder, IUser } from '../../types/types'

jest.mock('../../localization', () => ({
  t: (key: string) => key,
  TRANSLATION: { PASSENGER: 'Passenger', FINISHED: 'Completed', CANCELED: 'Cancelled', BOOKING_DRIVER_STATES: {} },
}))

function inspect(props: React.ComponentProps<typeof ClientInfo>) {
  const nodes: any[] = []
  const walk = (value: any) => {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (value == null || typeof value === 'boolean') return
    nodes.push(value)
    if (React.isValidElement(value)) walk((value.props as any).children)
  }
  walk(ClientInfo(props))
  return { nodes, text: nodes.filter(node => typeof node === 'string').join(' ') }
}

it('shows a neutral passenger identity and completed booking status without fabricated photos or stars', () => {
  const result = inspect({ order: { b_state: EBookingStates.Completed } as IOrder, client: null, user: null })
  expect(result.text).toContain('Passenger')
  expect(result.text).toContain('Completed')
  expect(result.nodes.some(node => node?.type === UserRound)).toBe(true)
  expect(result.nodes.some(node => node?.type === 'img')).toBe(false)
  expect(result.text).not.toContain('undefined')
})

it('shows only the actual name parts available', () => {
  const result = inspect({ order: {} as IOrder, client: { u_name: 'Ada' } as IUser, user: null })
  expect(result.text).toContain('Ada')
  expect(result.text).not.toContain('undefined')
  expect(result.nodes.some(node => node?.type === 'img')).toBe(false)
})
