"""Hold one restored guest; auth values exist in memory only, never in output."""
import base64
import http.server
import json
import re
import secrets
import socket
import sys
import time
import urllib.request
sys.path.insert(0, '/opt/spike')
from restore import spawn, stop, fresh_cdp, create_golden
from boot import api

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def main():
    process = None
    try:
        create_golden()
        process, serial = spawn()
        api('/snapshot/load', {'snapshot_path': '/run/vm/golden.vmstate', 'mem_backend': {'backend_type': 'File', 'backend_path': '/run/vm/golden.mem'}, 'resume_vm': True})
        password = secrets.token_hex(24)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(5); connection.connect('/run/vm/vsock.sock')
            connection.sendall(b'CONNECT 51\n')
            reply = b''
            while not reply.endswith(b'\n') and len(reply) < 64: reply += connection.recv(1)
            if not reply.startswith(b'OK '): raise RuntimeError('vsock handshake refused')
            data = base64.b64encode(json.dumps({'password': password}).encode())
            connection.sendall(b'start ' + str(time.time_ns() // 1_000_000).encode() + b' ' + data + b'\n')
        fresh_cdp(None)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        deadline = time.monotonic() + 30
        last_status = None
        while True:
            try:
                request = urllib.request.Request('http://192.168.127.2:8080/api/login', data=json.dumps({'username': 'agent', 'password': password}).encode(), headers={'content-type': 'application/json'})
                with opener.open(request, timeout=2) as response:
                    cookies = response.headers.get_all('Set-Cookie') or []
                    payload = response.read(4096)
                body = {}
                if not any(c.startswith("NEKO_SESSION=") for c in cookies):
                    body = json.loads(payload)
                token = next((c.split(';')[0].split('=', 1)[1] for c in cookies if c.startswith('NEKO_SESSION=')), body.get('token'))
                if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,256}', token): raise ValueError('invalid token')
                break
            except (OSError, ValueError) as error:
                last_status = getattr(error, "code", type(error).__name__)
                if time.monotonic() > deadline:
                    print(json.dumps({"neko_login_failure_kind": last_status}), flush=True)
                    raise RuntimeError('Neko login did not become ready') from None
                time.sleep(.1)
        del password, data, request, cookies, body, payload
        class Auth(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                if self.path != '/auth' or not self.headers.get('X-Forwarded-Uri', '').startswith('/live/00000000-0000-4000-8000-000000000001/'):
                    self.send_response(403); self.end_headers(); return
                self.send_response(200)
                self.send_header('Cookie', 'NEKO_SESSION=' + token)
                self.end_headers()
        print(json.dumps({'live_ready': True, 'credential_storage': 'memory-only'}), flush=True)
        http.server.ThreadingHTTPServer(('0.0.0.0', 9226), Auth).serve_forever()
    finally:
        if process is not None: stop(process, serial)

if __name__ == '__main__': main()
