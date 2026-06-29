FROM node:22-slim AS node-deps

WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS realtime

WORKDIR /app

COPY package.json package-lock.json /app/
COPY src/client/ /app/client/
COPY src/realtime/ /app/realtime/
COPY --from=node-deps /deps/node_modules/ /app/node_modules/

RUN mkdir -p /data/chunks /data/buildings

ENV VW_REALTIME_HOST=0.0.0.0 \
    VW_REALTIME_PORT=8591 \
    VW_DATA_DIR=/data \
    VW_REALTIME_ROOM=agent_runtime

EXPOSE 8591

CMD ["node", "/app/realtime/server.mjs"]

FROM python:3.12-slim AS web

WORKDIR /app

# Copy application files
COPY package.json package-lock.json /app/
COPY src/server/ /app/server/
COPY src/client/ /app/client/
COPY src/realtime/ /app/realtime/
COPY --from=node-deps /deps/node_modules/ /app/node_modules/

# Runtime deps for live OpenClaw presence mirroring
RUN pip install --no-cache-dir websockets

# Create data directories
RUN mkdir -p /data/chunks /data/buildings

# Default environment — all configurable via env vars
ENV VW_PORT=8590 \
    VW_DATA_DIR=/data \
    VW_OPENCLAW_PATH=/openclaw \
    VW_STATUS_DIR=/data/vo-status \
    VW_LICENSE_STORE_ID=321733 \
    VW_LICENSE_PRODUCT_IDS=1140366 \
    VW_TIMEZONE="" \
    VW_STATUS_FILE=""

EXPOSE 8590

CMD ["python3", "/app/server/server.py"]
