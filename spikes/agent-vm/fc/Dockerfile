FROM debian:trixie-slim AS rootfs
LABEL mt-vm-p0="1"
RUN apt-get update && apt-get install -y --no-install-recommends squashfs-tools e2fsprogs && rm -rf /var/lib/apt/lists/*
COPY images/rootfs.squashfs /tmp/rootfs.squashfs
RUN echo '1d50b8fff4410e9fbe29de5b65f4a4b74efb901ab14071288cd8fb4a753f0fdd  /tmp/rootfs.squashfs' | sha256sum -c -
RUN unsquashfs -processors 4 -d /tree /tmp/rootfs.squashfs && rm -rf /tree/root/.ssh /tree/home/*/.ssh && \
    sed -i 's/^\([^:]*\):[^:]*:/\1:!:/' /tree/etc/shadow && \
    truncate -s 1G /rootfs.ext4 && mkfs.ext4 -q -F -d /tree -L mtquickstart /rootfs.ext4

FROM debian:trixie-slim
LABEL mt-vm-p0="1"
ARG FIRECRACKER_VERSION=v1.17.0
ARG FIRECRACKER_SHA256=06094a1108ae9e82aa4c23a775aa92758f53f1175d422270d9d6162cb9ade558
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl iproute2 util-linux socat python3 libcap2-bin && \
    curl -fsSLo /tmp/fc.tgz "https://github.com/firecracker-microvm/firecracker/releases/download/${FIRECRACKER_VERSION}/firecracker-${FIRECRACKER_VERSION}-x86_64.tgz" && \
    echo "${FIRECRACKER_SHA256}  /tmp/fc.tgz" | sha256sum -c - && \
    tar -xzf /tmp/fc.tgz -C /tmp && install -m 0755 /tmp/release-*/firecracker-${FIRECRACKER_VERSION}-x86_64 /usr/local/bin/firecracker && \
    useradd -u 10001 -U -M fc && rm -rf /tmp/* /var/lib/apt/lists/*
COPY --from=rootfs /rootfs.ext4 /opt/vm/rootfs.ext4
COPY images/vmlinux /opt/vm/vmlinux
RUN echo '6e105082d617064296680262ddf53844f292da803165e74e1a4f051940de48ef  /opt/vm/vmlinux' | sha256sum -c -
COPY boot.py /opt/spike/boot.py
COPY boot.sh /usr/local/bin/boot.sh
ENTRYPOINT ["/bin/bash", "/usr/local/bin/boot.sh"]
