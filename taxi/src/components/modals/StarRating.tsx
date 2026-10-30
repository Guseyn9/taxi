import React, { useId, useRef } from 'react'
import { Star } from 'lucide-react'

export function StarRating({ value, onChange, label }: { value: number, onChange: (value: number) => void, label: string }) {
  const name = useId()
  const group = useRef<HTMLDivElement>(null)
  return <div ref={group} role="radiogroup" aria-label={label} className="rating-stars" onKeyDown={event => {
    const rtl = window.getComputedStyle(event.currentTarget).direction === 'rtl'
    const forward = event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
    const backward = event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
    if (!forward && !backward && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const current = value || 1
    const next = event.key === 'Home' ? 1 : event.key === 'End' ? 5 : ((current - 1 + (forward ? 1 : -1) + 5) % 5) + 1
    onChange(next)
    group.current?.querySelector<HTMLInputElement>(`input[value="${next}"]`)?.focus()
  }}>
    {[1, 2, 3, 4, 5].map(rating => <label key={rating} className="rating-stars__option">
      <input type="radio" name={name} value={rating} checked={value === rating} tabIndex={rating === (value || 1) ? 0 : -1} aria-label={`${rating} / 5`} onChange={() => onChange(rating)} />
      <span className="rating-stars__symbol"><Star aria-hidden="true" size={28} fill={rating <= value ? 'currentColor' : 'none'} /></span>
    </label>)}
  </div>
}
