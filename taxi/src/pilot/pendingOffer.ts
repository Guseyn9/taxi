/** Retain booking identity while the server's mode is unknown. No command retries. */
const memory = new Set<string>()
const event = 'taxi.pending-offer.changed'
const key = (owner: unknown, id: unknown) => owner != null && id != null ? `taxi.pending-offer.v1:${encodeURIComponent(String(owner))}:${encodeURIComponent(String(id))}` : null
export function pendingOffer(owner: unknown, id: unknown): boolean {
 const name=key(owner,id); if(!name)return false
 try {return localStorage.getItem(name)==='pending' || memory.has(name)} catch {return memory.has(name)}
}
export function markPendingOffer(owner: unknown,id: unknown,pending=true) {
 const name=key(owner,id);if(!name)return
 if(pending)memory.add(name);else memory.delete(name)
 try {if(pending)localStorage.setItem(name,'pending');else localStorage.removeItem(name)}catch{}
 window.dispatchEvent(new Event(event))
}
export const pendingOfferEvent=event
export type OfferRecovery='verified'|'terminal'|'mismatch'|'unknown'
export async function recoverOffer<T>({read,isOffer,isTerminal}:{read:()=>Promise<T|null>,isOffer:(order:T)=>boolean,isTerminal:(order:T)=>boolean}):Promise<OfferRecovery>{
 try {const order=await read();return !order?'unknown':isTerminal(order)?'terminal':isOffer(order)?'verified':'mismatch'}catch{return 'unknown'}
}
