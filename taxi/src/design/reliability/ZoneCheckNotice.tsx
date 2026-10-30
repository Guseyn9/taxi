import React from 'react'
import { AlertCircle, LoaderCircle, RotateCcw } from 'lucide-react'
import type { ZoneCheckStatus } from '../../state/clientOrder/constants'
import { zoneCheckCopy } from './zoneCheck'
import './zone-check.css'

export default function ZoneCheckNotice({ from, to, iso, onRetryFrom, onRetryTo }: {
  from: ZoneCheckStatus, to: ZoneCheckStatus, iso?: string,
  onRetryFrom: () => void, onRetryTo: () => void,
}) {
  const copy = zoneCheckCopy(iso)
  const checks = [
    { key: 'from', status: from, label: copy.from, retry: onRetryFrom },
    { key: 'to', status: to, label: copy.to, retry: onRetryTo },
  ].filter(check => check.status === 'checking' || check.status === 'error')
  if (!checks.length) return null
  return <div className="rs-zone-checks">
    {checks.map(check => <div key={check.key} className="rs-zone-check" data-state={check.status}
      role={check.status === 'error' ? 'alert' : 'status'} aria-atomic="true">
      {check.status === 'error' ? <AlertCircle size={18} aria-hidden="true"/> : <LoaderCircle size={18} aria-hidden="true"/>}
      <div><strong>{check.label}</strong><p>{check.status === 'error' ? copy.error : copy.checking}</p></div>
      {check.status === 'error' && <button type="button" onClick={check.retry} aria-label={`${copy.retry}: ${check.label}`}>
        <RotateCcw size={16} aria-hidden="true"/><span>{copy.retry}</span>
      </button>}
    </div>)}
  </div>
}
