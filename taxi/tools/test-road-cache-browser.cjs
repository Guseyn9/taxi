'use strict'
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict')
const {chromium}=require('@playwright/test')
const bundle=path.resolve(process.env.ROAD_CACHE_BUNDLE||''),output=process.env.ROAD_CACHE_OUTPUT
if(!process.env.ROAD_CACHE_BUNDLE||!fs.existsSync(path.join(bundle,'index.html')))throw Error('Build the isolated road-cache fixture first')
const point={latitude:30.42,longitude:-9.59},body={code:'Ok',waypoints:[{location:[-9.591,30.421],distance:100}]}
let mode='ok',requests=0,bodyClosed=false
const sockets=new Set(),rows=[]
async function evaluate(page,fn,arg) {
  let timer
  try {return await Promise.race([page.evaluate(fn,arg),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Road-cache browser operation timed out')),12000)})])}
  finally {clearTimeout(timer)}
}
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost')
  if(url.pathname.startsWith('/provider/nearest/v1/driving/')) {
    requests++
    assert.equal(url.pathname,'/provider/nearest/v1/driving/-9.59,30.42')
    assert.equal(url.search,'?number=1')
    if(mode==='http-error'){res.writeHead(503);res.end();return}
    res.writeHead(200,{'Content-Type':'application/json'})
    if(mode==='slow-body'){res.write('{');res.on('close',()=>{bodyClosed=true});return}
    res.end(JSON.stringify(mode==='malformed'?{waypoints:[{location:[null,30],distance:-1}]}:body));return
  }
  let relative
  try {relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')} catch {res.writeHead(400);res.end();return}
  const file=path.resolve(bundle,relative||'index.html')
  if(!file.startsWith(bundle+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':'application/javascript','Cache-Control':'no-store'})
  fs.createReadStream(file).pipe(res)
})
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
;(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  let browser
  const errors=[]
  const open=async()=>{requests=0;bodyClosed=false;const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>Boolean(window.roadCacheProbe));return page}
  try {
    browser=await chromium.launch()
    mode='ok'
    let page=await open()
    const first=await evaluate(page,async point=>{
      const values=await Promise.all([window.roadCacheProbe.snap(point),window.roadCacheProbe.snap(point)])
      values[0].latitude=80
      return {other:values[1],cached:await window.roadCacheProbe.snap(point)}
    },point)
    assert.equal(requests,1);assert.equal(first.other.latitude,30.421);assert.equal(first.cached.latitude,30.421)
    rows.push({case:'parallel requests and immutable cache',passed:true,httpRequests:requests});await page.close()

    mode='http-error';page=await open()
    assert.equal(await evaluate(page,p=>window.roadCacheProbe.snap(p),point),null)
    assert.equal(await evaluate(page,p=>window.roadCacheProbe.snap(p),point),null);assert.equal(requests,1)
    mode='ok';await page.waitForTimeout(5100)
    assert.equal((await evaluate(page,p=>window.roadCacheProbe.snap(p),point)).latitude,30.421);assert.equal(requests,2)
    rows.push({case:'network recovery after negative TTL',passed:true,httpRequests:requests});await page.close()

    mode='malformed';page=await open()
    assert.equal(await evaluate(page,p=>window.roadCacheProbe.snap(p),point),null)
    rows.push({case:'malformed coordinates rejected',passed:true,httpRequests:requests});await page.close()

    mode='ok';page=await open()
    assert.equal(await evaluate(page,()=>window.roadCacheProbe.snap({latitude:91,longitude:-9.59})),null);assert.equal(requests,0)
    rows.push({case:'invalid input makes no request',passed:true,httpRequests:requests});await page.close()

    for(const abortController of [true,false]) {
      mode='slow-body';page=await open()
      if(!abortController)await evaluate(page,()=>{window.AbortController=undefined})
      const started=Date.now(),result=await evaluate(page,p=>window.roadCacheProbe.snap(p),point)
      const elapsed=Date.now()-started
      assert.equal(result,null);assert.ok(elapsed>=5500&&elapsed<10000,`unbounded read: ${elapsed}ms`)
      if(abortController){await page.waitForTimeout(100);assert.equal(bodyClosed,true)}
      rows.push({case:abortController?'slow body aborts':'timeout without AbortController',passed:true,httpRequests:requests,elapsedMs:elapsed})
      await page.close()
    }

    mode='http-error';page=await open()
    await page.waitForFunction(()=>Boolean(window.roadCacheProbe.plan))
    const stops=[{orderId:'1',kind:'pickup',lat:30.42,lng:-9.59,order:{b_id:'1',b_start_latitude:30.42,b_start_longitude:-9.59}}]
    const failed=page.waitForResponse(response=>response.url().includes('/provider/'))
    await evaluate(page,stops=>window.roadCacheProbe.plan(stops,0),stops);await failed
    mode='ok';await page.waitForTimeout(5200)
    await evaluate(page,stops=>window.roadCacheProbe.plan([...stops,{...stops[0],orderId:'2',order:{...stops[0].order,b_id:'2'}}],1),stops)
    await page.waitForFunction(()=>{const points=JSON.parse(document.querySelector('[data-testid=snapped-points]').textContent);return points['1']?.start?.[0]===30.421&&points['2']?.start?.[0]===30.421},undefined,{timeout:8000})
    assert.equal(requests,2)
    rows.push({case:'React plan recovery after provider outage; two orders share one retry',passed:true,httpRequests:requests});await page.close()
    assert.deepEqual(errors,[])
    const result={cases:rows,errors,scope:'Isolated loopback HTTP. No live provider, application backend, auth or orders.'}
    if(output)fs.writeFileSync(output,JSON.stringify(result,null,2))
    console.log(JSON.stringify(result))
  } finally {if(browser)await browser.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(JSON.stringify({completedCases:rows,mode,requests}));console.error(error.stack);process.exitCode=1})
