# syntax=docker/dockerfile:1
# Multi-stage build (skill: okf-docker-dev): a small non-root runtime image with
# no dev dependencies or secrets in the final layer.

FROM node:22.12.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# The corepack bundled with this Node image predates pnpm's current signing key and
# fails "Cannot find matching keyid" on install; update corepack itself before enabling.
RUN npm install -g corepack@latest && corepack enable
WORKDIR /app

# ---- deps: install with the lockfile, no scripts we did not vet ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/okf-core/package.json      packages/okf-core/
COPY packages/logger/package.json        packages/logger/
COPY packages/activity/package.json      packages/activity/
COPY packages/providers/package.json     packages/providers/
COPY packages/db/package.json            packages/db/
COPY packages/queue/package.json         packages/queue/
COPY packages/pipeline/package.json      packages/pipeline/
COPY packages/publisher-cli/package.json packages/publisher-cli/
COPY workers/package.json                workers/
COPY apps/web/package.json               apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: compile every workspace package, then the Next app ----
FROM deps AS build
COPY . .
RUN pnpm --filter @okf-anchor/db generate \
 && pnpm -r --workspace-concurrency=1 --filter "./packages/**" run build \
 && pnpm --filter @okf-anchor/workers run build \
 && pnpm --filter @okf-anchor/web run build

# ---- runner: Next standalone + the worker bundle ----
FROM base AS runner
ENV NODE_ENV=production
# Prisma's query engine needs libssl at runtime; node:22-bookworm-slim doesn't ship
# it, so Prisma falls back to a guessed openssl version and warns on every start.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 1001 okf
# WORKDIR /app is root-owned (created before `useradd`, above); the local
# GraphProvider and any local-fallback provider write under OKF_DATA_DIR
# (default /app/.data) at runtime as the non-root `okf` user, so that one
# directory needs to exist pre-chowned — everything else below is `--chown=okf`
# per COPY already.
RUN mkdir -p /app/.data && chown okf:okf /app/.data
COPY --from=build --chown=okf /app/node_modules ./node_modules
COPY --from=build --chown=okf /app/package.json ./package.json
COPY --from=build --chown=okf /app/packages ./packages
COPY --from=build --chown=okf /app/workers/dist ./workers/dist
COPY --from=build --chown=okf /app/workers/package.json ./workers/package.json
# pnpm's isolated node-linker puts each workspace member's own deps (incl. its
# @okf-anchor/* workspace symlinks) in that member's own node_modules, not root's —
# both are needed at runtime alongside the root ./node_modules copied above.
COPY --from=build --chown=okf /app/workers/node_modules ./workers/node_modules
COPY --from=build --chown=okf /app/apps/web/.next ./apps/web/.next
COPY --from=build --chown=okf /app/apps/web/public ./apps/web/public
COPY --from=build --chown=okf /app/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=okf /app/apps/web/node_modules ./apps/web/node_modules
USER okf
EXPOSE 3000
# `app` service overrides this with `next start`; `worker` service overrides with the worker.
# The trailing "apps/web" tells Next which project directory to serve since CWD is /app.
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "-p", "3000"]
