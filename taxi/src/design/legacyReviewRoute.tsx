import React from 'react'
import {Navigate, useLocation} from 'react-router-dom'

/** Old report links must preserve the requested application role. */
export function LegacyReviewDriverRoute() {
  const {search, hash} = useLocation()
  return <Navigate replace to={{pathname: '/driver-order', search, hash}}/>
}
