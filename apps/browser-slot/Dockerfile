# Browser slot (spec §3.1, run 15 §8): n.eko v3.1.6 (Apache-2.0, amd64+arm64) + headed
# Chromium with its sandbox + socat CDP proxy + an iptables ingress/egress filter.
FROM ghcr.io/m1k1o/neko/chromium:3.1.6

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends socat iptables; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# n.eko's Xorg dummy config has no 1280x800 mode; add a GTF 30 Hz modeline and prefer it.
RUN set -eux; \
    sed -i 's/^\(\s*\)Modeline "1280x720_30.00".*/&\n\1Modeline "1280x800_30.00" 37.90 1280 1288 1416 1552 800 801 804 814 -HSync +Vsync/' /etc/neko/xorg.conf; \
    sed -i 's/Modes "1920x1080_60.00"/Modes "1280x800_30.00" "1920x1080_60.00"/' /etc/neko/xorg.conf; \
    grep -q 'Modeline "1280x800_30.00" 37.90' /etc/neko/xorg.conf

COPY supervisord/chromium.conf /etc/neko/supervisord/chromium.conf
COPY policies.json /etc/chromium/policies/managed/policies.json
COPY --chmod=0755 bin/slot-entrypoint bin/exit-on-chromium bin/slot-health /usr/local/bin/

ENV NEKO_DESKTOP_SCREEN=1280x800@30 \
    NEKO_LOG_LEVEL=warn \
    NEKO_FILETRANSFER_ENABLED=false

HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=6 CMD ["/usr/local/bin/slot-health"]
ENTRYPOINT ["/usr/local/bin/slot-entrypoint"]
CMD ["/usr/bin/supervisord", "-c", "/etc/neko/supervisord.conf"]
