import React from 'react'
import {MapPin,ChevronDown} from 'lucide-react'
import {displayAddress} from './addressPresentation'
export default function LockedRouteSummary({from,to,iso,children}:{from?:string;to?:string;iso?:string;children:React.ReactNode}){
 from=from ? displayAddress(from,iso) : from
 to=to ? displayAddress(to,iso) : to
 const lang=(iso||'en').split('-')[0]
 const label=({ru:'Маршрут',fr:'Trajet',ar:'المسار'} as Record<string,string>)[lang]||'Route'
 return <details className="locked-route-summary"><summary><MapPin size={16} aria-hidden="true"/><span>{label}</span><small dir="auto">{from && to ? `${from} → ${to}` : from || to || ''}</small><ChevronDown size={16} aria-hidden="true"/></summary><div className="locked-route-summary__details">{children}</div></details>
}
