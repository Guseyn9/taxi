import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter, Routes, Route, useLocation} from 'react-router-dom'
import {LegacyReviewDriverRoute} from './legacyReviewRoute'
it('the report driver link redirects to the canonical driver route, keeping query and hash', async () => {
  ;(global as any).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'), root = createRoot(host)
  function Target() {const location = useLocation(); return <div>{location.pathname + location.search + location.hash}</div>}
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/review/frontend-audit-r16/driver-order?tab=2#orders']}><Routes>
      <Route path="/review/frontend-audit-r16/driver-order" element={<LegacyReviewDriverRoute/>}/>
      <Route path="/driver-order" element={<Target/>}/>
    </Routes></MemoryRouter>))
    expect(host.textContent).toBe('/driver-order?tab=2#orders')
  } finally {await act(async () => root.unmount()); delete (global as any).IS_REACT_ACT_ENVIRONMENT}
})
