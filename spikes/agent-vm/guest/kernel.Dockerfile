FROM debian:trixie-slim AS build
LABEL mt-vm-p0="1"
RUN apt-get update && apt-get install -y --no-install-recommends build-essential bc bison flex libelf-dev libssl-dev curl ca-certificates xz-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSLo kernel.tar.xz https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.1.188.tar.xz && \
    echo 'ed4d0acb1307c235230c89efc094e210e6290593f94a7e617f28b1001101a33a  kernel.tar.xz' | sha256sum -c - && \
    tar -xf kernel.tar.xz --strip-components=1 && rm kernel.tar.xz && \
    curl -fsSLo base.config https://raw.githubusercontent.com/firecracker-microvm/firecracker/v1.17.0/resources/guest_configs/microvm-kernel-ci-x86_64-6.1.config && \
    echo '153ca1b40f3312bfb40b7587b471ea548a915f98f480f0d0892a1537957a2147  base.config' | sha256sum -c -
COPY kernel.config fragment.config
RUN scripts/kconfig/merge_config.sh -m base.config fragment.config && make olddefconfig && \
    grep -x 'CONFIG_VMGENID=y' .config && grep -x 'CONFIG_VIRTIO_VSOCKETS=y' .config && \
    grep -x 'CONFIG_OVERLAY_FS=y' .config && grep -x '# CONFIG_IPV6 is not set' .config && \
    grep -x '# CONFIG_MODULES is not set' .config && make -j4 vmlinux && sha256sum vmlinux
FROM scratch
LABEL mt-vm-p0="1"
COPY --from=build /build/vmlinux /vmlinux
COPY --from=build /build/.config /kernel.config
