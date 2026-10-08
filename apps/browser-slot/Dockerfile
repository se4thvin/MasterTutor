# Browser slot (spec §3.1, run 15 §8): n.eko v3.1.6 (Apache-2.0, amd64+arm64) + headed
# Chromium with its sandbox + socat CDP proxy + an iptables ingress/egress filter.
#
# n.eko v3.1.6's server (Apache-2.0), rebuilt from its tag with one pion/ice v4.2.2 (MIT) fix (I1,
# group-2-report.md §11): behind 1:1 NAT the ICE-TCP mux handed the browser's connection to a conn
# no ICE agent read, so the live video sometimes never started. Build-only stage: only the binary
# and the licences reach the slot image.
FROM golang:1.25-trixie@sha256:2c4c60ef415fbfa5e90300722293bef36c5e63fae17570ce18f580af933dbd73 AS neko-server
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        libx11-dev libxrandr-dev libxtst-dev libgtk-3-dev libxcvt-dev \
        libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev; \
    rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN set -eux; \
    git init -q .; \
    git fetch -q --depth 1 https://github.com/m1k1o/neko.git 65fba485de2987998c7028b04240b21669d674e0; \
    git checkout -q FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = 65fba485de2987998c7028b04240b21669d674e0
COPY neko/pion-ice-v4.2.2-tcp-mux-nat.patch /tmp/
WORKDIR /src/server
# pion/ice v4.2.2 comes from the module proxy, checked against n.eko's go.sum, then patched; the
# patch's own test (and the mux's) must pass before the server is built against it.
RUN set -eux; \
    dir="$(go mod download -json github.com/pion/ice/v4 | sed -n 's/^\t"Dir": "\(.*\)",$/\1/p')"; \
    cp -r "$dir" /pion-ice; \
    chmod -R u+w /pion-ice; \
    cd /pion-ice; \
    git apply /tmp/pion-ice-v4.2.2-tcp-mux-nat.patch; \
    go test -count=1 -run 'TestTCPMux' .; \
    cd /src/server; \
    go mod edit -replace github.com/pion/ice/v4=/pion-ice; \
    go build -trimpath -o /neko -ldflags "-s -w \
        -X 'github.com/m1k1o/neko/server.gitCommit=65fba48' \
        -X 'github.com/m1k1o/neko/server.gitTag=v3.1.6+mt-pion-tcp-mux'" \
        cmd/neko/main.go

FROM ghcr.io/m1k1o/neko/chromium:3.1.6@sha256:2471119c7b4010067f76f3421a78a8bcf35e3c223b2d1f4db084914ec915fb30

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends socat iptables xprintidle; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# n.eko's Xorg dummy config has no 1280x800 mode; add a GTF 30 Hz modeline and prefer it.
RUN set -eux; \
    sed -i 's/^\(\s*\)Modeline "1280x720_30.00".*/&\n\1Modeline "1280x800_30.00" 37.90 1280 1288 1416 1552 800 801 804 814 -HSync +Vsync/' /etc/neko/xorg.conf; \
    sed -i 's/Modes "1920x1080_60.00"/Modes "1280x800_30.00" "1920x1080_60.00"/' /etc/neko/xorg.conf; \
    grep -q 'Modeline "1280x800_30.00" 37.90' /etc/neko/xorg.conf

COPY --from=neko-server /neko /usr/bin/neko
COPY --from=neko-server /src/LICENSE /usr/share/doc/neko/LICENSE
COPY --from=neko-server /pion-ice/LICENSE /usr/share/doc/neko/pion-ice.LICENSE
COPY supervisord/chromium.conf /etc/neko/supervisord/chromium.conf
COPY policies.json /etc/chromium/policies/managed/policies.json
COPY --chmod=0755 bin/slot-entrypoint bin/exit-on-chromium bin/slot-health bin/slot-idle-http /usr/local/bin/

# NEKO_LEGACY: the bundled client speaks the legacy /ws protocol.
# Cookie auth: web relays NEKO_SESSION scoped to /live/<runId>/; the legacy /ws handler
# authenticates with that cookie (whoami) before any password. n.eko's own Set-Cookie never
# reaches browsers (web re-issues the token), so it need not be Secure.
# Implicit hosting off and the user member unhosted (entrypoint): only the agent grants control.
# Chat off: the n.eko page is served same-origin, so it must render no attacker-controlled text (S4).
# ICE servers: none (D42; self-hosted only). With both lists empty n.eko falls back to
# stun:stun.l.google.com for its own gathering and sends it to every viewer's browser
# (config/webrtc.go). One server with no URLs disables that fallback and contacts nobody.
ENV NEKO_DESKTOP_SCREEN=1280x800@30 \
    NEKO_WEBRTC_ICESERVERS_FRONTEND='[]' \
    NEKO_WEBRTC_ICESERVERS_BACKEND='[{"urls":[]}]' \
    NEKO_LOG_LEVEL=warn \
    NEKO_FILETRANSFER_ENABLED=false \
    NEKO_LEGACY=true \
    NEKO_SESSION_COOKIE_ENABLED=true \
    NEKO_SESSION_COOKIE_SECURE=false \
    NEKO_SESSION_IMPLICIT_HOSTING=false \
    NEKO_DESKTOP_FILE_CHOOSER_DIALOG=true \
    NEKO_DESKTOP_UPLOAD_DROP=true \
    NEKO_CHAT_ENABLED=false

HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=6 CMD ["/usr/local/bin/slot-health"]
ENTRYPOINT ["/usr/local/bin/slot-entrypoint"]
CMD ["/usr/bin/supervisord", "-c", "/etc/neko/supervisord.conf"]
