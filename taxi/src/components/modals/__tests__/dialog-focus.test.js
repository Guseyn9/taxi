import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import Overlay from '../Overlay'
import { dialogTabStops } from '../dialogFocus'

jest.mock('../../../localization', () => ({ t: value => value, TRANSLATION: { CLOSE: 'Close' } }))
jest.mock('../../../siteConstants', () => ({ __esModule: true, default: { PALETTE: { primary: { main: '#7018e6', dark: '#5a12b8' } } } }))
jest.mock('react-helmet-async', () => ({ Helmet: () => null }))

let host, root, rectangles, frame, cancelFrame
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true
  jest.useFakeTimers()
  frame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => setTimeout(callback, 0))
  cancelFrame = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => clearTimeout(id))
  rectangles = jest.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  rectangles.mockRestore()
  frame.mockRestore()
  cancelFrame.mockRestore()
  jest.useRealTimers()
  delete global.IS_REACT_ACT_ENVIRONMENT
})
const render = node => act(() => { root.render(node) })
const settle = () => act(() => { jest.runOnlyPendingTimers() })
const key = (node, key, shiftKey = false) => act(() => { node.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })) })

it('cycles through actual native tab stops, excluding disabled fields and unchecked members of a radio group', () => {
  render(<Overlay isOpen onClick={() => {}}><div>
    <h2>Options</h2>
    <fieldset disabled><input id="disabled-field" /></fieldset>
    <button tabIndex={-1}>Programmatic only</button>
    <input hidden />
    <input id="radio-first" type="radio" name="mode" />
    <input id="radio-selected" type="radio" name="mode" defaultChecked />
    <input id="visible-field" />
  </div></Overlay>)
  settle()
  const dialog = document.querySelector('[role="dialog"]')
  const stops = dialogTabStops(dialog)
  expect(stops.map(node => node.id || node.getAttribute('aria-label'))).toEqual(['radio-selected', 'visible-field', 'Close'])
  key(dialog, 'Tab')
  expect(document.activeElement.id).toBe('radio-selected')
  act(() => stops[stops.length - 1].focus())
  key(document.activeElement, 'Tab')
  expect(document.activeElement.id).toBe('radio-selected')
  key(document.activeElement, 'Tab', true)
  expect(document.activeElement.getAttribute('aria-label')).toBe('Close')
})

it('does not steal focus when a lower dialog closes and returns focus to the remaining dialog', () => {
  const stack = lower => <><Overlay isOpen={lower} onClick={() => {}}><h2>Lower</h2></Overlay><Overlay isOpen onClick={() => {}}><h2>Top</h2><input id="top-field" /></Overlay></>
  render(stack(true)); settle()
  const top = document.querySelectorAll('[role="dialog"]')[1]
  expect(document.activeElement).toBe(top)
  const field = document.getElementById('top-field')
  act(() => field.focus())
  render(stack(false)); settle()
  expect(document.activeElement).toBe(field)
})

it('Escape closes the active dialog and closing it restores its connected trigger', () => {
  const onClose = jest.fn()
  const trigger = document.createElement('button')
  document.body.appendChild(trigger)
  trigger.focus()
  render(<Overlay isOpen onClick={onClose}><h2>Account</h2></Overlay>); settle()
  key(document.activeElement, 'Escape')
  expect(onClose).toHaveBeenCalledTimes(1)
  render(<Overlay isOpen={false} onClick={onClose}><h2>Account</h2></Overlay>); settle()
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})

it('keeps a later boarding portal above its order dialog and returns focus to the order action', () => {
  function OrderWithBoarding() {
    const [boarding, setBoarding] = React.useState(false)
    return <>
      <Overlay isOpen onClick={() => {}}><h2>Order</h2><button id="open-boarding" onClick={() => setBoarding(true)}>Start ride</button></Overlay>
      <Overlay isOpen={boarding} onClick={() => setBoarding(false)}><h2>Boarding code</h2><input id="boarding-field" /></Overlay>
    </>
  }
  render(<OrderWithBoarding />); settle()
  const trigger = document.getElementById('open-boarding')
  act(() => { trigger.focus(); trigger.click() }); settle()
  const dialogs = document.querySelectorAll('[role="dialog"]')
  expect(dialogs).toHaveLength(2)
  expect(document.activeElement).toBe(dialogs[1])
  key(document.activeElement, 'Tab')
  expect(document.activeElement.id).toBe('boarding-field')
  key(document.activeElement, 'Escape'); settle()
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect(document.activeElement).toBe(trigger)
})

it('puts a reopened earlier portal above a later mounted dialog in both focus and z-index', () => {
  function Fixture() {
    const [early, setEarly] = React.useState(true)
    const [late, setLate] = React.useState(false)
    return <>
      <Overlay isOpen={early} onClick={() => setEarly(false)}><h2>Early</h2><button id="close-early" onClick={() => setEarly(false)}>Hide</button></Overlay>
      <Overlay isOpen={late} onClick={() => setLate(false)}><h2>Late</h2><button id="reopen-early" onClick={() => setEarly(true)}>Reopen early</button></Overlay>
      <button id="open-late" onClick={() => setLate(true)}>Open late</button>
    </>
  }
  render(<Fixture />); settle()
  act(() => document.getElementById('close-early').click())
  act(() => document.getElementById('open-late').click()); settle()
  act(() => { document.getElementById('reopen-early').focus(); document.getElementById('reopen-early').click() }); settle()
  const early = document.getElementById('close-early').closest('[role="dialog"]')
  const late = document.getElementById('reopen-early').closest('[role="dialog"]')
  expect(Number(early.style.zIndex)).toBeGreaterThan(Number(late.style.zIndex))
  expect(document.activeElement).toBe(early)
  key(early, 'Escape'); settle()
  expect(document.activeElement.id).toBe('reopen-early')
})
