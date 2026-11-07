import config from '../config'
import {getSessionRecoveryId} from '../security/sessionTokens'
const KEY='taxi.driver.offer-notifications.v1',MAX=200
let memoryScope='',seen=new Set<string>()
/** One notification across the list, card, detail page and a reload of this login. */
export function claimDriverOfferNotification(orderId:string|number,userId:string|number|undefined,event:'accepted'|'rejected'|'expired'):boolean {
  if(userId===undefined||!String(orderId))return false
  const scope=JSON.stringify([config.API_URL,String(userId),getSessionRecoveryId()])
  if(memoryScope!==scope){
    memoryScope=scope;seen=new Set()
    try{const saved=JSON.parse(sessionStorage.getItem(KEY)||'null');if(saved?.scope===scope&&Array.isArray(saved.seen)&&saved.seen.length<=MAX&&saved.seen.every((key:unknown)=>typeof key==='string'&&key.length<=200))seen=new Set(saved.seen)}catch{/* Memory-only deduplication. */}
  }
  const key=JSON.stringify([String(orderId),event])
  if(seen.has(key))return false
  seen.add(key);if(seen.size>MAX)seen.delete(seen.values().next().value!)
  try{sessionStorage.setItem(KEY,JSON.stringify({scope,seen:Array.from(seen)}))}catch{/* Duplicate protection remains for mounted views. */}
  return true
}
