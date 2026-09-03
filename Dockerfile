# syntax=docker/dockerfile:1
# Multi-stage build (skill: okf-docker-dev): a small non-root runtime image with
# no dev dependencies or secrets in the final layer.

FROM node:22.12.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ---- deps: install with the lockfile, no scripts we did not vet ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/okf-core/package.json      packages/okf-core/
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
RUN useradd --system --uid 1001 okf
COPY --from=build --chown=okf /app/node_modules ./node_modules
COPY --from=build --chown=okf /app/package.json ./package.json
COPY --from=build --chown=okf /app/packages ./packages
COPY --from=build --chown=okf /app/workers/dist ./workers/dist
COPY --from=build --chown=okf /app/workers/package.json ./workers/package.json
COPY --from=build --chown=okf /app/apps/web/.next ./apps/web/.next
COPY --from=build --chown=okf /app/apps/web/public ./apps/web/public
COPY --from=build --chown=okf /app/apps/web/package.json ./apps/web/package.json
USER okf
EXPOSE 3000
# `app` service overrides this with `next start`; `worker` service overrides with the worker.
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "-p", "3000"]
