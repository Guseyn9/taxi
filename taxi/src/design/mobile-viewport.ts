import {visibleAppHeight} from './viewportSizing'
// Keep the mobile surface within the visible area above the software keyboard.
// This module only sizes the UI; order state and map coordinates are untouched.
const viewport = window.visualViewport
let scheduled = 0
let previousHeight = viewport?.height || window.innerHeight
const updateViewport = () => {
  cancelAnimationFrame(scheduled)
  scheduled = requestAnimationFrame(() => {
    const height=visibleAppHeight(window.innerHeight,viewport?.height,viewport?.scale)
    const keyboardOpened=previousHeight-height>80
    document.documentElement.style.setProperty('--taxi-viewport-height', `${height}px`)
    previousHeight=height
    if(keyboardOpened)requestAnimationFrame(()=>{
      const field=document.activeElement
      if(field instanceof HTMLElement && field.matches('input,textarea,select') && field.closest('.overlay__wrapper,.chat,.rs-ride-body'))field.scrollIntoView({block:'nearest',inline:'nearest'})
    })
  })
}
viewport?.addEventListener('resize', updateViewport, { passive: true })
viewport?.addEventListener('scroll', updateViewport, { passive: true })
window.addEventListener('pageshow', updateViewport, { passive: true })
window.addEventListener('resize', updateViewport, { passive: true })
updateViewport()
export {}
