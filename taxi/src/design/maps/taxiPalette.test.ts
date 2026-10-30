import {cityAtPoint,taxiColor,taxiPicture,safeTaxiColor} from './taxiPalette'
it('Agadir uses the approved original red; actual position overrides camera city',()=>{
 expect(taxiColor({city:'agadir',palette:'#1E58EB'})).toBe('#A90000')
 expect(taxiColor({city:'casablanca',point:[30.4278,-9.5981],palette:'#1E58EB'})).toBe('#A90000')
 expect(taxiColor({city:'agadir',point:[33.5731,-7.5898],palette:'#1E58EB'})).toBe('#1E58EB')
})
it('unknown cities retain configured palette, not invented city colors',()=>{
 expect(taxiColor({city:'fes',palette:'#123456;#FFFFFF'})).toBe('#123456')
 expect(cityAtPoint([0,0])).toBeNull()
 expect(safeTaxiColor('red" onload="x')).toBeNull()
 expect(taxiColor({palette:'url(x)'})).toBe('#A90000')
 expect(taxiColor({city:'agadir',cityPalette:'#00AACC'})).toBe('#00AACC')
})
it('both assets carry the same safe body color and keep windows and wheels separate',()=>{
 for(const view of ['top','side'] as const){const svg=decodeURIComponent(taxiPicture('#A90000',view).split(',')[1]);expect(svg).toContain('#A90000');expect(svg).toContain('<svg');expect(svg).not.toContain('onload')}
})

it('uses the red base before a city-specific palette is configured',()=>{expect(taxiColor({city:'casablanca'})).toBe('#A90000');expect(taxiColor({city:'rabat',cityPalette:'#123456'})).toBe('#123456')})
