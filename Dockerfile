# syntax=docker/dockerfile:1
# Fieldplan v2: one Node process serves the API and the built web app. Data lives in /data (SQLite + file store).
# NODE_IMAGE defaults to AWS's mirror of the Docker official image, so builds don't depend on Docker Hub's login service.
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:24-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# --ignore-scripts: better-sqlite3 ships prebuilt binaries (glibc + musl, x64 + arm64), so nothing needs compiling.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build

# Production dependencies only (no vite, typescript, drizzle-kit, test tools).
FROM ${NODE_IMAGE} AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund -w @fieldplan/server

FROM ${NODE_IMAGE}
ARG FIELDPLAN_VERSION=dev
RUN apk add --no-cache tini su-exec
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    PUID=1000 \
    PGID=1000 \
    FIELDPLAN_VERSION=${FIELDPLAN_VERSION}
COPY --from=build /src/package.json ./
COPY --from=deps /src/node_modules ./node_modules
COPY --from=build /src/packages/shared/package.json packages/shared/
COPY --from=build /src/packages/shared/dist packages/shared/dist
COPY --from=build /src/apps/server/package.json apps/server/
COPY --from=build /src/apps/server/dist apps/server/dist
COPY --from=build /src/apps/web/dist apps/web/dist
COPY docker/entrypoint.sh /usr/local/bin/fieldplan-entrypoint
RUN chmod 755 /usr/local/bin/fieldplan-entrypoint && mkdir -p /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
LABEL org.opencontainers.image.title="Fieldplan" \
      org.opencontainers.image.description="Site CAD for low-voltage, electrical, security and smart-home installs" \
      org.opencontainers.image.source="https://github.com/monoor/fieldplan-app"
ENTRYPOINT ["/sbin/tini", "--", "fieldplan-entrypoint"]
CMD ["node", "apps/server/dist/main.js"]
