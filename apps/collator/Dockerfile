# Collator: the on-site event-day server serving the built judge page, in one image (issue #40, ADR-0027).
# Built from the repo root:
#   docker build -f apps/collator/Dockerfile -t collator .
# Usually run with Caddy in front: deploy/collator/compose.yaml and docs/runbook/collator.md.
# The database lives in /data, a volume, so it survives new images. Judges need no accounts (ADR-0023).

# amd64 only (ADR-0027 item 2). arm64 is this build setting: --build-arg PLATFORM=linux/arm64.
ARG PLATFORM=linux/amd64
# The same base as the Composer image: at least 22.23.4 for CVE-2026-111497 (Node Brotli RCE).
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

# Every workspace package's manifest, so pnpm sees the whole workspace the lockfile describes.
FROM --platform=${PLATFORM} ${NODE_IMAGE} AS manifests
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schema/package.json packages/schema/
COPY packages/scoring/package.json packages/scoring/
COPY packages/program-guide/package.json packages/program-guide/
COPY packages/cartridge/package.json packages/cartridge/
COPY packages/judge-form/package.json packages/judge-form/
COPY apps/composer-api/package.json apps/composer-api/
COPY apps/composer-web/package.json apps/composer-web/
COPY apps/collator/package.json apps/collator/
COPY apps/collator-web/package.json apps/collator-web/

# The judge page (and /official), built.
FROM manifests AS web
RUN corepack enable
RUN pnpm install --frozen-lockfile --filter @camporee-conductor/collator-web...
COPY tsconfig.base.json ./
COPY packages/schema packages/schema
COPY packages/scoring packages/scoring
COPY packages/cartridge packages/cartridge
COPY packages/judge-form packages/judge-form
COPY apps/collator apps/collator
COPY apps/collator-web apps/collator-web
# The commit shown on the judge page (#41); there is no .git in here. compose.yaml passes it in.
ARG BUILD_COMMIT=unknown
RUN BUILD_COMMIT=${BUILD_COMMIT} pnpm --filter @camporee-conductor/collator-web build

# The Collator's production dependencies. Build tools in case better-sqlite3 has no prebuilt binary.
FROM manifests AS app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
RUN pnpm install --frozen-lockfile --prod --filter @camporee-conductor/collator...
COPY packages/schema packages/schema
COPY packages/scoring packages/scoring
COPY packages/cartridge packages/cartridge
COPY apps/collator apps/collator

FROM --platform=${PLATFORM} ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=3030 \
    DATABASE_PATH=/data/collator.db \
    WEB_ROOT=/repo/web
WORKDIR /repo
COPY --from=app /repo ./
COPY --from=web /repo/apps/collator-web/dist ./web
RUN mkdir /data /backups && chown node:node /data /backups
USER node
VOLUME /data
EXPOSE 3030
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://localhost:3030/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/collator/src/main.ts"]
