const {createPreviewServer}=require('../../tools/preview-server')
const http=require('http'),zlib=require('zlib'),fs=require('fs'),path=require('path')
function get(port,headers={}){return new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path:'/mock/agadir.json',headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}))}).on('error',reject)})}
test('graph HTTP responds with gzip and body-free 304 while keeping decompressed bytes identical',async()=>{
 const server=createPreviewServer(path.resolve('.'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const first=await get(server.address().port,{'Accept-Encoding':'gzip'}),second=await get(server.address().port,{'If-None-Match':first.headers.etag})
  expect(first.headers['content-encoding']).toBe('gzip');expect(first.body.length).toBeLessThan(3000000)
  expect(zlib.gunzipSync(first.body).equals(fs.readFileSync('public/mock/agadir.json'))).toBe(true)
  expect(second.status).toBe(304);expect(second.body.length).toBe(0)
 }finally{await new Promise(resolve=>server.close(resolve))}
})
