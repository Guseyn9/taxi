import {cityAtPoint,taxiColor,taxiPicture,safeTaxiColor,vehicleAsset} from './taxiPalette'
it('Agadir uses the approved original red; actual position overrides camera city',()=>{
 expect(taxiColor({city:'agadir',palette:'#1E58EB'})).toBe('#A90000')
 expect(taxiColor({city:'casablanca',point:[30.4278,-9.5981],palette:'#1E58EB'})).toBe('#A90000')
 expect(taxiColor({city:'agadir',point:[33.5731,-7.5898],palette:'#1E58EB'})).toBe('#A90000')
})
it('unknown cities use the approved default until a city livery is supplied',()=>{
 expect(taxiColor({city:'fes',palette:'#123456;#FFFFFF'})).toBe('#A90000')
 expect(cityAtPoint([0,0])).toBeNull()
 expect(safeTaxiColor('red" onload="x')).toBeNull()
 expect(taxiColor({palette:'url(x)'})).toBe('#A90000')
 expect(taxiColor({city:'agadir',cityPalette:'#00AACC'})).toBe('#00AACC')
})
it('the Casablanca animation uses generated Petit artwork even with a blue service theme',()=>{
 const color=taxiColor({point:[33.5731,-7.5898],palette:'#1E58EB'})
 expect(taxiPicture(color)).toBe(vehicleAsset('petit','top'))
 expect(taxiColor({point:[33.5731,-7.5898],palette:'#1E58EB',cityPalette:'#00AACC'})).toBe('#00AACC')
})
it('both assets carry the same safe body color and keep windows and wheels separate',()=>{
 for(const view of ['top','side'] as const){const svg=decodeURIComponent(taxiPicture('#123456',view).split(',')[1]);expect(svg).toContain('#123456');expect(svg).toContain('<svg');expect(svg).not.toContain('onload')}
})

it('uses the red base before a city-specific palette is configured',()=>{expect(taxiColor({city:'casablanca'})).toBe('#A90000');expect(taxiColor({city:'rabat',cityPalette:'#123456'})).toBe('#123456')})

it('Grand has a separate light livery; class override is validated independently of Petit',()=>{
 expect(taxiColor({city:'agadir',kind:'grand',palette:'#A90000'})).toBe('#FFFFFF')
 expect(taxiColor({kind:'grand',classPalette:'#FFFFFF'})).toBe('#FFFFFF')
 expect(taxiColor({kind:'grand',classPalette:'url(evil)'})).toBe('#FFFFFF')
 expect(taxiPicture('#FFFFFF','top','grand')).toBe(vehicleAsset('grand','top'))
})

it('approved reference images have separate class/view URLs and stable north-facing top artwork',()=>{
 expect(taxiPicture('#A90000','top','petit')).toBe('/design-v2/vehicles/petit-agadir-top-v4.png')
 expect(taxiPicture('#ffffff','top','grand')).toBe('/design-v2/vehicles/grand-agadir-top-v4.png')
 expect(taxiPicture('#FFFFFF','side','grand')).toBe('/design-v2/vehicles/grand-agadir-side-v4.png')
 expect(vehicleAsset('petit')).not.toBe(vehicleAsset('grand'))
})
