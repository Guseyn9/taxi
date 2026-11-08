// Isolated editor fixture. Saves remain in this page; no authentication or backend calls.
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import '../admin/zones/zones.css'
import ZoneEditor from '../admin/zones/ZoneEditor'
import {Zone} from '../admin/zones/model'
const polygon:Zone={id:'qa-polygon',var:'qa_area',en:'Local test',coordinates:[[[30.43,-9.60],[30.44,-9.60],[30.44,-9.58],[30.43,-9.58],[30.43,-9.60]]]}
const circle:Zone={id:'qa-circle',var:'qa_circle',json:{lat:30.435,lng:-9.59,radius:500}}
function Fixture(){
 const [zone,setZone]=useState(polygon),[saved,setSaved]=useState<Zone|null>(null),[blocked,setBlocked]=useState(false)
 return <main className="zone-page"><h1>Редактор зон · локальное демо</h1><p>Изменения остаются на этой странице. Данные сервера не изменяются.</p><div className="zone-tools"><button onClick={()=>{setZone(polygon);setSaved(null)}}>Polygon</button><button onClick={()=>{setZone(circle);setSaved(null)}}>Circle</button><button onClick={()=>setBlocked(x=>!x)}>Toggle read only</button></div><ZoneEditor key={zone.id} zone={zone} iso="en" busy={false} blocked={blocked} onDirty={()=>{}} onSave={z=>setSaved(z)} onCancel={()=>setSaved(null)}/><pre data-testid="saved-zone">{saved?JSON.stringify(saved):''}</pre></main>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
