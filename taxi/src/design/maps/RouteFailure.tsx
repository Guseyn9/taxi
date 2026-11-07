import React from 'react'
import { t } from '../../localization'

export default function RouteFailure({ onRetry }: { onRetry: () => void }) {
  return <div className="map-route-feedback" role="alert" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <p>{t('route_unavailable')}</p>
    <button type="button" onClick={onRetry}>{t('retry')}</button>
  </div>
}
