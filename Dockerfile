# Composer: the API serving the built web app, in one image (issue #4, D5).
#   docker build -t composer .
#   docker run --rm -p 3010:3010 --env-file .env.local -v composer-data:/data composer
# Needs CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY at run time. The dev sign-in is refused here
# (NODE_ENV=production, issue #4 D7). The database lives in /data, a volume, so it survives new images.

ARG NODE_IMAGE=node:22.23.3-bookworm-slim

# Every workspace package's manifest, so pnpm sees the whole workspace the lockfile describes.
FROM ${NODE_IMAGE} AS manifests
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schema/package.json packages/schema/
COPY packages/scoring/package.json packages/scoring/
COPY apps/composer-api/package.json apps/composer-api/
COPY apps/composer-web/package.json apps/composer-web/

# The web app, built.
FROM manifests AS web
RUN corepack enable
RUN pnpm install --frozen-lockfile --filter @camporee-conductor/composer-web...
COPY tsconfig.base.json ./
COPY packages/schema packages/schema
COPY apps/composer-api apps/composer-api
COPY apps/composer-web apps/composer-web
RUN pnpm --filter @camporee-conductor/composer-web build

# The API's production dependencies. Build tools in case better-sqlite3 has no prebuilt binary.
FROM manifests AS api
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
RUN pnpm install --frozen-lockfile --prod --filter @camporee-conductor/composer-api...
COPY packages/schema packages/schema
COPY apps/composer-api apps/composer-api

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=3010 \
    DATABASE_PATH=/data/composer.db \
    WEB_ROOT=/repo/web
WORKDIR /repo
COPY --from=api /repo ./
COPY --from=web /repo/apps/composer-web/dist ./web
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3010
CMD ["node", "apps/composer-api/src/main.ts"]
