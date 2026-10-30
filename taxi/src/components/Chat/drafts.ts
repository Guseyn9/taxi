export type ChatDraft={draft:string;unconfirmed:string}
const prefix='taxi.chat.draft:'
function key(thread:string){let epoch='0';try{epoch=localStorage.getItem('taxi.auth.revocation')||'0'}catch{}return `${prefix}${epoch}:${thread}`}
export function readChatDraft(thread:string):ChatDraft {
 try{const item=JSON.parse(sessionStorage.getItem(key(thread))||'null');if(item&&Date.now()-item.at<86400000&&typeof item.draft==='string'&&typeof item.unconfirmed==='string')return {draft:item.draft,unconfirmed:item.unconfirmed}}catch{}
 return {draft:'',unconfirmed:''}
}
export function saveChatDraft(thread:string,value:ChatDraft){
 try{if(!value.draft&&!value.unconfirmed){sessionStorage.removeItem(key(thread));return}sessionStorage.setItem(key(thread),JSON.stringify({...value,at:Date.now()}))}catch{/* Quota/private mode: the open composer remains intact. */}
}
