'use strict'
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict')
const {chromium,expect}=require('@playwright/test')
const root=path.resolve(__dirname,'..'),folder=process.env.STYLE_QA_ROOT,output=process.env.STYLE_QA_OUTPUT
if(!folder||!output||!path.isAbsolute(folder)||!path.isAbsolute(output))throw Error('Set absolute STYLE_QA_ROOT and STYLE_QA_OUTPUT')
function resolveFile(base,name){const filename=path.resolve(base,'.'+name);return filename.startsWith(path.resolve(base)+path.sep)&&fs.existsSync(filename)&&fs.statSync(filename).isFile()?filename:null}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');const requestPath=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)
 const filename=resolveFile(folder,requestPath)||resolveFile(path.join(root,'public'),requestPath)
 if(!filename){res.writeHead(404);res.end('Missing static asset');return}
 const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}
 res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(filename).pipe(res)
})
;(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:768,height:900}}),errors=[],failedRequests=[],rows=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failedRequests.push({url:new URL(r.url()).pathname,error:r.failure()?.errorText}))
 page.on('response',r=>{if(r.status()>=400)failedRequests.push({url:new URL(r.url()).pathname,status:r.status()})})
 try {
 await page.goto('http://127.0.0.1:'+server.address().port)
 await page.evaluate(()=>document.fonts.ready)
 for(const palette of ['default','GHA']){
  await page.getByTestId('palette-'+palette).click();await expect(page.locator('[data-icon] svg')).toHaveCount(15)
  const snapshot=await page.evaluate(()=>{
   const measure=testid=>{const e=document.querySelector('[data-testid="'+testid+'"]'),s=getComputedStyle(e);return {className:e.className,color:s.color,padding:s.padding,borderRadius:s.borderRadius,backgroundImage:s.backgroundImage.replace(/http:\/\/127\.0\.0\.1:\d+/g,''),fontFamily:s.fontFamily}}
   return {icons:[...document.querySelectorAll('[data-icon] svg')].map(e=>({name:e.getAttribute('aria-label'),width:e.getAttribute('width'),height:e.getAttribute('height'),viewBox:e.getAttribute('viewBox'),stroke:e.getAttribute('stroke'),bounds:{width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}})),css:measure('css-module'),sass:measure('sass-module'),indented:measure('indented'),relative:measure('relative-icon'),public:measure('public-car'),fontLoaded:document.fonts.check('16px Manrope'),svgAssetLoaded:document.querySelector('[data-testid="ordinary-svg"]').naturalWidth>0}
  })
  for(const icon of snapshot.icons){assert.equal(icon.width,'36');assert.equal(icon.height,'36');assert.equal(icon.stroke,'#a90000');assert(icon.viewBox);assert.deepEqual(icon.bounds,{width:36,height:36})}
  assert.equal(snapshot.css.color,'rgb(169, 0, 0)');assert.equal(snapshot.sass.color,'rgb(169, 0, 0)');assert.equal(snapshot.indented.padding,'3px');assert.equal(snapshot.fontLoaded,true);assert.equal(snapshot.svgAssetLoaded,true)
  assert(snapshot.public.backgroundImage.includes('/design-v2/vehicles/petit-agadir-side-v4.png'));assert(snapshot.relative.backgroundImage.includes('/static/media/'))
  await page.screenshot({path:output.replace(/\.json$/,'-'+palette+'.png')});rows.push({palette,...snapshot})
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failedRequests,[])
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({rows,errors,failedRequests},null,2)+'\n')}
 console.log(JSON.stringify({palettes:rows.length,iconsPerPalette:15,pageErrors:errors.length,failedRequests:failedRequests.length}))
})().catch(e=>{console.error(e.stack);process.exitCode=1})
