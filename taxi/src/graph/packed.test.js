import {WayGraph} from '../tools/maps'
import {packArea,PackedWayGraph,validatePacked} from './packed'
import {MergedWayGraph} from './merged'
const area={id:0,nodes:[
 {id:9000000001,latitude:30.41,longitude:-9.59},
 {id:2,latitude:30.4101,longitude:-9.59,turnRestrictions:[{fromWayId:11,toWayId:11}]},
 {id:3,latitude:30.4102,longitude:-9.59},
 {id:4,latitude:30.4101,longitude:-9.5901},
],ways:[{id:11,oneway:true,segments:[{nodeId:9000000001,weight:0},{nodeId:2,weight:10},{nodeId:3,weight:10}]},{id:22,segments:[{nodeId:2,weight:0},{nodeId:4,weight:15},{nodeId:3,weight:15}]}]}
test('packed graph preserves original Dijkstra paths, one-way roads, restrictions and large OSM ids',()=>{
 const original=new WayGraph(undefined,area),data=packArea(area),packed=new PackedWayGraph(data)
 expect(validatePacked(data)).toBe(true)
 for(const from of area.nodes)for(const to of area.nodes){
  const before=original.findShortestPath(from.id,to.id),after=packed.findShortestPath(from.id,to.id)
  expect(after[0].map(v=>v.id)).toEqual(before[0].map(v=>v.id));expect(after[1]).toBe(before[1])
 }
 expect(packed.findShortestPath(9000000001,3)[0].map(v=>v.id)).toEqual([9000000001,2,4,3])
 expect(packed.findShortestPath(3,9000000001)[1]).toBe(Infinity)
})
test('spatial index returns the same nearest road node and distance including negative coordinate cell boundaries',()=>{
 const original=new WayGraph(undefined,area),packed=new PackedWayGraph(packArea(area))
 for(let i=0;i<100;i++){
  const point=[30.409+i*.00003,-9.591+i*.000017]
  const before=original.findClosestNode(...point),after=packed.findClosestNode(...point)
  expect(after[0]?.id).toBe(before[0]?.id);expect(after[1]).toBe(before[1])
 }
 expect(packed.findClosestNode(0,0)[0]).toBeUndefined()
 expect(packed.findClosestNode(NaN,0)[0]).toBeUndefined()
})
test('rejects corrupt persistent arrays and combines shared area boundaries without losing routes',()=>{
 const data=packArea(area);data.targets[0]=999;expect(validatePacked(data)).toBe(false)
 const other={id:1,nodes:[{id:3,latitude:30.4102,longitude:-9.59},{id:5,latitude:30.4103,longitude:-9.59}],ways:[{id:33,segments:[{nodeId:3,weight:0},{nodeId:5,weight:7}]}]}
 const merged=new MergedWayGraph([new PackedWayGraph(packArea(area)),new PackedWayGraph(packArea(other))])
 expect(merged.findShortestPath(9000000001,5)[1]).toBe(47)
})
