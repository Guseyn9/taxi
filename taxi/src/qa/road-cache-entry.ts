import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { snapToRoad, isReachable } from '../tools/mapReachability'
import { useDemoOrderPoints } from '../tools/useDemoOrderPoints'
import { ITripStop } from '../tools/driverTripPlan'

declare global {
  interface Window {
    roadCacheProbe: {
      snap: typeof snapToRoad
      reachable: typeof isReachable
      plan?: (stops: ITripStop[], retryNonce: number) => void
    }
  }
}

// Standalone test bundle only: retain actual browser fetch/JSON/AbortSignal while
// redirecting the exact road-provider URL to an isolated loopback HTTP fixture.
const browserFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  if (typeof input !== 'string') throw Error('Unexpected fixture request')
  const url = new URL(input)
  if (url.origin !== 'https://router.project-osrm.org' || !url.pathname.startsWith('/nearest/v1/driving/'))
    throw Error('External requests are disabled in the road-cache fixture')
  return browserFetch(`/provider${url.pathname}${url.search}`, init)
}
window.roadCacheProbe = { snap: snapToRoad, reachable: isReachable }
const label = document.createElement('p')
label.textContent = 'Road cache check · isolated HTTP fixture · no backend'
document.body.appendChild(label)

function Probe() {
  const [plan, setPlan] = useState<{ stops: ITripStop[], retryNonce: number }>({ stops: [], retryNonce: 0 })
  const points = useDemoOrderPoints(true, plan.stops, plan.retryNonce)
  useEffect(() => {
    window.roadCacheProbe.plan = (stops, retryNonce) => setPlan({ stops, retryNonce })
    return () => { delete window.roadCacheProbe.plan }
  }, [])
  return React.createElement('output', { 'data-testid': 'snapped-points' }, JSON.stringify(points))
}
const host = document.createElement('main')
document.body.appendChild(host)
createRoot(host).render(React.createElement(Probe))
