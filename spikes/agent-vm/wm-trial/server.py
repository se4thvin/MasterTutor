"""Spike relay, on the private cdp network only. No credentials in this process."""
import http.server
import json
import socket
import sys
sys.path.insert(0,'/opt/spike')
from restore import create_golden, spawn, stop, start_line, fresh_cdp
from boot import api


def rpc(data):
    encoded = json.dumps(data).encode()+b'\n'
    if len(encoded)>65536: raise ValueError('request too large')
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as connection:
        connection.settimeout(30); connection.connect('/run/vm/vsock.sock'); connection.sendall(b'CONNECT 52\n')
        reply=b''
        while not reply.endswith(b'\n') and len(reply)<64: reply+=connection.recv(1)
        if not reply.startswith(b'OK '): raise ConnectionError('vsock refused')
        connection.sendall(encoded)
        with connection.makefile('rb') as stream:
            result=stream.readline(16*1024*1024)
        return json.loads(result)


def main():
    process=None
    try:
        create_golden(); process,serial=spawn()
        api('/snapshot/load',{'snapshot_path':'/run/vm/golden.vmstate','mem_backend':{'backend_type':'File','backend_path':'/run/vm/golden.mem'},'resume_vm':True})
        start_line(); fresh_cdp(None)
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_POST(self):
                try:
                    size=int(self.headers.get('Content-Length','0'))
                    if self.path!='/rpc' or not 0<size<=65536: raise ValueError('invalid request')
                    result=rpc(json.loads(self.rfile.read(size)))
                    payload=json.dumps(result).encode()
                    self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(payload))); self.end_headers(); self.wfile.write(payload)
                except Exception:
                    self.send_response(400); self.end_headers()
        print(json.dumps({'trial_ready':True}),flush=True)
        http.server.ThreadingHTTPServer(('0.0.0.0',9226),Handler).serve_forever()
    finally:
        if process is not None: stop(process,serial)
if __name__=='__main__': main()
