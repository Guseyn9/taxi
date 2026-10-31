import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import ZoneCheckNotice from './ZoneCheckNotice'
import { hasZoneCoordinates, retryZonePoint, zoneChecksReady, zoneCheckState } from './zoneCheck'
import { RideRequestActions } from '../RideRequestActions'

const point = { latitude: 30.42, longitude: -9.6, address: 'Agadir' }
const ready = { from: point, to: point, fromZoneStatus: 'ready' as const, toZoneStatus: 'ready' as const, fromPolygons: ['79'], toPolygons: ['79'] }
it('requires both successful checks, keeps empty results valid and does not reuse stale polygons', () => {
  expect(zoneChecksReady(ready)).toBe(true)
  expect(zoneChecksReady({ ...ready, fromPolygons: [], toPolygons: [] })).toBe(true)
  for (const status of ['idle', 'checking', 'error'] as const) {
    expect(zoneChecksReady({ ...ready, fromZoneStatus: status })).toBe(false)
    expect(zoneChecksReady({ ...ready, toZoneStatus: status })).toBe(false)
  }
  expect(zoneChecksReady({ ...ready, fromPolygons: null })).toBe(false)
  expect(zoneChecksReady({ ...ready, from: null })).toBe(false)
  expect(zoneCheckState(null, 'checking')).toBe('idle')
  expect(hasZoneCoordinates({ latitude: NaN, longitude: 0 })).toBe(false)
  expect(hasZoneCoordinates({ latitude: 0, longitude: 0 })).toBe(true)
})
it('retry preserves the selected coordinates and suppresses GPS and text geocoding', () => {
  const original = { ...point, isCurrent: true, resolveAddress: true }
  expect(retryZonePoint(original)).toEqual({ ...original, isCurrent: false, resolveAddress: false })
  expect(original.isCurrent).toBe(true)
})
it('announces the failed endpoint and exposes only its retry; successful check removes it', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host), retryFrom = jest.fn(), retryTo = jest.fn()
  await act(async () => root.render(<ZoneCheckNotice from="error" to="checking" iso="ru" onRetryFrom={retryFrom} onRetryTo={retryTo}/>))
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Зона подачи')
  expect(host.querySelector('[role=status]')?.textContent).toContain('Зона назначения')
  expect(host.querySelectorAll('button')).toHaveLength(1)
  await act(async () => (host.querySelector('button') as HTMLButtonElement).click())
  expect(retryFrom).toHaveBeenCalledTimes(1); expect(retryTo).not.toHaveBeenCalled()
  await act(async () => root.render(<ZoneCheckNotice from="ready" to="ready" iso="ru" onRetryFrom={retryFrom} onRetryTo={retryTo}/>))
  expect(host.textContent).toBe('')
  await act(async () => root.unmount()); host.remove(); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT
})
