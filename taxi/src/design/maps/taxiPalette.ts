import {moroccoCities} from './morocco'
/** Only approved city overrides. Camera presets are not a server service area. */
export type TaxiKind='petit'|'grand'
export const DEFAULT_TAXI_COLOR='#A90000'
export const GRAND_TAXI_COLOR='#E8E2D5'
export const GRAND_TAXI_STRIPE='#2261A6'
export const CITY_TAXI_COLORS: Record<string,string> = {agadir:'#A90000'}
export function safeTaxiColor(value:unknown):string|null {
 const main=typeof value==='string'?value.split(';')[0].trim():''
 return /^#[0-9a-f]{6}$/i.test(main)?main:null
}
export function cityAtPoint(point?:readonly number[]|null):string|null {
 if(!point||!Number.isFinite(point[0])||!Number.isFinite(point[1]))return null
 const rad=Math.PI/180
 let closest:string|null=null,min=25
 for(const city of moroccoCities){const dy=(point[0]-city.position[0])*111.2,dx=(point[1]-city.position[1])*111.2*Math.cos(point[0]*rad),km=Math.hypot(dx,dy);if(km<min){min=km;closest=city.id}}
 return closest
}
export function taxiColor({city,point,palette,cityPalette,kind='petit',classPalette}:{city?:string|null,point?:readonly number[]|null,palette?:unknown,cityPalette?:unknown,kind?:TaxiKind,classPalette?:unknown}={}):string {
 const configured=safeTaxiColor(classPalette)
 if(configured)return configured
 if(kind==='grand')return GRAND_TAXI_COLOR
 const location=point?cityAtPoint(point):city
 return safeTaxiColor(cityPalette)||CITY_TAXI_COLORS[location||'']||safeTaxiColor(palette)||DEFAULT_TAXI_COLOR
}
export function taxiPicture(color:string,view:'top'|'side'='top',kind:TaxiKind='petit'):string {
 const body=safeTaxiColor(color)||'#666670'
 const stripe=kind==='grand'?GRAND_TAXI_STRIPE:'#E87516'
 const svg=view==='top'?`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><defs><linearGradient id="b"><stop stop-color="${body}"/><stop offset=".5" stop-color="${body}"/><stop offset="1" stop-color="${body}"/></linearGradient></defs><ellipse cx="42" cy="43" rx="21" ry="32" fill="#161524" opacity=".18"/><g fill="#20212a"><rect x="19" y="18" width="7" height="13" rx="3"/><rect x="54" y="18" width="7" height="13" rx="3"/><rect x="19" y="53" width="7" height="13" rx="3"/><rect x="54" y="53" width="7" height="13" rx="3"/></g><rect x="24" y="6" width="32" height="67" rx="11" fill="url(#b)"/><path d="M28 25Q40 19 52 25L50 37H30Z M29 49H51L52 58Q40 63 28 58Z" fill="#283c55"/><path d="M25 39V58M55 39V58" stroke="${stripe}" stroke-width="3"/><path d="M27 14Q40 8 53 14" fill="none" stroke="#fff" opacity=".35" stroke-width="3"/><rect x="31" y="39" width="18" height="9" rx="2" fill="#fff"/><text x="40" y="45.5" font-family="Arial" font-size="5" text-anchor="middle" font-weight="bold" fill="#171821">TAXI</text><path d="M27 15H33M47 15H53" stroke="#fff7dc" stroke-width="4"/><path d="M27 66H32M48 66H53" stroke="#ff975e" stroke-width="3"/></svg>`:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 96"><ellipse cx="98" cy="79" rx="83" ry="6" fill="#111" opacity=".12"/><path d="M13 52L31 44L48 23Q53 18 65 18H119L143 40L173 47Q182 49 183 62L181 72H12Z" fill="${body}"/><path d="M51 26H76V43H39ZM82 26H115L134 43H82Z" fill="#dfe7f3"/><path d="M18 57H179" stroke="${stripe}" stroke-width="4"/><path d="M151 49L177 53L179 58H151Z" fill="#fff6d9"/><rect x="78" y="11" width="23" height="9" rx="3" fill="#ff8534"/><path d="M82 14H97" stroke="white" stroke-width="2"/><g fill="#17171c"><circle cx="44" cy="70" r="15"/><circle cx="151" cy="70" r="15"/></g><g fill="#dce0e8"><circle cx="44" cy="70" r="8"/><circle cx="151" cy="70" r="8"/></g><path d="M88 50H100" stroke="#fff" stroke-width="3"/></svg>`
 return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
