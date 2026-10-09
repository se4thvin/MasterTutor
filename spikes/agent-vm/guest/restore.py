#!/usr/bin/env python3
"""30 full-snapshot restores under the exact production runtime limits."""
import json
from collections import deque
import os
from pathlib import Path
import queue
import re
import socket
import threading
import time
import urllib.request

from boot import api, percentile, start_vmm


def parse_identity(line):
    match = re.fullmatch(r"P0_ID boot_id=([0-9a-f-]{36}) urandom=([0-9a-f]{32}) clock=([0-9]{10}) leftover=(absent|present)", line)
    if not match:
        raise ValueError("invalid public identity measurement")
    return dict(zip(["boot_id", "urandom", "clock", "leftover"], [match[1], match[2], int(match[3]), match[4]]))


class Serial:
    def __init__(self, process):
        self.identities = queue.Queue()
        self.errors = []
        self.bootstrap = deque(maxlen=120)
        self.thread = threading.Thread(target=self.read, args=(process,), daemon=True)
        self.thread.start()

    def read(self, process):
        for raw in process.stdout:
            line = raw.decode("utf8", "replace").strip()
            self.bootstrap.append(line[:500])
            if line.startswith("P0_ID "):
                self.identities.put(parse_identity(line))
            # Never copy arbitrary guest output into host logs.
            if "Kernel panic" in line or line.startswith("P0_FAIL"):
                self.errors.append(line[:200])


def spawn():
    Path("/run/vm/vsock.sock").unlink(missing_ok=True)
    process = start_vmm()
    return process, Serial(process)


def stop(process, serial):
    process.kill()
    process.wait()
    serial.thread.join(timeout=2)
    process.stdout.close()


def start_line():
    deadline = time.monotonic() + 5
    while True:
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.settimeout(0.5)
        try:
            connection.connect("/run/vm/vsock.sock")
            connection.sendall(b"CONNECT 51\n")
            reply = b""
            while not reply.endswith(b"\n") and len(reply) < 64:
                chunk = connection.recv(1)
                if not chunk:
                    raise ConnectionError("vsock handshake closed")
                reply += chunk
            if not reply.startswith(b"OK "):
                raise ConnectionError("vsock handshake refused")
            connection.sendall(f"start {time.time_ns() // 1_000_000}\n".encode())
            return
        except (OSError, ConnectionError):
            if time.monotonic() >= deadline:
                raise TimeoutError("restored vsock listener did not accept within 5 seconds")
            time.sleep(0.02)
        finally:
            connection.close()


def fresh_cdp(previous):
    deadline = time.monotonic() + 30
    # Explicitly ignore ambient proxy environment; only the isolated guest address is read.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while time.monotonic() < deadline:
        try:
            with opener.open("http://192.168.127.2:9223/json/version", timeout=0.5) as response:
                data = json.load(response)
                identity = data["webSocketDebuggerUrl"].rsplit("/", 1)[1]
                if identity != previous:
                    return identity
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(0.02)
    raise TimeoutError("no fresh CDP id within 30 seconds")


def create_golden():
    """One source of the spike guest configuration and golden snapshot point."""
    host_path = Path("/run/vm/vsock.sock_1025")
    host_path.unlink(missing_ok=True)
    process = None
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as golden:
            golden.bind(str(host_path))
            golden.listen(1)
            golden.settimeout(30)
            process, serial = spawn()
            api("/machine-config", {"vcpu_count": 2, "mem_size_mib": 4096})
            api("/boot-source", {"kernel_image_path": "/opt/vm/vmlinux", "boot_args": "console=ttyS0 reboot=k panic=1 pci=off ro init=/sbin/vm-init"})
            api("/drives/rootfs", {"drive_id": "rootfs", "path_on_host": "/opt/vm/rootfs.ext4", "is_root_device": True, "is_read_only": True})
            api("/network-interfaces/eth0", {"iface_id": "eth0", "host_dev_name": "tap0", "guest_mac": "06:00:ac:10:00:02"})
            api("/vsock", {"guest_cid": 3, "uds_path": "/run/vm/vsock.sock"})
            api("/actions", {"action_type": "InstanceStart"})
            try:
                connection, _ = golden.accept()
            except TimeoutError:
                # Before golden there are no apps, page content, or credentials in this guest.
                print(json.dumps({"bootstrap_failure": list(serial.bootstrap)}), flush=True)
                raise
            with connection:
                if connection.recv(64) != b"golden\n":
                    raise RuntimeError("invalid golden notification")
            api("/vm", {"state": "Paused"}, "PATCH")
            api("/snapshot/create", {"snapshot_type": "Full", "snapshot_path": "/run/vm/golden.vmstate", "mem_file_path": "/run/vm/golden.mem"})
            print(json.dumps({"golden": True, "mem_bytes": Path("/run/vm/golden.mem").stat().st_size}), flush=True)
            stop(process, serial)
            process = None
        host_path.unlink(missing_ok=True)
    finally:
        if process is not None:
            stop(process, serial)


def main():
    process = None
    try:
        create_golden()
        resumed, ready, identities = [], [], []
        previous = None
        for run in range(30):
            process, serial = spawn()
            before = time.monotonic_ns()
            api("/snapshot/load", {"snapshot_path": "/run/vm/golden.vmstate", "mem_backend": {"backend_type": "File", "backend_path": "/run/vm/golden.mem"}, "resume_vm": True})
            load_ms = (time.monotonic_ns() - before) / 1_000_000
            start_line()
            identity = serial.identities.get(timeout=10)
            identity["clock_delta_s"] = abs(identity["clock"] - int(time.time()))
            previous = fresh_cdp(previous)
            cdp_ms = (time.monotonic_ns() - before) / 1_000_000
            resumed.append(load_ms)
            ready.append(cdp_ms)
            identities.append(identity)
            status = Path(f"/proc/{process.pid}/status").read_text()
            caps = {line.split(":")[0]: line.split(":", 1)[1].strip() for line in status.splitlines() if line.startswith(("CapEff:", "Seccomp:"))}
            print(json.dumps({"run": run + 1, "load_resumed_ms": load_ms, "load_cdp_ms": cdp_ms, "cdp_id": previous, "identity": identity, "vmm_status": caps, "memory_current": int(Path("/sys/fs/cgroup/memory.current").read_text())}), flush=True)
            stop(process, serial)
            process = None
        peak = int(Path("/sys/fs/cgroup/memory.peak").read_text())
        print(json.dumps({"n": 30, "resumed_p50_ms": percentile(resumed, 50), "resumed_p95_ms": percentile(resumed, 95), "cdp_p50_ms": percentile(ready, 50), "cdp_p95_ms": percentile(ready, 95), "memory_peak": peak, "boot_id_unique": len({i['boot_id'] for i in identities}), "urandom_unique": len({i['urandom'] for i in identities}), "leftover_absent": all(i['leftover'] == 'absent' for i in identities), "clock_max_delta_s": max(i['clock_delta_s'] for i in identities), "vsock_start": "listen51"}), flush=True)
    finally:
        if process is not None:
            stop(process, serial)


if __name__ == "__main__":
    main()
