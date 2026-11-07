import {validRing,validateZone,readZones,zonePayload,zoneLabel} from './model'
const ring:[number,number][]=[[30,-9],[31,-9],[31,-8],[30,-8],[30,-9]]
it('accepts closed geometry but rejects crossings, zero area, open paths and invalid coordinates',()=>{
 expect(validRing(ring)).toBe(true)
 for(const points of [ring.slice(0,-1),[[30,-9],[31,-8],[31,-9],[30,-8],[30,-9]],[[0,0],[1,1],[2,2],[0,0]],[[91,0],[1,0],[2,2],[91,0]]])expect(validRing(points)).toBe(false)
})
it('preserves stable IDs, all localized names and metadata when serializing',()=>{
 const zone={id:'79',var:'petti_agadir',ru:'Агадир',en:'Agadir',ar:'أكادير',fr:'Agadir',es:'Agadir',coordinates:[ring],json:{custom:0}}
 expect(zonePayload(zone,'polygon')).toEqual(zone)
 expect(zoneLabel(zone,'ar-MA')).toBe('أكادير')
 expect(zoneLabel({var:'a'},'fr')).toBe('a')
})
it('does not accept empty identifiers or silently discard extra contours',()=>{
 expect(validateZone({var:'',coordinates:[ring]},'polygon')).toBe('identifier')
 expect(()=>zonePayload({var:'a',coordinates:[ring,ring]},'polygon')).toThrow('polygon')
})
it('requires valid circle coordinates and a positive finite radius',()=>{
 expect(zonePayload({var:'a',json:{lat:'30',lng:'-9',radius:'250',custom:false}},'circle').json).toEqual({lat:30,lng:-9,radius:250,custom:false})
 for(const json of [{lat:null,lng:0,radius:250},{lat:0,lng:0,radius:0},{lat:0,lng:0,radius:NaN},{lat:91,lng:0,radius:200}])expect(validateZone({var:'a',json},'circle')).toBe('circle')
})
it('rejects whitespace coordinates, booleans and non-finite circle values instead of converting them to zero',()=>{
 for(const value of ['   ','\t',true,[],{},Infinity,'Infinity']){
  expect(validateZone({var:'a',json:{lat:value,lng:-9,radius:200}},'circle')).toBe('circle')
  expect(validateZone({var:'a',json:{lat:30,lng:value,radius:200}},'circle')).toBe('circle')
 }
 expect(zonePayload({var:'a',json:{lat:'0',lng:'0',radius:'200'}},'circle').json).toEqual({lat:0,lng:0,radius:200})
})
it('normalizes PHP catalog IDs and string coordinates, while rejecting malformed answers',()=>{
 const result=readZones({'79':{var:'petti_agadir',coordinates:[ring.map(p=>p.map(String))],json:'{"custom":0}'}})
 expect(result[0]).toEqual({id:'79',var:'petti_agadir',coordinates:[ring],json:{custom:0}})
 expect(readZones([])).toEqual([]);expect(readZones({})).toEqual([])
 for(const value of [null,'a',{'79':null},{'79':{var:'a',json:'bad'}}])expect(()=>readZones(value)).toThrow()
})
