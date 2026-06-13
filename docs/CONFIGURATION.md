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

## Core Variables

| Variable | Default | Notes |
| --- | --- | --- |
| `VW_PORT` | `8590` | HTTP server port. |
| `VW_DATA_DIR` | `/data` | Persistent data directory inside Docker. |
| `VW_OPENCLAW_PATH` | `/openclaw` | Mounted OpenClaw home path. |
| `VW_GATEWAY_URL` | `ws://host.docker.internal:18789` | OpenClaw gateway WebSocket URL. |
| `VW_GATEWAY_TOKEN` | empty | Optional gateway token. |
| `VW_HERMES_ENABLED` | `true` | Enables Hermes discovery and chat relay. |
| `VW_HERMES_HOME` | `/home/vw/.hermes` | Hermes home path inside Docker. |
| `VW_HERMES_BIN` | `/home/vw/.local/bin/hermes` | Hermes CLI path inside Docker. |
| `VW_HERMES_TIMEOUT_SEC` | `600` | Hermes call timeout. |

## Data

World data is stored under `VW_DATA_DIR`.

Do not commit runtime data to source control. The `.gitignore` excludes local data, backups, generated screenshots, and temporary verification files.
