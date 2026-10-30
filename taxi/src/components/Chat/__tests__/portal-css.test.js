import fs from 'fs'
import path from 'path'

test('chat status and composer geometry apply outside #root after rendering through a body portal', () => {
  const style = document.createElement('style')
  style.textContent = '.input__suggestions{opacity:0;width:calc(100% + 7px);height:0}' + fs.readFileSync(path.resolve(process.cwd(), 'src/design/mobile-chat-status.css'), 'utf8')
  document.head.appendChild(style)
  const app = document.createElement('div'); app.id = 'root'; document.body.appendChild(app)
  const portal = document.createElement('div')
  // Match Input's real header / side wrapper / textarea + button wrapper + empty results siblings.
  portal.innerHTML = `<div class="chat"><div class="chat__connection-status">Connecting to chat…</div>
    <div class="chat__footer"><div class="chat__input input__field-wrapper">
      <div class="input__header input__header--empty"><div class="input__header-item"></div></div>
      <div class="input__side-text-wrapper"><div class="input__wrapper">
        <textarea class="input"></textarea>
        <div class="input__buttons"><div class="button__wrapper"><button class="button chat__send-button">Send</button></div></div>
        <div id="message-results" class="input__suggestions"></div>
      </div></div>
    </div></div></div>`
  document.body.appendChild(portal)
  try {
    expect(app.contains(portal)).toBe(false)
    expect(window.getComputedStyle(portal.querySelector('.chat__connection-status')).fontSize).toBe('12px')
    expect(window.getComputedStyle(portal.querySelector('.chat__footer')).flexDirection).toBe('column')
    expect(window.getComputedStyle(portal.querySelector('.input__wrapper')).flexWrap).toBe('nowrap')
    expect(window.getComputedStyle(portal.querySelector('textarea')).minHeight).toBe('44px')
    expect(window.getComputedStyle(portal.querySelector('textarea')).minWidth).toBe('0')
    expect(window.getComputedStyle(portal.querySelector('textarea')).flexGrow).toBe('1')
    expect(portal.querySelector('.input__wrapper').children).toHaveLength(3)
    expect(window.getComputedStyle(portal.querySelector('.input__suggestions')).display).toBe('none')
    expect(window.getComputedStyle(portal.querySelector('.input__header--empty')).display).toBe('none')
    expect(window.getComputedStyle(portal.querySelector('.input__buttons>.button__wrapper')).minWidth).toBe('44px')
    expect(window.getComputedStyle(portal.querySelector('.chat__send-button')).minWidth).toBe('44px')
  } finally { portal.remove(); app.remove(); style.remove() }
})
