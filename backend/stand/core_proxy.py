"""Loopback-only adapter to an existing disposable PHP Core container."""
import argparse
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS')
        self.end_headers()
    def do_GET(self): self.forward()
    def do_POST(self): self.forward()
    def forward(self):
        path=urlsplit(self.path).path
        if not (path.startswith('/taxi/c/local/api/') or path == '/taxi/cache/data_local.js') or urlsplit(self.path).query:
            self.send_error(404);return
        length=int(self.headers.get('Content-Length','0'))
        if length>2_000_000: self.send_error(413);return
        args=[self.server.docker,'exec','-i',self.server.container,'curl','--silent','--show-error','--http1.0','--include','--max-time','20','--request',self.command,'--header','Content-Type: '+self.headers.get('Content-Type','application/x-www-form-urlencoded')]
        if self.command=='POST': args+=['--data-binary','@-']
        args+=['http://127.0.0.1'+path]
        try:
            response=subprocess.run(args,input=self.rfile.read(length),capture_output=True,check=True,timeout=25).stdout
            head,body=response.split(b'\r\n\r\n',1)
            lines=head.decode('latin1').split('\r\n')
            self.send_response(int(lines[0].split()[1]))
            for line in lines[1:]:
                key,_,value=line.partition(':')
                if key.lower() not in {'connection','transfer-encoding','content-length'}: self.send_header(key,value.strip())
            self.send_header('Access-Control-Allow-Origin','*')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers();self.wfile.write(body)
        except (subprocess.SubprocessError,ValueError): self.send_error(503,'Disposable Core unavailable')

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--container',required=True)
    parser.add_argument('--port',type=int,default=18088)
    parser.add_argument('--docker',default='docker')
    args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    server.container,server.docker=args.container,args.docker
    server.serve_forever()
