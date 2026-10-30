// Local CPU/data benchmark. No API requests and no simulated backend capacity claim.
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'CommonJS',target:'ES2020'}});
const fs=require('fs'),{performance}=require('perf_hooks');
const {WayGraph}=require('../src/tools/maps'),{packArea,PackedWayGraph,validatePacked}=require('../src/graph/packed');
const start=performance.now(),raw=fs.readFileSync('public/mock/agadir.json','utf8'),readMs=performance.now()-start;
let at=performance.now();const area=JSON.parse(raw),jsonMs=performance.now()-at;
at=performance.now();const old=new WayGraph(undefined,area),oldBuildMs=performance.now()-at;
at=performance.now();const packet=packArea(area),packMs=performance.now()-at;
if(!validatePacked(packet))throw new Error('Prepared packet invalid');
at=performance.now();const fast=new PackedWayGraph(packet),attachMs=performance.now()-at;
const points=Array.from({length:200},(_,i)=>{const node=area.nodes[(i*317)%area.nodes.length];return [node.latitude,node.longitude]});
const sample=graph=>{const t=performance.now(),values=points.map(p=>{const [node,d]=graph.findClosestNode(...p);return [node?.id,d]});return {ms:performance.now()-t,values}};
const before=sample(old),after=sample(fast);
if(JSON.stringify(before.values)!==JSON.stringify(after.values))throw new Error('Nearest nodes changed');
const from=old.findClosestNode(30.414728,-9.594088)[0],to=old.findClosestNode(30.419882,-9.600500)[0];
const routeA=old.findShortestPath(from.id,to.id),routeB=fast.findShortestPath(from.id,to.id);
if(routeA[1]!==routeB[1]||JSON.stringify(routeA[0].map(n=>n.id))!==JSON.stringify(routeB[0].map(n=>n.id)))throw new Error('Agadir route changed');
const result={scope:'Local host CPU benchmark, not real phones or backend load',nodes:packet.ids.length,edges:packet.targets.length,sourceBytes:Buffer.byteLength(raw),packetBytes:Object.values(packet).reduce((sum,v)=>sum+(ArrayBuffer.isView(v)?v.byteLength:0),0),readMs,jsonMs,oldBuildMs,workerPreparationMs:packMs,mainAttachMs:attachMs,nearest200BeforeMs:before.ms,nearest200AfterMs:after.ms,nearestSpeedup:before.ms/after.ms,identicalNearestNodes:200,agadirRouteMeters:routeA[1],agadirRouteNodeCount:routeA[0].length,identicalAgadirRoute:true};
console.log(JSON.stringify(result,null,2));
