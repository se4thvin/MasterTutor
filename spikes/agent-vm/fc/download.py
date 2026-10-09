#!/usr/bin/env python3
"""Download public CI quickstart artifacts into the spike directory, not host packages."""
import hashlib
import json
from pathlib import Path
import urllib.request

BASE = "https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/20261008-40f3a4819490-0/x86_64/"
images = Path(__file__).parent / "images"
images.mkdir(exist_ok=True)
for source, name in [("vmlinux-6.1.188", "vmlinux"), ("ubuntu-24.04.squashfs", "rootfs.squashfs")]:
    path = images / name
    sha = hashlib.sha256()
    with urllib.request.urlopen(BASE + source, timeout=60) as response, path.open("wb") as out:
        while chunk := response.read(1024 * 1024):
            sha.update(chunk)
            out.write(chunk)
    print(json.dumps({"file": name, "source": BASE + source, "sha256": sha.hexdigest(), "bytes": path.stat().st_size}), flush=True)
