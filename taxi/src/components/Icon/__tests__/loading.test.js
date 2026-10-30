import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import Icon from '../index'

jest.mock('../../../siteConstants', () => ({
  __esModule: true,
  default: { ICONS_PALETTE_FOLDER: 'Default' },
  EIconsPalettes: { Default: 'Default' },
}))
jest.mock('../../../constants/icons', () => ({ names: { time: 'time.svg' } }))
jest.mock('../../../tools/compat', () => ({ objectFromEntries: entries => Object.fromEntries(entries) }))

test('loading an SVG keeps the sibling map mounted and the page visible', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true
  const pending = new Promise(() => {})
  const lazy = jest.spyOn(React, 'lazy').mockImplementation(() => function PendingIcon() { throw pending })
  const onMapRemoved = jest.fn()
  function MapProbe() {
    useEffect(() => onMapRemoved, [])
    return <div data-testid="map">Map surface</div>
  }
  function Page({ showIcon }) {
    return <React.Suspense fallback={<div data-testid="page-fallback">Loading page</div>}>
      <MapProbe />
      {showIcon && <Icon src="time" />}
    </React.Suspense>
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<Page showIcon={false} />))
    act(() => root.render(<Page showIcon />))
    expect(host.querySelector('[data-testid="map"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="page-fallback"]')).toBeNull()
    expect(onMapRemoved).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    host.remove()
    lazy.mockRestore()
    delete global.IS_REACT_ACT_ENVIRONMENT
  }
})
