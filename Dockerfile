# syntax=docker/dockerfile:1.7
# Node services. Three targets:
#   node-runtime: agent, migrate, garage-init, observability-init (TS via Node type stripping);
#   web: the Next.js standalone server; observer: the isolated Copilot.
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.34.6 && npm cache clean --force
WORKDIR /repo

FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --store-dir /pnpm/store

FROM fetch AS web-build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm/store --filter "@mastertutor/web..."
RUN pnpm --filter @mastertutor/web build

FROM fetch AS runtime-build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --prod --store-dir /pnpm/store \
      --filter "@mastertutor/agent..." --filter "@mastertutor/observability..."
# Test code never ships (M7): test files, testing/ helpers (a --no-sandbox Chromium launcher,
# fakes) and testing.ts entries. scripts/check-agent-image.sh proves it.
RUN find apps/agent packages -path '*/node_modules' -prune -o \
      \( -name '*.test.ts' -o -name testing -o -name testing.ts \) -print0 | xargs -0 rm -rf
# OCR assets Node never loads (QA-093, ~35 MB): in Node, tesseract.js-core reads each core as
# .js + .wasm (the .wasm.js copies inline the wasm for browsers), and the model is the
# 4.0.0_best_int one (4.0.0 is the legacy model). scripts/check-agent-image.sh proves it.
RUN find node_modules/.pnpm -path '*/node_modules/tesseract.js-core/*.wasm.js' -delete \
 && find node_modules/.pnpm -path '*/node_modules/@tesseract.js-data/eng/4.0.0' -prune \
      -exec rm -rf {} +

FROM fetch AS observer-build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --prod --store-dir /pnpm/store --filter "@mastertutor/observer-service..."
# The Copilot's code index (spec §7.5): built from this context (.dockerignore already drops .git,
# .env*, docs, orchestration and *.md); only the JSON ships, never the tree.
RUN node apps/observer/src/bin/build-code-index.ts /repo /repo/code-index.json
RUN find apps/observer packages -path '*/node_modules' -prune -o \
      \( -name '*.test.ts' -o -name testing -o -name testing.ts \) -print0 | xargs -0 rm -rf

FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS observer
ENV NODE_ENV=production
WORKDIR /app
COPY --from=observer-build --chown=node:node /repo/package.json ./package.json
COPY --from=observer-build --chown=node:node /repo/node_modules ./node_modules
COPY --from=observer-build --chown=node:node /repo/packages ./packages
COPY --from=observer-build --chown=node:node /repo/apps/observer ./apps/observer
COPY --from=observer-build --chown=node:node /repo/code-index.json ./code-index.json
USER node
EXPOSE 4000
CMD ["node", "--import", "./packages/telemetry/src/register-observer.ts", "apps/observer/src/main.ts"]

# Workspace packages stay symlinked outside node_modules, which Node type stripping requires.
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS node-runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-build --chown=node:node /repo/package.json ./package.json
COPY --from=runtime-build --chown=node:node /repo/node_modules ./node_modules
COPY --from=runtime-build --chown=node:node /repo/packages ./packages
COPY --from=runtime-build --chown=node:node /repo/apps/agent ./apps/agent
USER node
CMD ["node", "apps/agent/src/main.ts"]

FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# audio-capture: node-runtime + parec, which records a slot's PulseAudio over TCP (spec §8
# transcribe; B4 review I7). pulseaudio-utils adds ~13 MB; Debian's ffmpeg would add ~570 MB.
FROM node-runtime AS audio-capture
USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends pulseaudio-utils; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*
USER node
CMD ["node", "apps/agent/src/audio/server.ts"]
