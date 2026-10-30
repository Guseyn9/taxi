import {passengerInitialCamera} from './passengerCamera'
beforeEach(()=>localStorage.clear())
it('opens the saved city immediately before map tiles are ready',()=>{
  localStorage.setItem('taxi.ui.map-area','agadir')
  expect(passengerInitialCamera(undefined,null,false)).toEqual({center:[30.4278,-9.5981],zoom:13,overview:false})
})
it('never replaces an explicit pickup, order or real Morocco GPS with a stored city',()=>{
  localStorage.setItem('taxi.ui.map-area','agadir')
  const gps:[number,number]=[34.02,-6.84]
  expect(passengerInitialCamera(undefined,gps,false).center).toBe(gps)
  expect(passengerInitialCamera(gps,null,false).center).toBe(gps)
  expect(passengerInitialCamera(undefined,null,true).overview).toBe(false)
  expect(passengerInitialCamera(undefined,null,true).zoom).not.toBe(13)
})
