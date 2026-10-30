import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from '../index'
import Overlay from '../../modals/Overlay'
import { chatGateway } from '../../../platform/adapters/LegacyChatGateway'

jest.mock('react-redux', () => ({ connect: () => Component => Component }))
jest.mock('../../../state/config', () => ({ configSelectors: { language: jest.fn() } }))
jest.mock('../../../state/modals', () => ({ modalsActionCreators: { setActiveChat: jest.fn() }, modalsSelectors: { activeChat: jest.fn() } }))
jest.mock('../../../platform/platform-interface', () => ({ SHARED_CHAT_SURFACE_ID: 'chat', useRegisteredSurface: jest.fn() }))
jest.mock('../../../platform/adapters/LegacyChatGateway', () => ({ chatGateway: { getUser: jest.fn().mockResolvedValue({ u_name: 'Test Passenger' }), connect: jest.fn(() => ({ send: jest.fn(), close: jest.fn() })) } }))
jest.mock('../../../localization', () => ({ t: value => value, TRANSLATION: { CLOSE: 'Close', MESSAGE: 'Message', REQUIRED_FIELD: 'Required' } }))
jest.mock('../../../siteConstants', () => ({ __esModule: true, default: { PALETTE: { primary: { main: '#7018e6', dark: '#5a12b8' } } } }))
jest.mock('react-helmet-async', () => ({ Helmet: () => null }))
jest.mock('../../Input', () => ({
  __esModule: true, EInputTypes: { Textarea: 'textarea' },
  default: ({ inputProps, buttons }) => <div className="chat__input"><textarea {...inputProps} />{buttons.map((button, index) => <button key={index} type={button.type} aria-label={button['aria-label']} disabled={button.disabled}>{button.svg}</button>)}</div>,
}))

let host, root, rectangles, frame, cancelFrame
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true
  jest.useFakeTimers()
  frame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => setTimeout(callback, 0))
  cancelFrame = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => clearTimeout(id))
  rectangles = jest.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}])
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); rectangles.mockRestore(); frame.mockRestore(); cancelFrame.mockRestore(); jest.useRealTimers(); jest.clearAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT
})

it.each(['click', 'escape'])('closes only the chat with %s, restores the order trigger and stays closed after Arrived rerenders', async method => {
  const changeChat = jest.fn()
  function Fixture() {
    const [activeChat, setChat] = React.useState(null)
    const [arrived, setArrived] = React.useState(false)
    return <>
      <Overlay isOpen onClick={() => {}}><h2>Order</h2><button id="open-chat" onClick={() => setChat('1420_18429;1419_18429')}>Chat</button><button id="arrived" onClick={() => setArrived(true)}>{arrived ? 'Arrived' : 'Mark arrived'}</button></Overlay>
      <Chat activeChat={activeChat} language={{ iso: 'en' }} setActiveChat={value => { changeChat(value); setChat(value) }} />
    </>
  }
  await act(async() => root.render(<Fixture />))
  act(() => jest.runOnlyPendingTimers())
  const trigger = document.getElementById('open-chat')
  await act(async() => { trigger.focus(); trigger.click() })
  act(() => jest.runOnlyPendingTimers())
  const dialogs = document.querySelectorAll('[role="dialog"]')
  expect(dialogs).toHaveLength(2)
  expect(dialogs[1].classList.contains('chat-overlay')).toBe(true)
  expect(dialogs[1].contains(document.activeElement)).toBe(true)
  if (method === 'click') act(() => document.querySelector('.chat__close-button').click())
  else act(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(changeChat).toHaveBeenCalledTimes(1)
  expect(changeChat).toHaveBeenCalledWith(null)
  expect(document.querySelector('.chat')).toBeNull()
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect(document.activeElement).toBe(trigger)
  act(() => document.getElementById('arrived').click())
  act(() => jest.runOnlyPendingTimers())
  expect(document.querySelector('.chat')).toBeNull()
  expect(chatGateway.connect).toHaveBeenCalledTimes(1)
})
it('retains a typed draft after closing and reopening the actual chat component',async()=>{
 sessionStorage.clear();localStorage.clear()
 function Fixture(){const [thread,setThread]=React.useState('1420_18429;1419_18429');return <><button id="reopen" onClick={()=>setThread('1420_18429;1419_18429')}>Reopen</button><Chat activeChat={thread} language={{iso:'en'}} setActiveChat={setThread}/></>}
 await act(async()=>root.render(<Fixture/>))
 const field=document.querySelector('.chat textarea'),setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set
 await act(async()=>{setter.call(field,'draft after network loss');field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}))})
 await act(async()=>document.querySelector('.chat__close-button').click())
 await act(async()=>document.getElementById('reopen').click())
 expect(document.querySelector('.chat textarea').value).toBe('draft after network loss')
 expect(document.querySelector('.chat button[type="submit"]').disabled).toBe(true)
})
