# Architecture

Status: product reference  
Scope: My Virtual World repository and runtime

## Summary

My Virtual World is a self-hosted 3D world for local agent systems. The browser renders the world, the Python server stores world state as JSON, and optional OpenClaw/Hermes integrations provide live agent presence, chat, and activity.

The app is designed for local machines, LANs, and private VPNs. It is not a public hosted service.

## Runtime Pieces

| Piece | Location | Purpose |
| --- | --- | --- |
| Client UI | `src/client/` | Three.js world, setup page, settings, chat, movement, and interactions. |
| Server | `src/server/server.py` | Static file serving, JSON APIs, license state, OpenClaw/Hermes adapters, persistence. |
| Hermes provider | `src/server/providers/hermes.py` | Optional Hermes profile discovery and chat relay. |
| Persistent data | `VW_DATA_DIR`, usually Docker volume `vw-data` | World metadata, chunks, buildings, license receipt, config, communication logs. |
| Docker deployment | `Dockerfile`, `docker-compose.yml` | Production-style local deployment. |
| Verification | `scripts/verify-smoke.mjs` | Public smoke suite, syntax checks, package checks, and secret scan. |

## Request Flow

1. Browser loads `src/client/index.html`.
2. `main3d.js` initializes Three.js, loads settings, and fetches saved world data.
3. The client reads and writes JSON through `/api/*` endpoints.
4. The server persists data under `VW_DATA_DIR`.
5. Optional OpenClaw/Hermes data is merged into the visible agent roster and chat surfaces.

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

## Live Agent Mode Direction

Agent Live Mode is currently hidden in the product UI until the backend can own autonomous execution reliably. The target architecture is documented in [LIVE-AGENT-MODE-SPEC.md](LIVE-AGENT-MODE-SPEC.md): selected agents should act through backend-validated tools, persist turn/tool/action state on the server, and stream replayable animation events to browsers. A browser may render and animate Live Agent work, but it must not be required for autonomous actions to progress or complete.

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
