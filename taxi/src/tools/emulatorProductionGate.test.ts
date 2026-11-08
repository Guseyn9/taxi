import { configureEmulatorTestRuntime } from '../components/DriverEmulatorPanel/testRuntime'
import { BROWSER_EMULATOR_STATE_KEY, EXTERNAL_EMULATOR_FLAG_KEY, getBrowserEmulatorState, isAnyBrowserEmulatorModeRunning, isExternalEmulatorEnabled } from './emulatorMode'
afterEach(() => { configureEmulatorTestRuntime(null);localStorage.clear();window.history.replaceState(null,'','/') })
it.each(['driverEmulator','extEmulator'])('URL alias %s and old localStorage cannot enable server emulation without an isolated runtime', (key:string) => {
  configureEmulatorTestRuntime(null)
  window.history.replaceState(null,'',`/?${key}=1`)
  localStorage.setItem(EXTERNAL_EMULATOR_FLAG_KEY,'1')
  localStorage.setItem(BROWSER_EMULATOR_STATE_KEY,JSON.stringify({drivers:{running:true},clients:{running:true}}))
  expect(isExternalEmulatorEnabled()).toBe(false)
  expect(isAnyBrowserEmulatorModeRunning()).toBe(false)
})
it('preserves operator-configured local workflows and revokes persisted flags immediately with that runtime', () => {
  configureEmulatorTestRuntime({apiUrl:'http://localhost:57100/api',drivers:[{name:'disposable',login:'test@example.invalid',password:'test-only',type:'email'}],clients:[]})
  localStorage.setItem(EXTERNAL_EMULATOR_FLAG_KEY,'1')
  localStorage.setItem(BROWSER_EMULATOR_STATE_KEY,JSON.stringify({drivers:{running:true},clients:{running:true}}))
  expect(isExternalEmulatorEnabled()).toBe(true)
  expect(getBrowserEmulatorState().drivers?.running).toBe(true)
  expect(getBrowserEmulatorState().clients).toBeUndefined()
  configureEmulatorTestRuntime(null)
  expect(isExternalEmulatorEnabled()).toBe(false)
  expect(isAnyBrowserEmulatorModeRunning()).toBe(false)
})
