import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import Config from '../../config'
import { BROWSER_EMULATOR_STATE_KEY } from '../../tools/emulatorMode'
import DriverEmulatorPanel from './index'
import { configureEmulatorTestRuntime, emulatorTestReady } from './testRuntime'

const mockCheck = jest.fn()
const mockStart = jest.fn()
const mockStop = jest.fn()

jest.mock('../../config', () => ({__esModule: true, default: {API_URL: ''}}))
jest.mock('../../localization', () => ({t: key => key}))
jest.mock('./availabilityCopy', () => ({
  emulatorAvailabilityCopy: () => ({
    required: 'Configure local test accounts',
    demo: 'Open demo',
    loadAccounts: 'Load test accounts JSON',
    invalidAccounts: 'Check the account file',
  }),
}))
jest.mock('./browserEmulator', () => {
  class Emulator {
    running = false
    snapshot = () => ({running: this.running, logs: []})
    check = () => mockCheck()
    start = () => { mockStart(); this.running = true }
    stop = () => { mockStop(); this.running = false }
  }
  return {BrowserDriverEmulator: Emulator, BrowserClientOrderEmulator: Emulator}
})

const fileFor = mode => JSON.stringify({
  [mode]: [{name: 'Disposable QA', login: 'qa@example.invalid', password: 'stand-only', type: 'e-mail'}],
})

let host, root
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  Config.API_URL = 'http://127.0.0.1:57171/taxi/c/local/api/v1'
  jest.clearAllMocks()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  configureEmulatorTestRuntime(null)
  localStorage.clear()
})

const button = key => [...host.querySelectorAll('button')].find(node => node.textContent === key)
const render = mode => act(() => root.render(<DriverEmulatorPanel isOpen mode={mode} onClose={() => {}} />))
const upload = async source => {
  const input = host.querySelector('input[type="file"]')
  const file = {size: source.length, text: async () => source}
  Object.defineProperty(input, 'files', {value: [file], configurable: true})
  await act(async () => input.dispatchEvent(new Event('change', {bubbles: true})))
}

it.each(['drivers', 'clients'])('loads local accounts from the %s panel and only starts on explicit click', async mode => {
  localStorage.setItem(BROWSER_EMULATOR_STATE_KEY, JSON.stringify({[mode]: {running: true}}))
  render(mode)
  expect(button('emulator_start').disabled).toBe(true)

  await upload(fileFor(mode))

  expect(emulatorTestReady(mode)).toBe(true)
  expect(button('emulator_start').disabled).toBe(false)
  expect(button('emulator_check').disabled).toBe(false)
  expect(button('emulator_stop').disabled).toBe(true)
  expect(mockStart).not.toHaveBeenCalled()
  expect(mockCheck).not.toHaveBeenCalled()
  expect(localStorage.getItem(BROWSER_EMULATOR_STATE_KEY)).toBeNull()
  expect(JSON.stringify(localStorage)).not.toContain('stand-only')

  await act(async () => button('emulator_check').click())
  await act(async () => button('emulator_start').click())
  expect(button('emulator_stop').disabled).toBe(false)
  await act(async () => button('emulator_stop').click())

  expect(mockCheck).toHaveBeenCalledTimes(1)
  expect(mockStart).toHaveBeenCalledTimes(1)
  expect(mockStop).toHaveBeenCalledTimes(1)
  expect(button('emulator_start').disabled).toBe(false)
})

it('shows a local validation error and allows the operator to choose a corrected file', async () => {
  render('clients')
  await upload(fileFor('drivers'))
  expect(host.querySelector('[role="alert"]').textContent).toBe('Check the account file')
  expect(button('emulator_start').disabled).toBe(true)

  await upload(fileFor('clients'))
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(button('emulator_start').disabled).toBe(false)
})

it('offers no account upload or emulator actions for a shared Core URL', () => {
  Config.API_URL = 'https://example.invalid/taxi/c/test/api/v1'
  render('clients')
  expect(host.querySelector('input[type="file"]')).toBeNull()
  expect(button('emulator_check').disabled).toBe(true)
  expect(button('emulator_start').disabled).toBe(true)
})
