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
| `VW_HERMES_API_URL` | `http://127.0.0.1:8642` | Hermes native API server URL for the default profile or a user-managed API. |
| `VW_HERMES_API_KEY` | empty | Bearer token sent server-side to Hermes. Required for auto-started local API servers. |
| `VW_HERMES_PREFER_API` | `true` | Prefer Hermes native `POST /v1/runs` plus SSE events over CLI fallback. |
| `VW_HERMES_AUTO_START_PROFILE_APIS` | `true` | Allow Virtual World to start profile-scoped local Hermes API servers. Only localhost URLs and configured API keys are eligible. |
| `VW_HERMES_AUTO_START_DEFAULT_API` | `true` | Allow auto-start for the default Hermes profile. |
| `VW_HERMES_API_PROFILE_PORT_BASE` | `8643` | Base port used to derive profile-specific local API ports. |
| `VW_CODEX_ENABLED` | `true` | Enables Codex CLI discovery and chat relay. |
| `VW_CODEX_HOME` | `/home/vw/.codex` | Codex home path inside Docker. |
| `VW_CODEX_BIN` | `/home/vw/.codex/packages/standalone/current/bin/codex` | Codex CLI path inside Docker. |
| `VW_CODEX_WORKSPACE_ROOT` | `/data/codex-agents` | Workspace root for standard Codex-backed agents. |
| `VW_CODEX_MAIN_WORKSPACE` | `/data/codex-main` | Workspace for the main Codex agent. |
| `VW_CODEX_MODEL` | empty | Optional default model override passed into Codex runs. |
| `VW_CODEX_SANDBOX` | `workspace-write` | Codex sandbox mode used for native runs. |
| `VW_CODEX_APPROVAL_POLICY` | `never` | Codex approval policy used for native runs. |
| `VW_CLAUDE_CODE_ENABLED` | `false` | Saves Claude Code setup fields. Live Claude Code agents are not implemented in My Virtual World yet. |
| `VW_CLAUDE_CODE_HOME` | `/home/vw/.claude` | Claude Code config directory inside Docker. |
| `VW_CLAUDE_CODE_BIN` | `claude` | Claude Code CLI path or command name. |
| `VW_CLAUDE_CODE_WORKSPACE_ROOT` | `/data/claude-code-agents` | Future workspace root for standard Claude Code-backed agents. |
| `VW_CLAUDE_CODE_MAIN_WORKSPACE` | `/data/claude-code-main` | Future workspace for the main Claude Code agent. |
| `VW_CLAUDE_CODE_PERMISSION_MODE` | `acceptEdits` | Claude Code permission mode setting saved by the Models & Providers window. |
| `VW_REALTIME_ENABLED` | `true` in Docker Compose, otherwise `false` unless a realtime URL is configured | Enable the Colyseus sidecar config for Live Agent Mode runtime state. |
| `VW_REALTIME_BROWSER_URL` | empty | Browser-reachable websocket URL for this install's realtime sidecar, such as `ws://127.0.0.1:8591`, `ws://my-world-pc:8591`, or `wss://world.example.com/realtime`. |
| `VW_REALTIME_URL` | empty | Backwards-compatible alias for `VW_REALTIME_BROWSER_URL`. |
| `VW_REALTIME_ROOM` | `agent_runtime` | Colyseus room name used by the browser runtime client. |
| `VW_REALTIME_HOST_PORT` | `8591` | Docker host port published for the realtime sidecar. Keep it private to your machine, LAN, or VPN unless an authenticated proxy is in front. |
| `VW_REALTIME_PORT` | `8591` | Sidecar HTTP/WebSocket port when running the local realtime server. |
| `VW_WORLD_ACTION_HISTORY_MAX_BYTES` | `8388608` | Maximum encoded size of retained terminal world-action history. Oldest records are compacted or pruned first. |
| `VW_WORLD_ACTION_HISTORY_RECORD_MAX_BYTES` | `262144` | Maximum encoded size of one retained terminal world-action record before optional diagnostic fields are compacted. |
| `VW_WORLD_META_BACKUP_INTERVAL_SEC` | `300` | Minimum interval between full `world-meta.json.bak` copies. Atomic primary writes still happen whenever metadata changes. |
| `VW_WORLD_META_STALE_TMP_MAX_AGE_SEC` | `3600` | Age at which abandoned `world-meta.json.tmp-*` files are removed during a later save. |
| `VW_LIVE_AGENT_COLLECTION_MAX_BYTES` | `262144` | Per-collection byte budget for Live Agent memory, events, plans, episodes, feedback, and proposals. |
| `VW_LIVE_AGENT_LOOP_STATE_MAX_BYTES` | `8388608` | Overall byte budget for the persisted Live Agent loop state. |
| `VW_LIVE_AGENT_INTERNAL_NOTES_MAX_BYTES` | `1048576` | Global byte budget for Virtual-World-owned Live Agent internal notes. |
| `VW_LIVE_AGENT_INTERNAL_NOTE_DETAILS_MAX_BYTES` | `24576` | Maximum diagnostic detail stored on one internal note before compaction. |
| `VW_LIVE_AGENT_PLANNER_TRANSCRIPTS_MAX_BYTES` | `2097152` | Global byte budget for Virtual-World-owned planner transcript copies. |
| `VW_LICENSE_STORE_ID` | `321733` | Lemon Squeezy store ID used to verify keys belong to My Virtual World. |
| `VW_LICENSE_PRODUCT_IDS` | `1140366` | Comma-separated Lemon Squeezy product IDs accepted by this app. |

