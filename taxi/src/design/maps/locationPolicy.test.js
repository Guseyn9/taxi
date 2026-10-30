import {canAutoCenter,initialDriverCamera} from './locationPolicy'
test('rejects Accra cache, invalid coordinates, poor GPS and does not move a selected route',()=>{
 const agadir=[30.42,-9.6],accra=[5.55,-.19]
 expect(initialDriverCamera({lat:30.42,lng:-9.6})).toEqual(agadir);expect(initialDriverCamera(accra,agadir)).toBe(agadir);expect(initialDriverCamera(accra,[NaN,0])).toBeUndefined()
 expect(canAutoCenter(accra,5,false)).toBe(false);expect(canAutoCenter(agadir,600,false)).toBe(false)
 expect(canAutoCenter(agadir,20,true)).toBe(false);expect(canAutoCenter(agadir,20,false)).toBe(true)
})
