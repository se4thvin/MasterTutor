FROM mt-vm-p0-browser-slot:local AS guest
LABEL mt-vm-p0="1"
RUN apt-get update && apt-get install -y --no-install-recommends python3 iproute2 util-linux strace && rm -rf /var/lib/apt/lists/* && \
    mkdir -p /mnt/rw /etc/guest/programs /opt/spike && \
    rm -rf /root/.ssh /home/*/.ssh && sed -i 's/^\([^:]*\):[^:]*:/\1:!:/' /etc/shadow
COPY --chmod=0755 vm-init /sbin/vm-init
COPY fixture /opt/spike/fixture
COPY start_line.py diagnostic.py /opt/spike/
COPY supervisord.conf /etc/guest/supervisord.conf
# Preserve the actual lineage command/flags; only replace environment interpolation.
RUN python3 - <<'PY'
from pathlib import Path
import os, re, shlex
keys = ['PULSE_SERVER', 'NEKO_SERVER_BIND', 'NEKO_DESKTOP_SCREEN', 'NEKO_WEBRTC_ICESERVERS_FRONTEND', 'NEKO_WEBRTC_ICESERVERS_BACKEND',
        'NEKO_LOG_LEVEL', 'NEKO_FILETRANSFER_ENABLED', 'NEKO_LEGACY', 'NEKO_SESSION_COOKIE_ENABLED',
        'NEKO_SESSION_COOKIE_SECURE', 'NEKO_SESSION_IMPLICIT_HOSTING', 'NEKO_DESKTOP_FILE_CHOOSER_DIALOG',
        'NEKO_DESKTOP_UPLOAD_DROP', 'NEKO_CHAT_ENABLED']
Path('/opt/spike/static-neko.sh').write_text('\n'.join('export ' + key + '=' + shlex.quote(os.environ[key]) for key in keys) + '\n')
source = Path('/etc/neko/supervisord/chromium.conf').read_text()
blocks = re.split(r'(?=^\[)', source, flags=re.M)
for block in blocks:
    if any(block.startswith('[program:' + name + ']') for name in ['chromium', 'cdp-proxy', 'idle-probe']):
        block = block.replace('%(ENV_USER)s', 'neko').replace('%(ENV_DISPLAY)s', ':99.0')
        name = block.split(']', 1)[0].split(':', 1)[1]
        Path('/etc/guest/programs/' + name + '.conf').write_text(block)
for path in [Path('/etc/neko/supervisord.conf'), *Path('/etc/neko/supervisord').glob('*.conf')]:
    for block in re.split(r'(?=^\[)', path.read_text(), flags=re.M):
        if block.startswith('[program:neko]') or block.startswith('[program:pulseaudio]'):
            name = block.split(']', 1)[0].split(':', 1)[1]
            Path('/etc/guest/programs/' + name + '.conf').write_text(block.replace('%(ENV_USER)s', 'neko').replace('%(ENV_DISPLAY)s', ':99.0'))
assert Path('/etc/guest/programs/neko.conf').exists()
assert Path('/etc/guest/programs/pulseaudio.conf').exists()
PY

FROM debian:trixie-slim AS rootfs
LABEL mt-vm-p0="1"
RUN apt-get update && apt-get install -y --no-install-recommends e2fsprogs && rm -rf /var/lib/apt/lists/*
COPY --from=guest / /tree
RUN test "$(stat -c %u /tree/home/neko)" = 1000
RUN size=$(du -sb /tree | cut -f1) && size=$(( (size * 110 / 100 / 1048576 + 128) * 1048576 )) && \
    truncate -s "$size" /rootfs.ext4 && mkfs.ext4 -q -F -d /tree -L mtguest /rootfs.ext4 && \
    stat -c 'rootfs_bytes=%s' /rootfs.ext4
FROM scratch AS artifacts
LABEL mt-vm-p0="1"
COPY --from=rootfs /rootfs.ext4 /rootfs.ext4
