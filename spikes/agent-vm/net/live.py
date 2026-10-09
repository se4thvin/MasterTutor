"""Hold one restored guest; auth values exist in memory only, never in output."""
import base64
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sys
import time
import urllib.request
sys.path.insert(0, '/opt/spike')
from restore import spawn, stop, fresh_cdp
from boot import api

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def main():
    process = None
    try:
        path = Path('/run/vm/vsock.sock_1025')
        path.unlink(missing_ok=True)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as golden:
            golden.bind(str(path)); golden.listen(1); golden.settimeout(30)
            process, serial = spawn()
            api('/machine-config', {'vcpu_count': 2, 'mem_size_mib': 4096})
            api('/boot-source', {'kernel_image_path': '/opt/vm/vmlinux', 'boot_args': 'console=ttyS0 reboot=k panic=1 pci=off ro init=/sbin/vm-init'})
            api('/drives/rootfs', {'drive_id': 'rootfs', 'path_on_host': '/opt/vm/rootfs.ext4', 'is_root_device': True, 'is_read_only': True})
            api('/network-interfaces/eth0', {'iface_id': 'eth0', 'host_dev_name': 'tap0', 'guest_mac': '06:00:ac:10:00:02'})
            api('/vsock', {'guest_cid': 3, 'uds_path': '/run/vm/vsock.sock'})
            api('/actions', {'action_type': 'InstanceStart'})
            connection, _ = golden.accept()
            with connection:
                if connection.recv(64) != b'golden\n': raise RuntimeError('invalid golden notification')
            api('/vm', {'state': 'Paused'}, 'PATCH')
            api('/snapshot/create', {'snapshot_type': 'Full', 'snapshot_path': '/run/vm/golden.vmstate', 'mem_file_path': '/run/vm/golden.mem'})
            stop(process, serial); process = None
        path.unlink(missing_ok=True)
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
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as diagnostic:
                        diagnostic.settimeout(2); diagnostic.connect('/run/vm/vsock.sock'); diagnostic.sendall(b'CONNECT 52\n')
                        reply = b''
                        while not reply.endswith(b'\n') and len(reply) < 64: reply += diagnostic.recv(1)
                        diagnostic.sendall(b'status\n')
                        print(diagnostic.recv(8192).decode(), flush=True)
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
