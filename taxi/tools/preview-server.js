const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon'};
function createPreviewServer(root=path.resolve(__dirname,'..')){
 let graphZip;
 return http.createServer(async(req,res)=>{
  let url;try{url=new URL(req.url,'http://localhost');url.pathname=decodeURIComponent(url.pathname)}catch{res.writeHead(400);res.end();return}
  const relative=path.normalize(url.pathname).replace(/^[/\\]+/,''),bases=[path.join(root,'.preview'),path.join(root,'public')];
  let file=bases.map(base=>path.resolve(base,relative)).find((p,i)=>p.startsWith(bases[i]+path.sep)&&fs.existsSync(p)&&fs.statSync(p).isFile());
  if(!file&&!path.extname(url.pathname))file=path.join(root,'.preview/index.html');
  if(!file||!fs.existsSync(file)){res.writeHead(404);res.end('Not found');return}
  const stat=fs.statSync(file),etag=`W/"${stat.size}-${stat.mtimeMs}"`,graph=url.pathname==='/mock/agadir.json';
  const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':graph&&/^[a-f0-9]{64}$/.test(url.searchParams.get('v')||'')?'public, max-age=31536000, immutable':'no-cache','ETag':etag,'Last-Modified':stat.mtime.toUTCString(),'X-Content-Type-Options':'nosniff','Vary':'Accept-Encoding'};
  if(req.headers['if-none-match']===etag){res.writeHead(304,headers);res.end();return}
  if(graph&&/\bgzip\b/.test(req.headers['accept-encoding']||'')){
   try{
    if(!graphZip||graphZip.etag!==etag)graphZip={etag,pending:new Promise((resolve,reject)=>fs.readFile(file,(error,bytes)=>error?reject(error):zlib.gzip(bytes,(error,zipped)=>error?reject(error):resolve(zipped))))};
    const bytes=await graphZip.pending;res.writeHead(200,{...headers,'Content-Encoding':'gzip','Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);
   }catch{res.writeHead(500);res.end('Asset unavailable')}
   return
  }
  res.writeHead(200,{...headers,'Content-Length':stat.size});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
 });
}
module.exports={createPreviewServer};
