// Local static preview smoke. Does not execute frontend JS or call the shared backend.
const fs=require('fs');const {performance}=require('perf_hooks');
const base='http://127.0.0.1:3018';const paths=['/passenger-order','/driver-order','/maps/taxi-top.svg','/maps/passenger.svg'];
(async()=>{const stages=[];
 for(const concurrency of [20,200,400]){
  const timings=[];let failures=0,bytes=0;const start=performance.now();
  await Promise.all(Array.from({length:concurrency},async(_,client)=>{
    for(let i=0;i<10;i++){const t=performance.now();try{const res=await fetch(base+paths[(client+i)%paths.length],{signal:AbortSignal.timeout(10000)});const body=await res.arrayBuffer();bytes+=body.byteLength;if(res.status!==200)failures++}catch{failures++}timings.push(performance.now()-t)}
  }));timings.sort((a,b)=>a-b);const percentile=p=>Math.round(timings[Math.min(timings.length-1,Math.floor(timings.length*p))]*100)/100;
  stages.push({concurrency,requests:timings.length,failures,bytes,elapsedMs:Math.round(performance.now()-start),p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99)});
 }
 const result={scope:'Local static HTTP preview only; not a backend, GPS, browser-rendering or 400-driver capacity test',base,stages};fs.writeFileSync('design-review/pilot/local-load.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(stages.some(s=>s.failures))process.exitCode=1;
})();
