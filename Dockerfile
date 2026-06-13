FROM node:22-slim AS node-deps

WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM python:3.12-slim

WORKDIR /app

# Copy application files
COPY src/server/ /app/server/
COPY src/client/ /app/client/
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
    VW_LICENSE_PRODUCT_IDS=1140503 \
    VW_TIMEZONE="" \
    VW_STATUS_FILE=""

EXPOSE 8590

CMD ["python3", "/app/server/server.py"]
