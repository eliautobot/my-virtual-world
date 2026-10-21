# My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
# My Virtual World: the official image. Install guide: docs/INSTALL.md.
#   docker compose up -d    builds and starts it with compose.yaml (the app at http://localhost:8570 on this machine)
# The server keeps the world and the accounts in the /data volume and the key for stored secrets in the /keys volume,
# and runs as the unprivileged user node.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only; no install scripts run.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error && npm cache clean --force

COPY server ./server
COPY shared ./shared
COPY client ./client
# The host tools owners use inside the container: account and key administration and backups, database copies.
COPY tools/admin.mjs ./tools/admin.mjs
COPY tools/deploy/dbcopy.mjs ./tools/deploy/dbcopy.mjs

# A tagged build records its release (--build-arg RELEASE_TAG=v2.0.0 --build-arg RELEASE_COMMIT=<commit>); without a
# tag the server reports the development channel.
ARG RELEASE_TAG=
ARG RELEASE_COMMIT=
RUN if [ -n "$RELEASE_TAG" ]; then \
      node -e 'const e = process.env; console.log(JSON.stringify({ tag: e.RELEASE_TAG, commit: e.RELEASE_COMMIT || null, builtAt: new Date().toISOString(), node: process.version }, null, 2))' > release.json; \
    fi

RUN mkdir -p /data /keys && chown node:node /data /keys && chmod 0700 /data /keys

ENV HOST=0.0.0.0
ENV PORT=8570
ENV MVW_DATA=/data
ENV MVW_KEY_FILE=/keys/secret.key
# Connections from the container's default gateway count as this machine, so the owner can sign in over plain HTTP at
# http://localhost on the machine that runs Docker. From other machines, signing in needs HTTPS (docs/INSTALL.md).
ENV MVW_GATEWAY_IS_LOCAL=1

USER node
EXPOSE 8570
VOLUME ["/data", "/keys"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8570) + '/api/ready', { signal: AbortSignal.timeout(4000) }).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/index.mjs"]
