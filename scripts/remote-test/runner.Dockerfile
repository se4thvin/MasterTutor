# The test runner image for the shared CI host (scripts/remote-test.sh). Node 24 plus what the
# suites shell out to: the Docker CLI with Compose and Buildx (they drive the host daemon through
# the mounted socket), the pinned pnpm, and Playwright's Chromium for the vault integration tests.
# run-on-host.sh builds it once per content hash; the repo itself is mounted, never copied in.
FROM docker:29.2.1-cli AS docker-cli

FROM node:24-bookworm
ARG PNPM_VERSION
ARG PLAYWRIGHT_VERSION
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
# The runner runs as the host user, so the shared pnpm store (a named volume seeded from
# /pnpm-store on first use) must be writable by it.
RUN corepack enable \
 && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
 && npx --yes "playwright-core@${PLAYWRIGHT_VERSION}" install --with-deps chromium \
 && rm -rf /root/.npm /var/lib/apt/lists/* \
 && chmod -R a+rX /opt/corepack /opt/ms-playwright \
 && mkdir /pnpm-store && chmod 1777 /pnpm-store
LABEL mastertutor.ci=1
