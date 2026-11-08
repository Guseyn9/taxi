import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import useAddressSearch from './useAddressSearch'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let host, root, current
function Probe(props) { current = useAddressSearch(props); return null }
const render = props => act(() => root.render(<Probe {...props} />))
const advance = milliseconds => act(() => jest.advanceTimersByTime(milliseconds))
const resolveRequest = async(request, results) => { await act(async() => { request.resolve(results); await request.promise }) }
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true
  jest.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  if (root) act(() => root.unmount())
  host.remove()
  jest.useRealTimers()
  delete global.IS_REACT_ACT_ENVIRONMENT
})

it('debounces queries and ignores stale results after the query or context changes', async() => {
  const old = deferred(), newer = deferred(), relocated = deferred()
  const search = jest.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise).mockReturnValueOnce(relocated.promise)
  render({ query: 'Avenue Hassan', contextKey: 'rabat', search })
  advance(349); expect(search).not.toHaveBeenCalled()
  advance(1); expect(current.status).toBe('loading')
  render({ query: 'Avenue Hassan II', contextKey: 'rabat', search })
  advance(350)
  render({ query: 'Avenue Hassan II', contextKey: 'casablanca', search })
  advance(350)
  const result = [{ description: 'Current Casablanca result' }]
  await resolveRequest(relocated, result)
  await resolveRequest(old, [{ description: 'Obsolete query result' }])
  await resolveRequest(newer, [{ description: 'Obsolete city result' }])
  expect(current.status).toBe('ready')
  expect(current.suggestions).toEqual(result)
})

it('exits loading after ten seconds and retries without accepting a timed-out response', async() => {
  const hung = deferred(), retry = deferred()
  const search = jest.fn().mockReturnValueOnce(hung.promise).mockReturnValueOnce(retry.promise)
  render({ query: 'Avenue Hassan II', contextKey: 'rabat', search })
  advance(350); expect(current.status).toBe('loading')
  advance(9999); expect(current.status).toBe('loading')
  advance(1); expect(current.status).toBe('error')
  act(() => current.retry()); advance(350)
  expect(search).toHaveBeenCalledTimes(2)
  await resolveRequest(hung, [{ description: 'Too late' }])
  expect(current.status).toBe('loading')
  const results = [{ description: 'Recovered result' }]
  await resolveRequest(retry, results)
  expect(current.suggestions).toEqual(results)
  expect(current.status).toBe('ready')
})

it('cleans both debounce and timeout timers and ignores outstanding requests on unmount', async() => {
  const request = deferred()
  const search = jest.fn(() => request.promise)
  render({ query: 'Rabat', contextKey: 'morocco', search })
  act(() => root.unmount()); root = null
  advance(350)
  expect(search).not.toHaveBeenCalled()
  root = createRoot(host)
  render({ query: 'Rabat', contextKey: 'morocco', search })
  advance(350)
  expect(jest.getTimerCount()).toBe(1)
  act(() => root.unmount()); root = null
  expect(jest.getTimerCount()).toBe(0)
  const lastState = current
  await resolveRequest(request, [{ description: 'Unmounted result' }])
  advance(10000)
  expect(current).toBe(lastState)
  expect(jest.getTimerCount()).toBe(0)
})

it('clears results for an empty query and distinguishes empty results from failures', async() => {
  const empty = deferred(), fail = deferred()
  const search = jest.fn().mockReturnValueOnce(empty.promise).mockReturnValueOnce(fail.promise)
  render({ query: 'Missing place', contextKey: 'rabat', search }); advance(350)
  await resolveRequest(empty, [])
  expect(current.status).toBe('empty')
  act(() => current.retry()); advance(350)
  await act(async() => { fail.reject(new Error('Network unavailable')); await Promise.resolve() })
  expect(current.status).toBe('error')
  render({ query: '  ', contextKey: 'rabat', search })
  expect(current).toMatchObject({ status: 'idle', suggestions: [] })
  advance(10000)
  expect(search).toHaveBeenCalledTimes(2)
})

it('does not search or retry below three characters, and clears earlier suggestions immediately', async() => {
  const result = deferred()
  const search = jest.fn(() => result.promise)
  for (const query of ['', 'A', 'Ag', '  Ag  ']) {
    render({query,contextKey:'agadir:pickup',search})
    act(() => current.retry()); advance(1000)
    expect(current).toMatchObject({status:'idle',suggestions:[]})
  }
  expect(search).not.toHaveBeenCalled()
  render({query:'Aga',contextKey:'agadir:pickup',search}); advance(350)
  await resolveRequest(result,[{description:'Agadir'}])
  expect(current.status).toBe('ready')
  render({query:'Ag',contextKey:'agadir:pickup',search})
  expect(current).toMatchObject({status:'idle',suggestions:[]})
  advance(1000); expect(search).toHaveBeenCalledTimes(1)
})
