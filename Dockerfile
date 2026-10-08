# syntax=docker/dockerfile:1.7
# Node services. Two targets:
#   node-runtime: agent, migrate, garage-init (TS via Node type stripping);
#   web: the Next.js standalone server.
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
    pnpm install --frozen-lockfile --offline --prod --store-dir /pnpm/store --filter "@mastertutor/agent..."
# Test code never ships (M7): test files, testing/ helpers (a --no-sandbox Chromium launcher,
# fakes) and testing.ts entries. scripts/check-agent-image.sh proves it.
RUN find apps/agent packages -path '*/node_modules' -prune -o \
      \( -name '*.test.ts' -o -name testing -o -name testing.ts \) -print0 | xargs -0 rm -rf
# OCR assets Node never loads (QA-093, ~45 MB): tesseract.js reads an LSTM core as .js + .wasm
# (the .wasm.js inlines it for browsers; the non-LSTM cores serve OEMs we never ask for) and the
# 4.0.0_best_int model (4.0.0 is the legacy one). scripts/check-agent-image.sh proves it.
RUN find node_modules/.pnpm -path '*/node_modules/tesseract.js-core/tesseract-core*' \
      ! -name 'tesseract-core*-lstm.js' ! -name 'tesseract-core*-lstm.wasm' -delete \
 && find node_modules/.pnpm -path '*/node_modules/@tesseract.js-data/eng/4.0.0' -prune \
      -exec rm -rf {} +

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
