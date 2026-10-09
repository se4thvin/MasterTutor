"""Fixed P0 health probe: emits counts/categories, never guest log text or env."""
import json
import re
from pathlib import Path
import socket

KEYWORDS = ['pulse', 'dbus', 'gstreamer', 'x11', 'display', 'permission denied', 'connection refused', 'no such file', 'failed', 'panic', 'error', 'invalid', 'not found', 'audio', 'sink', 'socket', 'encoder', 'pipeline', 'clock', 'backend', 'auth', 'member', 'empty']

def main():
    with socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM) as listener:
        listener.bind((socket.VMADDR_CID_ANY, 52)); listener.listen(1)
        while True:
            connection, _ = listener.accept()
            with connection:
                if connection.recv(32) != b'status\n': continue
                result = {}
                for name in ['neko', 'pulseaudio', 'chromium']:
                    result[name] = sum(p.read_text().strip() == name for p in Path('/proc').glob('[0-9]*/comm') if p.exists())
                for name in ['neko', 'pulseaudio']:
                    path = Path('/var/log/neko/' + name + '.log')
                    log = path.read_text(errors='replace').lower() if path.exists() else ''
                    result[name + '_diagnostic_counts'] = {word: log.count(word) for word in KEYWORDS}
                path = Path('/var/log/neko/neko-files.trace')
                trace = path.read_text(errors='replace') if path.exists() else ''
                result['eacces_path_prefix_counts'] = {prefix: sum('EACCES' in line and prefix in line for line in trace.splitlines()) for prefix in ['/root', '/home/neko', '/tmp', '/run', '/dev', '/usr', '/etc', '/proc', '/sys']}
                path = Path('/var/log/neko/neko.log')
                log = path.read_text(errors='replace') if path.exists() else ''
                result['public_source_frames'] = sorted(set(re.findall(r'(?:/src/server/|github.com/m1k1o/neko/server/)[a-z_/]+\.go:[0-9]+', log)))
                connection.sendall(json.dumps(result).encode() + b'\n')

if __name__ == '__main__': main()
