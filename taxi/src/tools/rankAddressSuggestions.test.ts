import {rankAddressSuggestions} from './rankAddressSuggestions'
it('shows the requested street and city before unrelated recent places',()=>{
  const recent={point:{address:'RIDA SLAOUI, Avenue des Nations Unies, Agadir'}}
  const otherCity={point:{address:'Avenue Hassan II, Casablanca'}}
  const exact={point:{address:'Avenue Hassan II, Battoire, Agadir',latitude:30.41,longitude:-9.59}}
  const input=Object.freeze([recent,otherCity,exact])
  const result=rankAddressSuggestions('Avenue Hassan II, Agadir',input)
  expect(result).toEqual([exact,otherCity,recent])
  expect(result[0]).toBe(exact)
  expect(input[0]).toBe(recent)
})
it('handles accents and Arabic diacritics without removing unmatched suggestions',()=>{
  const a={point:{address:'Rue de la Paix'}},b={point:{address:'Café Central, Agadir'}}
  expect(rankAddressSuggestions('cafe central',[a,b])).toEqual([b,a])
  const c={point:{address:'شارع الحسن الثاني'}},d={point:{address:'شارع آخر'}}
  expect(rankAddressSuggestions('الحَسَن',[d,c])).toEqual([c,d])
})
it('keeps source order for ties and empty queries',()=>{
  const input=[{point:{address:'Agadir A'}},{point:{address:'Agadir B'}}]
  expect(rankAddressSuggestions('',input)).toEqual(input)
  expect(rankAddressSuggestions('missing',input)).toEqual(input)
})