The Lemon Squeezy store and product IDs are public product identifiers, not secrets. The app also has these My Virtual World IDs built in as safe defaults; keep the `.env` values set unless you operate a private fork with a different product.

## Realtime Runtime

Live Agent Mode can use a Colyseus sidecar as the shared server runtime for agent positions, route leases, and heartbeat snapshots. This is self-hosted per install. The browser should connect back to the same machine, LAN host, Tailnet address, or reverse proxy that serves that user's world.

Use `VW_REALTIME_BROWSER_URL` for the websocket URL that browsers can reach. The older `VW_REALTIME_URL` name is still accepted, but new setup instructions should prefer `VW_REALTIME_BROWSER_URL` because it describes the value more clearly.

The default Docker Compose setup starts the realtime sidecar as `virtual-world-realtime` and publishes `VW_REALTIME_HOST_PORT`, normally `8591`. Do not expose that port directly to the public internet; use a private network or an authenticated reverse proxy.

## Data

World data is stored under `VW_DATA_DIR`.

Do not commit runtime data to source control. The `.gitignore` excludes local data, backups, generated screenshots, and temporary verification files.

World metadata is written atomically as compact JSON. Saving identical content is a no-op, and the last-known-good backup is refreshed on a configurable interval instead of being recopied for every high-frequency runtime update. Live Agent histories use both record-count retention and byte budgets so a small number of unusually large planner frames or diagnostics cannot grow storage without bound.

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

## Hermes Native Streaming

Virtual World uses Hermes' public API server when available:

- `POST /v1/runs` starts a run.
- `GET /v1/runs/{run_id}/events` streams `message.delta`, `tool.started`, `tool.completed`, `reasoning.available`, approvals, and terminal run events.
- `POST /v1/runs/{run_id}/approval` resolves approvals.
- `POST /v1/runs/{run_id}/stop` interrupts a run.

The browser connects only to Virtual World proxy endpoints, so the Hermes API key stays server-side. If the native API is unavailable, chat falls back to the public Hermes CLI path.

Product-neutral `vw-config.json` also supports `hermes.apiProfiles.<profile>` entries with `apiUrl`, `apiKey`, and `autoStart` overrides. Remote or user-managed API URLs are used as configured and are not overwritten or auto-started.
