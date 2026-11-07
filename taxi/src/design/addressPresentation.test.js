import {displayAddress,displayShortAddress,rememberAddressPresentation} from './addressPresentation'

test('preserves mixed proper names, Roman numerals, building numbers and brands without structured translations',()=>{
 for(const raw of ['شارع محمد V','Rue محمد V','Avenue Hassan II شارع الحسن الثاني','12 корпус A, Agadir','مقهى Café 24'])
  for(const locale of ['ar','fr','ru']) expect(displayAddress(raw,locale)).toBe(raw)
 expect(displayAddress(null,'ru')).toBe('')
})
test('uses exact localized provider metadata only for the matching place, retaining raw coordinates and payload',()=>{
 const place=Object.freeze({lat:30.414728,lon:-9.594088,display_name:'Avenue Hassan II شارع الحسن الثاني, Agadir',namedetails:Object.freeze({'name:ru':'Проспект Хасана II','name:ar':'شارع الحسن الثاني'})})
 expect(rememberAddressPresentation(place)).toBe(place)
 expect(displayAddress(place.display_name,'ru',place.lat,place.lon)).toBe('Проспект Хасана II, Agadir')
 expect(displayAddress('Rue 33, Agadir','ru',place.lat,place.lon)).toBe('Rue 33, Agadir')
 expect(place.display_name).toBe('Avenue Hassan II شارع الحسن الثاني, Agadir')
 expect([place.lat,place.lon]).toEqual([30.414728,-9.594088])
})

test('shortens after selecting the locale, keeping the street name complete and source intact',()=>{
 const raw='Place Al Amal, Boulevard Hassan II شارع الحسن الثاني, Quartier administratif الحي الإداري, Agadir'
 expect(displayShortAddress(raw,'fr')).toBe('Place Al Amal, Boulevard Hassan II شارع الحسن الثاني')
 expect(displayShortAddress(raw,'ar')).toBe('Place Al Amal, Boulevard Hassan II شارع الحسن الثاني')
 expect(raw).toContain('Quartier administratif')
})
test('selects one declared Moroccan three-language alias without changing the stored address',()=>{
 const raw='Avenue Kenitra, Hay Mohammedi ⵃⵉ ⵎⵓⵃⵎⴰⴷⵉ الحي المحمدي, Agadir'
 expect(displayShortAddress(raw,'ru')).toBe('Avenue Kenitra, Hay Mohammedi')
 expect(displayShortAddress(raw,'fr')).toBe('Avenue Kenitra, Hay Mohammedi')
 expect(displayShortAddress(raw,'ar')).toBe('Avenue Kenitra, الحي المحمدي')
 expect(displayShortAddress(raw,'zgh')).toBe('Avenue Kenitra, ⵃⵉ ⵎⵓⵃⵎⴰⴷⵉ')
 expect(raw).toContain('Hay Mohammedi ⵃⵉ')
})

test('supports Latin Extended Additional characters in declared aliases',()=>{
 expect(displayShortAddress('Iguil Oḍrḍour ⵉⵖⵉⵍ ⴰⴹⵔⴹⵓⵔ إغيل أضرضور, Imounsiss','ru')).toBe('Iguil Oḍrḍour, Imounsiss')
})
