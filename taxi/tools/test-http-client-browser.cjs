// Real browser Axios adapter against two disposable loopback origins.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,expect}=require('@playwright/test');
const root=path.resolve(process.env.HTTP_QA_ROOT||'/tmp/taxi-http-client-qa');
const output=path.resolve(process.env.HTTP_QA_OUTPUT||'/tmp/taxi-http-client-qa.json');
const baseline=process.argv.includes('--baseline');let origin='',peerOrigin='';
function createServer(serveFiles){return http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,X-XSRF-TOKEN');res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
 const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))};
 if(url.pathname==='/failure')return json({message:'synthetic failure'},422);
 if(url.pathname==='/slow'){setTimeout(()=>json({ok:true}),300);return}
 if(url.pathname==='/echo'){
  const buffers=[];req.on('data',chunk=>buffers.push(chunk));req.on('end',()=>json({method:req.method,xsrf:req.headers['x-xsrf-token']||null,authorization:req.headers.authorization||null,contentType:req.headers['content-type']||'',body:Buffer.concat(buffers).toString(),params:Object.fromEntries(url.searchParams),tags:url.searchParams.getAll('tag[]')}));return;
 }
 if(!serveFiles){res.writeHead(404);return res.end()}
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}
 const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
 if(path.extname(file)==='.html')res.end(fs.readFileSync(file,'utf8').replace("connect-src 'self'",`connect-src 'self' ${peerOrigin}`));else fs.createReadStream(file).pipe(res);
})}
(async()=>{
 const first=createServer(true),peer=createServer(false),start=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await start(first);await start(peer);origin=`http://127.0.0.1:${first.address().port}`;peerOrigin=`http://127.0.0.1:${peer.address().port}`;
 const browser=await chromium.launch(),page=await browser.newPage(),errors=[],results={};page.on('pageerror',error=>errors.push(error.message));
 try{
 await page.goto(origin+'/?peer='+encodeURIComponent(peerOrigin));
 for(const name of ['same','cross','cross-default','form','json','params','failure','timeout']){
  await page.getByTestId('probe-'+name).click();await expect(page.getByTestId('probe-result')).toContainText('"case":"'+name+'"');const value=JSON.parse(await page.getByTestId('probe-result').textContent());assert.equal(value.error,undefined);results[name]=value.value;
 }
 assert.equal(results.same.xsrf,'synthetic-csrf-probe');assert.equal(results.cross.xsrf,baseline?'synthetic-csrf-probe':null);assert.equal(results['cross-default'].xsrf,null);
 assert.match(results.form.contentType,/multipart\/form-data; boundary=/);for(const value of ['Марокко + café','name="zero"','\r\n0\r\n','\r\nfalse\r\n'])assert.ok(results.form.body.includes(value));
 assert.deepEqual(JSON.parse(results.json.first.body),{coordinates:[[-9.598,30.4206]],value:0});assert.equal(results.json.first.authorization,'Bearer synthetic-provider-only');assert.equal(results.json.second.authorization,null);
 assert.equal(results.params.params.q,'Марокко + %00');assert.deepEqual(results.params.tags,['A/B','café']);assert.equal(results.failure.status,422);assert.equal(results.failure.isAxiosError,true);assert.equal(results.timeout.code,'ECONNABORTED');assert.equal(results.timeout.isAxiosError,true);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>first.close(resolve));await new Promise(resolve=>peer.close(resolve));fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({baseline,scope:'real XHR adapter, two local origins, synthetic values; not proof of an application-level exploit',results,errors},null,2))}
 console.log(JSON.stringify({baseline,cases:Object.keys(results).length,crossOriginXsrfHeader:results.cross?.xsrf,errors}));
})().catch(error=>{console.error(error);process.exitCode=1});
