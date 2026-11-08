// Integration regression: actual HTTP/WS server, loopback only, no backend actions.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),WebSocket=require('ws');
const base=new URL(process.env.DEV_POLICY_QA_URL||'http://127.0.0.1:3022');
if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname))throw Error('Only a loopback development server may be tested');
const output=process.env.DEV_POLICY_QA_OUTPUT||'/tmp/taxi-dev-server-policy.json';
function request(host){return new Promise((resolve,reject)=>{const req=http.get(base,{headers:{Host:host}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.setTimeout(20000,()=>req.destroy(Error('HTTP deadline')));req.on('error',reject)})}
function connect(origin){return new Promise((resolve,reject)=>{
 const ws=new WebSocket(base.href.replace('http:','ws:')+'ws',origin===undefined?{}:{origin});let done=false;
 const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);ws.terminate();error?reject(error):resolve(result)};
 const timer=setTimeout(()=>finish(Error('WS deadline')),5000);
 ws.on('unexpected-response',(req,res)=>{res.resume();finish(null,{status:res.statusCode,connected:false});req.destroy()});
 ws.on('message',raw=>{const value=JSON.parse(raw.toString());finish(null,{status:101,connected:true,messageType:value.type})});
 ws.on('error',error=>{if(!done)finish(error)});
})}
(async()=>{const rows=[];
for(const [host,expected] of [[base.host,200],['evil.invalid:'+base.port,403],['203.0.113.7:'+base.port,403],['localhost:'+base.port+'@evil.invalid',403]]){
 const status=await request(host);assert.equal(status,expected);rows.push({kind:'HTTP Host',host,status})}
for(const origin of [base.origin,'http://localhost:'+base.port]){
 const result=await connect(origin);assert.equal(result.connected,true);rows.push({kind:'own WS Origin',origin,...result})}
for(const origin of ['http://evil.invalid:8080','http://203.0.113.7:8080','http://[2001:db8::7]:8080','http://[::1','null',undefined,'http://localhost:'+(Number(base.port)+1),base.origin+'@evil.invalid',base.origin+'#x',base.origin+'/path']){
 const result=await connect(origin);assert.equal(result.connected,false);assert.ok([401,403].includes(result.status));rows.push({kind:'foreign/malformed WS Origin',origin:origin??'(missing)',...result})}
assert.equal(await request(base.host),200);rows.push({kind:'server remains available after malformed requests',status:200});
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({scope:'loopback actual WDS; no production API requests',rows},null,2));console.log(JSON.stringify({passed:rows.length,output}));
})().catch(error=>{console.error(error);process.exitCode=1});
