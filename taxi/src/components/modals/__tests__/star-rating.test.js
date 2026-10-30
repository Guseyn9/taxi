import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { StarRating } from '../StarRating'

it('chooses a native radio rating with keyboard arrows, Home/End, and RTL navigation without submitting a form', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host)
  const submit = jest.fn()
  function Fixture() {
    const [rating, setRating] = React.useState(0)
    return <form onSubmit={submit}><StarRating value={rating} onChange={setRating} label="Your rating" /></form>
  }
  const press = key => act(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
  try {
    act(() => root.render(<Fixture />))
    const radios = host.querySelectorAll('input[type="radio"]')
    expect(radios).toHaveLength(5)
    act(() => radios[0].focus())
    press('ArrowRight')
    expect(radios[1].checked).toBe(true)
    expect(document.activeElement).toBe(radios[1])
    press('End'); expect(radios[4].checked).toBe(true)
    press('Home'); expect(radios[0].checked).toBe(true)
    const group = host.querySelector('[role="radiogroup"]')
    group.style.direction = 'rtl'
    press('ArrowLeft'); expect(radios[1].checked).toBe(true)
    press('ArrowRight'); expect(radios[0].checked).toBe(true)
    expect(submit).not.toHaveBeenCalled()
  } finally { act(() => root.unmount()); host.remove(); delete global.IS_REACT_ACT_ENVIRONMENT }
})
