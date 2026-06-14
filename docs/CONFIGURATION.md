# Configuration

My Virtual World is configured with environment variables and the in-app setup page.

Product details and License Key information are available at
[myvirtualworld.ai](https://myvirtualworld.ai/).

## Docker

```bash
cp .env.example .env
docker compose up --build -d
```

The Docker Compose file mounts persistent world data into the `vw-data` volume and mounts local agent-system folders only when present on the host.

For a beginner-friendly walkthrough, see [INSTALLATION.md](INSTALLATION.md).

## Core Variables

| Variable | Default | Notes |
| --- | --- | --- |
| `VW_HOST_PORT` | `8590` | Outside Docker host port you open in the browser. Change this if another app already uses 8590. |
| `VW_PORT` | `8590` | HTTP server port inside the container. Most Docker installs should leave this at 8590. |
| `VW_DATA_DIR` | `/data` | Persistent data directory inside Docker. |
| `VW_OPENCLAW_PATH` | `/openclaw` | Mounted OpenClaw home path. |
| `VW_GATEWAY_URL` | `ws://host.docker.internal:18789` | OpenClaw gateway WebSocket URL. |
| `VW_GATEWAY_TOKEN` | empty | Optional gateway token. |
| `VW_HERMES_ENABLED` | `true` | Enables Hermes discovery and chat relay. |
| `VW_HERMES_HOME` | `/home/vw/.hermes` | Hermes home path inside Docker. |
| `VW_HERMES_BIN` | `/home/vw/.local/bin/hermes` | Hermes CLI path inside Docker. |
| `VW_HERMES_TIMEOUT_SEC` | `600` | Hermes call timeout. |
| `VW_LICENSE_STORE_ID` | `321733` | Lemon Squeezy store ID used to verify keys belong to My Virtual World. |
| `VW_LICENSE_PRODUCT_IDS` | `1140366` | Comma-separated Lemon Squeezy product IDs accepted by this app. |

The Lemon Squeezy store and product IDs are public product identifiers, not secrets. The app also has these My Virtual World IDs built in as safe defaults; keep the `.env` values set unless you operate a private fork with a different product.

## Data

World data is stored under `VW_DATA_DIR`.

Do not commit runtime data to source control. The `.gitignore` excludes local data, backups, generated screenshots, and temporary verification files.

## Agent Connections

Use these defaults when running with Docker:

| Setting screen field | Value |
| --- | --- |
| OpenClaw Home | `/openclaw` |
| Gateway URL | `ws://host.docker.internal:18789` |
| Hermes Home | `/home/vw/.hermes` |
| Hermes CLI | `/home/vw/.local/bin/hermes` |

Use these defaults when running directly on your machine without Docker:

| Setting screen field | Value |
| --- | --- |
| OpenClaw Home | `~/.openclaw` |
| Gateway URL | `ws://127.0.0.1:18789` or your gateway URL |
| Hermes Home | `~/.hermes` |
| Hermes CLI | `~/.local/bin/hermes` |

If OpenClaw or Hermes do not appear connected, confirm the host tools are running first, then restart the container after changing `.env` or Docker volume mounts.
