import React, {act} from 'react'
import {createRoot, Root} from 'react-dom/client'
import {HelmetProvider} from 'react-helmet-async'
import PassengerPhoneField, {PASSENGER_SAVED_PHONE_KEY} from './PassengerPhoneField'
jest.mock('react-redux', () => ({connect: () => (component: unknown) => component}))
jest.mock('../../localization', () => ({t: (key: string, options?: {fallback?: string}) => options?.fallback || key,
  TRANSLATION: {PHONE:'Phone', SAVE:'Save', REQUIRED_FIELD:'Required', PHONE_PATTERN_ERROR:'Invalid phone'}}))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  ;(global as any).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); jest.restoreAllMocks(); delete (global as any).IS_REACT_ACT_ENVIRONMENT})
const render = (phone: number | null, profilePhone?: string) => act(async () => root.render(
  <HelmetProvider><PassengerPhoneField phone={phone} profilePhone={profilePhone} iso="ru" onChange={() => {}}/></HelmetProvider>))
const button = () => host.querySelector<HTMLButtonElement>('.passenger-voting-form__phone-save-button')!
it('save is disabled for empty and invalid numbers; only valid changed values persist', async () => {
  await render(null); expect(button().disabled).toBe(true)
  await render(233555); expect(button().disabled).toBe(true)
  await render(NaN); expect(button().disabled).toBe(true)
  await render(Infinity); expect(button().disabled).toBe(true)
  await render(233555555555.5); expect(button().disabled).toBe(true)
  await render(233555555555); expect(button().disabled).toBe(false)
  await act(async () => button().click())
  expect(localStorage.getItem(PASSENGER_SAVED_PHONE_KEY)).toBe('233555555555'); expect(button().disabled).toBe(true)
  await render(233555555556); expect(button().disabled).toBe(false)
  await render(233555555555); expect(button().disabled).toBe(true)
})
it('saved and profile numbers do not ask for another save', async () => {
  localStorage.setItem(PASSENGER_SAVED_PHONE_KEY, '233555555555')
  await render(233555555555); expect(button().disabled).toBe(true)
})
it('a profile number starts with inactive Save without writing local storage', async () => {
  await render(233555555555, '233555555555'); expect(button().disabled).toBe(true)
  expect(localStorage.getItem(PASSENGER_SAVED_PHONE_KEY)).toBeNull()
})
it('storage refusal is visible, preserves the value and allows a deliberate retry', async () => {
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {throw new Error('quota')})
  await render(233555555555); await act(async () => button().click())
  expect(host.textContent).toContain('Не удалось сохранить телефон'); expect(button().disabled).toBe(false)
  expect(host.querySelector<HTMLInputElement>('[data-testid="passenger-order-phone"]')!.value.replace(/\D/g, '')).toBe('233555555555')
  write.mockRestore(); await act(async () => button().click()); expect(button().disabled).toBe(true)
})
