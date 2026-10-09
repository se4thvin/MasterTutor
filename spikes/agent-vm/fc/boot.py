#!/usr/bin/env python3
"""Firecracker quickstart measurement. Runs as fc, never with capabilities."""
import http.client
import json
import math
import os
from pathlib import Path
import select
import socket
import subprocess
import time


def percentile(values, percent):
    if not values:
        raise ValueError("no successful measurements")
    return sorted(values)[math.ceil(len(values) * percent / 100) - 1]


def require_status(status, body):
    if status != 204:
        raise RuntimeError(f"Firecracker API status {status}: {body[:1024]!r}")


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.host)


def api(path, data, method="PUT", socket_path="/run/vm/fc.sock"):
    connection = UnixHTTP(socket_path, timeout=5)
    try:
        connection.request(method, path, json.dumps(data), {"Content-Type": "application/json"})
        response = connection.getresponse()
        require_status(response.status, response.read())
    finally:
        connection.close()


def start_vmm():
    Path("/run/vm/fc.sock").unlink(missing_ok=True)
    process = subprocess.Popen(
        ["firecracker", "--api-sock", "/run/vm/fc.sock"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    deadline = time.monotonic() + 5
    while not Path("/run/vm/fc.sock").exists():
        if process.poll() is not None:
            raise RuntimeError(f"VMM exited: {process.stdout.read(2048)!r}")
        if time.monotonic() > deadline:
            process.kill()
            process.wait()
            raise TimeoutError("VMM API did not appear")
        time.sleep(0.005)
    return process


def main():
    print(json.dumps({"uid": os.getuid(), "swap_max": Path("/sys/fs/cgroup/memory.swap.max").read_text().strip()}), flush=True)
    timings = []
    for run in range(10):
        process = start_vmm()
        try:
            api("/machine-config", {"vcpu_count": 2, "mem_size_mib": 4096})
            api("/boot-source", {"kernel_image_path": "/opt/vm/vmlinux", "boot_args": "console=ttyS0 reboot=k panic=1 pci=off ro"})
            api("/drives/rootfs", {"drive_id": "rootfs", "path_on_host": "/opt/vm/rootfs.ext4", "is_root_device": True, "is_read_only": True})
            status = Path(f"/proc/{process.pid}/status").read_text()
            fields = {line.split(":")[0]: line.split(":", 1)[1].strip() for line in status.splitlines() if line.startswith(("Uid:", "Gid:", "Groups:", "Cap", "Seccomp:", "NoNewPrivs:"))}
            print(json.dumps({"run": run + 1, "vmm_status": fields}), flush=True)
            before = time.monotonic_ns()
            api("/actions", {"action_type": "InstanceStart"})
            serial = b""
            deadline = time.monotonic() + 30
            while b"login:" not in serial:
                ready, _, _ = select.select([process.stdout], [], [], 0.05)
                if ready:
                    chunk = os.read(process.stdout.fileno(), 65536)
                    if not chunk:
                        raise RuntimeError(f"guest exited before login: {serial[-2048:]!r}")
                    serial = (serial + chunk)[-65536:]
                if time.monotonic() > deadline:
                    raise TimeoutError(f"no login prompt: {serial[-2048:]!r}")
            elapsed = (time.monotonic_ns() - before) / 1_000_000
            timings.append(elapsed)
            print(json.dumps({"run": run + 1, "boot_ms": elapsed, "userspace_login": True}), flush=True)
        finally:
            process.kill()
            process.wait()
            process.stdout.close()
    print(json.dumps({"n": len(timings), "boot_p50_ms": percentile(timings, 50), "boot_p95_ms": percentile(timings, 95)}), flush=True)


if __name__ == "__main__":
    main()
