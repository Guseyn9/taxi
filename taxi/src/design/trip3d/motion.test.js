import { DURATION, TOTAL_DISTANCE, ROUTE, sampleRoute, tripFrame } from './motion'

test('route length and endpoints agree; coordinates remain on a route segment',()=>{
  const length=ROUTE.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-ROUTE[i][0],p[1]-ROUTE[i][1]),0)
  expect(length).toBe(TOTAL_DISTANCE)
  expect(sampleRoute(-10)).toMatchObject({x:-16,z:8})
  expect(sampleRoute(TOTAL_DISTANCE+10)).toMatchObject({x:16,z:6})
  for(let distance=0;distance<=length;distance+=.25){
    const {x,z}=sampleRoute(distance)
    expect(ROUTE.slice(1).some(([nx,nz],i)=>{const [px,pz]=ROUTE[i];return x>=Math.min(px,nx)&&x<=Math.max(px,nx)&&z>=Math.min(pz,nz)&&z<=Math.max(pz,nz)})).toBe(true)
  }
})
test('taxi stops for boarding; passenger visibility changes only at pickup and arrival',()=>{
  expect(tripFrame(0)).toMatchObject({phase:0,boarded:false})
  expect(tripFrame(6)).toMatchObject({x:-8,z:8,phase:1,boarded:false})
  expect(tripFrame(8.9)).toMatchObject({x:-8,z:8,phase:1,boarded:false})
  expect(tripFrame(9)).toMatchObject({phase:2,boarded:true})
  expect(tripFrame(DURATION)).toMatchObject({x:16,z:6,phase:3,boarded:false})
  expect(tripFrame(100)).toEqual(tripFrame(DURATION))
})
