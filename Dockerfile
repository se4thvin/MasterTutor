# syntax=docker/dockerfile:1.7
# Node services. Two targets:
#   node-runtime: agent, migrate, garage-init (TS via Node type stripping);
#   web: the Next.js standalone server.
FROM node:24-slim AS base
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

# Workspace packages stay symlinked outside node_modules, which Node type stripping requires.
FROM node:24-slim AS node-runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-build --chown=node:node /repo/package.json ./package.json
COPY --from=runtime-build --chown=node:node /repo/node_modules ./node_modules
COPY --from=runtime-build --chown=node:node /repo/packages ./packages
COPY --from=runtime-build --chown=node:node /repo/apps/agent ./apps/agent
USER node
CMD ["node", "apps/agent/src/main.ts"]

FROM node:24-slim AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
