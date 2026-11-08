export const zoneLocales = ['ru', 'en', 'ar', 'fr', 'es'] as const
export type Coordinate = [number, number]
export interface Zone {
  id?: string
  var: string
  ru?: string; en?: string; ar?: string; fr?: string; es?: string
  coordinates?: Coordinate[][]
  json?: Record<string, unknown>
  [key: string]: unknown
}
export type ZoneKind = 'polygon' | 'circle'
/** Blank text is missing input, never a geographic zero. */
export function zoneNumber(value:unknown):number|null {
  if(typeof value!=='number'&&typeof value!=='string')return null
  if(typeof value==='string'&&!value.trim())return null
  const result=Number(value)
  return Number.isFinite(result)?result:null
}
export function coordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number' && Number.isFinite(v)) && Math.abs(value[0]) <= 90 && Math.abs(value[1]) <= 180
}
const same = (a: Coordinate, b: Coordinate) => a[0] === b[0] && a[1] === b[1]
function turn(a: Coordinate, b: Coordinate, c: Coordinate) { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]) }
function intersects(a: Coordinate,b: Coordinate,c: Coordinate,d: Coordinate) {
  const between=(p:Coordinate,x:Coordinate,y:Coordinate)=>Math.min(x[0],y[0])<=p[0]&&p[0]<=Math.max(x[0],y[0])&&Math.min(x[1],y[1])<=p[1]&&p[1]<=Math.max(x[1],y[1])
  const t1=turn(a,b,c),t2=turn(a,b,d),t3=turn(c,d,a),t4=turn(c,d,b)
  return (t1*t2<0&&t3*t4<0)||(t1===0&&between(c,a,b))||(t2===0&&between(d,a,b))||(t3===0&&between(a,c,d))||(t4===0&&between(b,c,d))
}
export function validRing(ring: unknown): ring is Coordinate[] {
  if (!Array.isArray(ring) || ring.length<4 || ring.length>5000 || !ring.every(coordinate) || !same(ring[0],ring[ring.length-1])) return false
  const points=ring as Coordinate[]
  if (new Set(points.slice(0,-1).map(p=>p.join(','))).size !== points.length-1) return false
  let area=0
  for(let i=0;i<points.length-1;i++) {
    area+=points[i][0]*points[i+1][1]-points[i+1][0]*points[i][1]
    for(let j=i+2;j<points.length-1;j++) {
      if(i===0&&j===points.length-2) continue
      if(intersects(points[i],points[i+1],points[j],points[j+1])) return false
    }
  }
  return Math.abs(area)>1e-12
}
export function zoneKind(zone: Zone): ZoneKind { return Array.isArray(zone.coordinates)&&zone.coordinates.length ? 'polygon' : 'circle' }
export function validateZone(zone: Zone,kind: ZoneKind): string | null {
  if(!/^[a-zA-Z0-9_-]{1,120}$/.test(zone.var)) return 'identifier'
  if(kind==='polygon') {
    if(!Array.isArray(zone.coordinates)||zone.coordinates.length!==1||!validRing(zone.coordinates[0])) return 'polygon'
  } else {
    const lat=zoneNumber(zone.json?.lat),lng=zoneNumber(zone.json?.lng),radius=zoneNumber(zone.json?.radius)
    if(lat===null||lng===null||radius===null||!coordinate([lat,lng])||radius<=0) return 'circle'
  }
  return null
}
/** Keep metadata returned by the server; never silently drop extra contours. */
export function zonePayload(zone: Zone,kind: ZoneKind): Zone {
  const error=validateZone(zone,kind)
  if(error) throw new Error(error)
  const payload: Zone={var:zone.var,...Object.fromEntries(zoneLocales.map(locale=>[locale,String(zone[locale]||'')]))}
  if(zone.id) payload.id=zone.id
  if(kind==='polygon'){payload.coordinates=zone.coordinates;payload.json=zone.json||{}}
  else payload.json={...zone.json,lat:zoneNumber(zone.json?.lat),lng:zoneNumber(zone.json?.lng),radius:zoneNumber(zone.json?.radius)}
  return payload
}
export function readZones(value: unknown): Zone[] {
  if(!value||typeof value!=='object'||(Array.isArray(value)&&value.length)) throw new Error('response')
  return Object.entries(value).map(([id,item])=>{
    if(!item||typeof item!=='object'||typeof (item as any).var!=='string') throw new Error('response')
    const zone={...item as Zone,id:String((item as any).id??id)}
    if(typeof zone.json==='string'){try{zone.json=JSON.parse(zone.json)}catch{throw new Error('response')}}
    if(Array.isArray(zone.coordinates)) zone.coordinates=zone.coordinates.map(ring=>ring.map(p=>[Number(p[0]),Number(p[1])]))
    return zone
  })
}
export function zoneLabel(zone: Zone,iso='en') { return String(zone[iso.split('-')[0]]||zone.en||zone.fr||zone.var) }
