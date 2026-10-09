FROM mt-vm-p0-firecracker:1.17.0
LABEL mt-vm-p0="1"
COPY images/vmlinux /opt/vm/vmlinux
COPY images/rootfs.ext4 /opt/vm/rootfs.ext4
COPY restore.py /opt/spike/restore.py
COPY restore-entry.sh /opt/spike/restore-entry.sh
ENTRYPOINT ["/bin/bash", "/opt/spike/restore-entry.sh"]
