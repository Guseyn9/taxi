const separators=new RegExp('[^\\p{L}\\p{N}]+','gu')
const normalized=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g,'').toLowerCase().replace(separators,' ').trim()
const generic=new Set(['avenue','boulevard','rue','street','road','av','bd','ул','улица','проспект'])

/** Presentation ranking only: retain every original suggestion and its coordinates. */
export function rankAddressSuggestions<T extends {point?:{address?:string,shortAddress?:string}}>(query:string,suggestions:readonly T[]):T[]{
  const q=normalized(query)
  if(!q)return [...suggestions]
  const allTerms=Array.from(new Set(q.split(' ')))
  const specific=allTerms.filter(term=>!generic.has(term))
  const terms=specific.length?specific:allTerms
  const street=normalized(query.split(/[,،]/)[0])
  const score=(item:T)=>{
    const address=normalized(`${item.point?.address||''} ${item.point?.shortAddress||''}`)
    const matched=terms.filter(term=>address.includes(term)).length
    return matched/terms.length*100+(matched===terms.length?500:0)+(address.startsWith(q)?150:0)+(street&&address.includes(street)?80:0)
  }
  return suggestions.map((value,index)=>({value,index,score:score(value)})).sort((a,b)=>b.score-a.score||a.index-b.index).map(item=>item.value)
}
