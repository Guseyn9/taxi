'use strict';
// Disposable loopback fixture. No production configuration, tokens or account files.
const http = require('node:http'), net = require('node:net'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../.preview/fsm');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const target = pathname.startsWith('/fsm/') ? [18089, req.url.slice(4)] : pathname.startsWith('/core/') ? [18088, '/taxi/c/local/api/v1' + req.url.slice(5)] : null;
  if (target) {
    const upstream = http.request({host:'127.0.0.1',port:target[0],path:target[1],method:req.method,headers:{...req.headers,host:`127.0.0.1:${target[0]}`}}, reply => {res.writeHead(reply.statusCode, reply.headers);reply.pipe(res)});
    upstream.on('error', () => {res.writeHead(503);res.end('Local service unavailable')}); req.pipe(upstream); return;
  }
  const file = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) {res.writeHead(403);res.end();return}
  fs.readFile(file, (error, data) => {
    if (error) {res.writeHead(404);res.end();return}
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');res.end(data);
  });
});
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/fsm/api/realtime/ws/')) {socket.destroy();return}
  const upstream = net.connect(18089, '127.0.0.1', () => {
    upstream.write(`GET ${req.url.slice(4)} HTTP/1.1\r\n` + Object.entries({...req.headers,host:'127.0.0.1:18089'}).map(([key,value]) => `${key}: ${value}`).join('\r\n') + '\r\n\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream);upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());socket.on('error', () => upstream.destroy());socket.on('close', () => upstream.destroy());
});
server.listen(18090, '127.0.0.1', () => console.log('Local FSM acceptance: http://127.0.0.1:18090'));
