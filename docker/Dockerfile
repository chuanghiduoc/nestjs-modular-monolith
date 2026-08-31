# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS base

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable pnpm

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

RUN pnpm build

FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM base AS migrate

# Patch the base image's OS packages at build time. Waiting for the upstream
# node tag to be rebuilt leaves a known-fixed CVE in a production image for as
# long as that takes.
RUN apk upgrade --no-cache && apk add --no-cache dumb-init

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM node:${NODE_VERSION} AS runtime

# Two things happen here, both for the same reason: this image is scanned, and
# what it does not contain cannot be vulnerable.
#
#   apk upgrade  — takes the fixed OS packages now rather than when the upstream
#                  node tag is next rebuilt.
#   rm npm       — this project installs with pnpm and runs `node dist/...`; npm
#                  is never invoked at runtime. It ships a large bundled
#                  dependency tree of its own, and every CVE in that tree is
#                  reported against this image despite nothing being able to
#                  reach it.
RUN apk upgrade --no-cache     && apk add --no-cache dumb-init     && rm -rf /usr/local/lib/node_modules/npm               /usr/local/lib/node_modules/corepack               /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

COPY --chown=node:node prisma ./prisma

USER node

ENV HEALTH_CHECK_PORT=3000
EXPOSE 3000 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.HEALTH_CHECK_PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/main.api.js"]
