# syntax=docker/dockerfile:1.7
# Test-only images for compose.test.yml (never production):
#   tools: the repo with its workspace dependencies, for llm-mock and the vault-fixture site
#          (Node type stripping, like the node-runtime image);
#   e2e:   tools plus Playwright's Chromium, for apps/web/playwright.stack.config.ts.
FROM node:24-slim AS tools
# Corepack installs the pnpm that package.json's packageManager names: one source for the version.
# Its cache is readable by any user, since the services and the e2e runner do not run as root.
ENV CI=true COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
COPY package.json ./
RUN corepack enable && corepack install && chmod -R a+rX /opt/corepack
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
# Bundle the React login fixture now: its container runs as `node`, which cannot write to /repo.
RUN node -e 'import("./tests/fixtures/vault-sites/build-react.ts").then((m) => m.buildReactLogin())'

FROM tools AS e2e
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm --filter @mastertutor/web exec playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo/apps/web
CMD ["pnpm", "exec", "playwright", "test", "--config", "playwright.stack.config.ts"]
