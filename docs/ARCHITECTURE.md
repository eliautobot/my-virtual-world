# Architecture

Status: product reference  
Scope: My Virtual World repository and runtime

## Summary

My Virtual World is a self-hosted 3D world for local agent systems. The browser renders the world, the Python server stores world state as JSON, and optional OpenClaw/Hermes integrations provide live agent presence, chat, and activity.

The app is designed for local machines, LANs, and private VPNs. It is not a public hosted service. A Contract 1.1 provider registry normalizes discovery, health, settings, lifecycle, resources, skills, chat, sessions, interrupts, and approvals without baking installation accounts into the product.

## Runtime Pieces

| Piece | Location | Purpose |
| --- | --- | --- |
| Client UI | `src/client/` | Three.js world, setup page, settings, chat, movement, and interactions. |
| Server | `src/server/server.py` | Static file serving, JSON APIs, license state, OpenClaw/Hermes adapters, persistence. |
| Provider registry | `src/server/providers/` | Six built-in manifests plus optional `vw_provider_*.py` extensions and file-safety helpers. |
| Lifecycle coordinator | `src/server/gateway_presence.py` | Provider-neutral run, tool, approval, health, finishing, idle, and stale-run state shared by every provider. |
| Realtime sidecar | `src/realtime/server.mjs` | Optional Colyseus runtime for live agent snapshots, route leases, and heartbeat broadcast. |
| Hermes provider | `src/server/providers/hermes.py` | Capability-negotiated HTTP API runtime plus independently negotiated mounted-profile resources and optional Linux CLI lifecycle support. |
| Persistent data | `VW_DATA_DIR`, usually Docker volume `vw-data` | World metadata, chunks, buildings, license receipt, config, communication logs. |
| Docker deployment | `Dockerfile`, `docker-compose.yml` | Production-style local deployment. |
| Verification | `scripts/verify-smoke.mjs` | Public smoke suite, syntax checks, package checks, and secret scan. |

## Request Flow

1. Browser loads `src/client/index.html`.
2. `main3d.js` initializes Three.js, loads settings, and fetches saved world data.
3. The client reads and writes JSON through `/api/*` endpoints.
4. The server persists data under `VW_DATA_DIR`.
5. Provider registry data is merged into the visible agent roster, Agent Desk, chat window, and in-world bubbles according to manifest capabilities.

Every execution transport translates its native signals into the same lifecycle
coordinator. The coordinator owns active run/tool/approval ids and the
`working → finishing → idle` transition. Provider health and Live Agent
controller state remain separate state planes. Native Hermes and Codex streams
are consumed by server-owned monitors, so browser SSE attachment or disconnect
does not control task presence.

Chat-session state is addressed by `providerKind + profile + native session id`,
not by one process-global active session alone. The browser persists that key per
chat-window slot and sends it with every native run. Atomic per-session mirrors
under `VW_STATUS_DIR/chat-session-mirrors/` preserve normalized rich history
across switching, lazy session creation, restarts, and incomplete native
exports. Session switching merges provider history into the mirror; only an
explicit delete removes it. OpenClaw new-session creation allocates a distinct
Gateway conversation key and never resets the prior key.

OpenClaw interactive chat follows a split server-owned transport: the browser
opens same-origin `/api/openclaw/events` and `/api/openclaw/rpc` connections,
while the Python server owns the authenticated Gateway WebSocket. This lets
remote LAN/Tailnet browsers work without direct access to port `18789` or the
operator token. An explicit legacy `direct` mode remains available.

Docker always uses Linux container paths. `providers/path_mapping.py` interprets
Windows drive-letter and UNC paths with Windows rules, then maps their OpenClaw
relative suffixes into the `/openclaw` mount. POSIX paths keep their Linux
semantics. Unmappable Windows paths are never passed through POSIX `abspath`.

### Provider Transport and Endpoint Resolution

Provider manifests declare their runtime boundary through the additive Contract
1.1 `connectionSchema`. A `network` transport declares its mode key, URL key,
allowed schemes, authenticated probe, and topology defaults. A `process`
transport declares the executable setting that must run in the server's own
runtime. Third-party manifests without `connectionSchema` remain compatible.

`providers/endpoint_resolution.py` is the shared network resolver used by native
OpenClaw/Hermes paths and the Universal Provider SDK. Auto mode tries declared
configured, Docker-host, and container-local candidates and returns one selected
endpoint. Candidate URLs come from manifests rather than provider-name branches.
Authentication and protocol failures are terminal. Unreachable candidates can
fall through. A run pins its selected endpoint for events and control operations,
and ambiguous submission failures are never retried through another transport.

This models topology rather than operating-system labels: `127.0.0.1` is the
server/container, `host.docker.internal` is the Docker host, and Custom is an
exclusive sidecar/remote endpoint. Process-only providers do not expose network
modes unless an adapter supplies a real network bridge.

Hermes intentionally uses two independent transports when it runs in a
dedicated container. The authenticated HTTP API owns discovery, sessions,
models, runs, approvals, and cancellation. A separately configured filesystem
mount owns only manifest-allowlisted profile resources such as `SOUL.md`,
workspace documents, and `SKILL.md` files. The resource mapping is never
derived from the API URL, honors read-only mounts, and does not require a
second Hermes CLI inside the My Virtual World container.

## World Flow

The client owns most rendering and interactive behavior:

- terrain and roads
- buildings and interiors
- furniture placement
- outdoor nodes
- agent movement
- object interactions
- vehicle rendering

The server is the durable store and guardrail layer:

- saves world JSON
- protects demo/license-locked write paths
- repairs narrow compatibility issues
- preserves saved user data during updates
- exposes agent integration APIs

## Realtime Sidecar

Live Agent Mode uses an optional Colyseus sidecar for online-game runtime state. The sidecar does not replace the Python server or Three.js renderer. It owns only realtime live-agent snapshots, route leases, heartbeat state, and broadcast to connected clients. Each self-hosted install runs its own sidecar; browsers connect through that install's browser-reachable realtime URL.

See [LIVE-AGENT-MODE-COLYSEUS-SIDECAR.md](LIVE-AGENT-MODE-COLYSEUS-SIDECAR.md).

## Starter World

The starter world is defined in `src/client/js/starter-map.mjs` and guarded on the server. It is only used when a world is fresh and uninitialized.

Important rule: updates must not replace a user's saved world. A normal update changes source code only; saved data remains in `VW_DATA_DIR`.

## License and Demo Mode

The license system controls feature availability. Demo mode allows a starter world and limited features. Paid features such as advanced editing, Agent Browser, SMS/Twilio, and Agent Live Mode require activation.

Agents must not bypass or weaken license checks. See `src/server/license.py` and `docs/SECURITY.md`.

## Sensitive Information

Source control must not contain:

- `.env`
- full License Keys
- API keys or tokens
- private hostnames or private IPs
- private user paths
- runtime world data
- local agent memories, transcripts, or workspaces

Use placeholders in examples.
