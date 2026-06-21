# API Reference

Status: product reference  
Scope: HTTP endpoints exposed by `src/server/server.py`

The default local base URL is:

```text
http://localhost:8590
```

If Docker uses a different outside port, replace `8590` with `VW_HOST_PORT`.

## General Rules

- Request and response bodies are JSON unless noted.
- Demo mode blocks advanced write APIs except the initial starter-world seed.
- Activated installs can use more editing and Agent Live Mode features.
- Do not send secrets in examples, logs, screenshots, or documentation.
- Treat destructive calls such as DELETE as user-approved operations only.

## Health, Setup, and Config

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Basic service health. |
| GET | `/setup` | First-run setup page. |
| GET | `/vw-config` | Safe app configuration for the browser. |
| POST | `/setup/save` | Save setup wizard settings. |
| POST | `/api/settings` | Save settings from the app. |
| GET | `/api/license` | Current license/demo status. |
| POST | `/api/license/activate` | Activate with a License Key. |
| POST | `/api/license/deactivate` | Remove local activation receipt. |

License activation body:

```json
{
  "key": "<license-key>"
}
```

Do not log full License Keys.

## World Metadata

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/meta` | Read world metadata. |
| POST | `/api/meta` | Patch world metadata. |

Common metadata fields:

- `initialized`
- `name`
- `starterMap`
- `streets`
- `agentAssignments`
- `agentProfiles`
- `decorations`
- `agentLife`

The client sets `initialized: true` after starter-world creation so default buildings are not recreated after user deletion.

## Chunks and Terrain

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/chunks` | List saved chunk coordinates. |
| GET | `/api/chunk/<cx>/<cy>` | Read a chunk or `null` if it has never been saved. |
| POST | `/api/chunk/<cx>/<cy>` | Save one chunk. |
| DELETE | `/api/chunk/<cx>/<cy>` | Delete one saved chunk. |

Chunks contain terrain cells such as grass, road, sidewalk, and other world ground state. A missing chunk means the client should generate a default chunk and then apply road/sidewalk overlays from `/api/streets`.

## Streets

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/streets` | Read saved street segments. |
| POST | `/api/streets` | Save street segments. |

Street records are line segments with coordinates such as:

```json
{
  "x1": -52,
  "z1": -29,
  "x2": 142,
  "z2": -29,
  "width": 5
}
```

The server guards against accidental empty street saves by restoring the known starter street list when needed.

## Buildings

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/buildings` | List building summaries. |
| POST | `/api/buildings` | Save a building. |
| POST | `/api/building` | Save a building. |
| GET | `/api/building/<building-id>` | Read a building. |
| POST | `/api/building/<building-id>` | Save a building at a specific id. |
| DELETE | `/api/building/<building-id>` | Delete a building. |

Building records include:

- `id`
- `name`
- `x`, `z`, `width`, `depth`
- `interior.furniture[]`
- `interior.walls[]`
- exterior/outdoor node data when present

The starter Office appliance repair is narrow. It only restores mount metadata when the original starter counter, microwave, and coffee machine are still present in their expected furniture positions.

## Agents and Presence

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/agents` | Agent roster with world assignments and profile overlays. |
| GET | `/agents-list` | Chat selector roster with provider/session keys. |
| GET | `/api/status` | Current agent status map. |
| GET | `/api/presence` | Presence status map. |
| GET | `/api/presence/<agent-id>` | One agent presence record. |
| GET | `/api/presence/debug` | Presence debug information. |
| GET | `/api/agent-chat` | Chat/activity payload for visible agent bubbles. |
| GET | `/gateway-info` | OpenClaw gateway connection info for the browser. |
| GET | `/session-info` | Current model/context metadata when available. |

Status records are used for visual presence only. They do not grant tool access.

## Assignments, Decorations, and Profiles

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/assignments` | Read agent home/work assignments. |
| POST | `/api/assignments` | Save assignments. |
| GET | `/api/decorations` | Read world decorations. |
| POST | `/api/decorations` | Save world decorations. |
| GET | `/api/agent/<agent-id>/live-mode` | Read Agent Live Mode setting. |
| POST | `/api/agent/<agent-id>/live-mode` | Enable or disable Agent Live Mode. |
| POST | `/api/agent/<agent-id>/profile` | Save name, appearance, personality, or profile docs. |

Profile writes may update local agent identity files when configured. Do not write private user data into profile documentation.

## World Actions

World actions are durable requests for agents to move, reserve, use, or complete interactions in the world.

For the planned backend-owned autonomous resident architecture, see [LIVE-AGENT-MODE-SPEC.md](LIVE-AGENT-MODE-SPEC.md). The current world-action API remains the compatibility foundation, but future Live Agent execution should make the server authoritative for turns, tool calls, movement progress, object-use side effects, and replayable animation events.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/world-actions` | Reconcile and read world action store. |
| POST | `/api/world-actions` | Create an action or replace active/history lists. |
| GET | `/api/world-actions/active` | Read active actions. |
| POST | `/api/world-actions/active` | Replace active action list. |
| GET | `/api/world-actions/history` | Read action history. |
| POST | `/api/world-actions/history` | Replace history action list. |
| GET | `/api/world-action-events` | Read action event log. |
| GET | `/api/world-actions/events` | Alias for action events. |
| GET | `/api/world-actions/object-availability` | Check an object target's availability. |
| POST | `/api/world-actions/<action-id>/transition` | Move an action to another lifecycle state. |
| POST | `/api/world-actions/<action-id>/complete` | Complete an action. |
| POST | `/api/world-actions/<action-id>/cancel` | Cancel an action. |
| POST | `/api/world-actions/<action-id>/fail` | Mark an action failed. |
| POST | `/api/world-actions/<action-id>/timeout` | Mark an action expired. |
| POST | `/api/agent-model/actions` | Agent Live Mode high-level action request. |
| POST | `/api/agents/<agent-id>/move` | Create a movement intent. |
| GET | `/api/live-agent-mode/tools` | Read backend Live Agent tool contracts. |
| POST | `/api/live-agent-mode/actions/dry-run` | Validate a Live Agent tool call without executing it. |
| POST | `/api/live-agent-mode/tool-calls/validate` | Alias for dry-run tool-call validation. |
| POST | `/api/live-agent-mode/tool-calls` | Execute safe Live Agent communication or memory tools, or dry-run when `dryRun` is true. |
| GET | `/api/live-agent-mode/in-world-communications` | Read persisted in-world communication events, distinct from provider relay messages. |
| GET | `/api/live-agent-mode/memory/<agent-id>` | Read a bounded ClawMind memory stream and ranked retrieval results for one resident. |
| GET | `/api/live-agent-mode/animation-events` | Read backend-emitted movement/object-use replay events for browser clients. |
| GET | `/api/agent-live-loop` | Inspect backend scheduler state, active turn ownership, pause, kill switch, and recent turn history. |
| POST | `/api/agent-live-loop` | Update backend scheduler controls such as pause, kill switch, intervals, and per-agent enablement. |
| POST | `/api/agent-live-loop/tick` | Run a backend scheduler tick or dry-run tick without requiring a browser tab. |
| GET | `/api/agent-live-loop/events` | Read durable Live Agent turn/scheduler events from `world-meta.json#agentLife.liveModeLoop.events`. |
| GET | `/api/agent-live-loop/timeline` | Read operator-oriented Live Agent turn, plan, feedback, proposal, and world-action timeline entries. |

Minimal action create example:

```json
{
  "actionType": "life.getCoffee",
  "agentId": "<agent-id>",
  "target": {
    "kind": "object-instance",
    "buildingId": "<building-id>",
    "catalogId": "countertopCoffeeMachine",
    "interactionSpotId": "use-front"
  },
  "source": {
    "kind": "api",
    "requestId": "<request-id>"
  },
  "priority": "normal",
  "params": {}
}
```

The server normalizes and validates lifecycle states. See `src/client/js/agent-life-world-action-schema.mjs` for the schema vocabulary.

Backend Live Agent tool contracts cover observe, move, object-use, communication, memory, and build/create proposal categories. Dry-run validation checks typed arguments, agent Live Mode permission, conservative location gates, object permissions, and target availability. Safe communication and memory tools persist backend side effects through `/api/live-agent-mode/tool-calls`; movement and object use execute through the backend world-action APIs. Physical Live Agent world mutations must carry route target metadata, including resolved coordinates for object-use targets, record arrival, persist authoritative presence at the target, and only then set `timing.mutationAppliedAt`. Missing-presence, missing-coordinate, or wrong-location mutation attempts are rejected instead of applied. The public UI stays behind the existing Coming Soon/feature gate.

In-world communication events are stored under `world-meta.json#agentLife.inWorldCommunications`. They are visible world events with `providerRelay: false`, so they are distinct from `/api/agent-platform-communications/send` provider relay messages. Nearby observers receive durable reaction-opportunity entries in the Live Agent loop event log.

Memory retrieval queries accept `query`, `currentPlan`, `limit`, `tags`, and `kinds`. Results are scored with deterministic relevance, recency, and importance components over the bounded resident stream at `world-meta.json#agentLife.liveModeLoop.agents.<agent-id>.memory.stream`. The same retrieval path backs the `search_memory` Live Agent tool.

The backend Live Agent loop owns one resident turn at a time, rotates enabled agents round-robin, persists active/recent turns, and records sequenced scheduler events. `worldClientRequired` defaults to `false`, so the scheduler can run without an open browser tab; browsers remain render/replay clients for visible world-action animation. Backend-owned Live Agent world actions move through routing, arrival, object-use, and completion on the server and store replay records under `world-meta.json#agentLife.animationEvents`. `/api/live-agent-mode/metrics` exposes `metrics.routeBeforeAction`, `metrics.presenceDefinedMutation`, `metrics.worldEventFeed`, and `metrics.reconnectReplay`; the final gate reports `presencePersistenceOk`, `multiClientWorldSyncOk`, `routeBeforeActionOk`, `presenceDefinedMutationsOk`, and `reconnectReplayOk`. Reconnect replay evidence comes from `/api/world-events?snapshot=1&since=<cursor>` returning a current snapshot plus events after the disconnected client's cursor, including the completed mutation event. Metrics reads remain read-only and do not call providers/models. Operator pause and kill switch controls stop new turns while preserving the durable log for inspection.

Animation event queries accept `since`, `limit`, `agentId`, `actionId`, `worldActionId`, `name`, and `type`. Events are sequenced for polling clients and include `clientRequiredForProgress: false` in their render metadata.

## AgentPlatform-to-AgentPlatform Communication

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/agent-platform-communications/skill` | Agent-readable communication skill text. |
| GET | `/api/agent-platform-communications/history` | Read routed message history. |
| POST | `/api/agent-platform-communications/send` | Send a message from one agent/platform to another. |

Send body:

```json
{
  "fromAgentId": "<sender-agent-id>",
  "toAgentId": "<target-agent-id>",
  "message": "Please review the current world state.",
  "conversationId": "<optional-thread-id>",
  "metadata": {
    "topic": "world-review"
  }
}
```

History query parameters:

- `conversationId`
- `agentId`
- `limit`

## Hermes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/hermes/history` | Read Hermes chat history. |
| POST | `/api/hermes/history/clear` | Clear Hermes history for a profile. |
| POST | `/api/hermes/runs` | Start a native Hermes API run through `POST /v1/runs`. |
| GET | `/api/hermes/runs/{run_id}/events` | Proxy Hermes native run SSE events from `GET /v1/runs/{run_id}/events`. |
| POST | `/api/hermes/runs/{run_id}/approval` | Resolve a run approval through `POST /v1/runs/{run_id}/approval`. |
| POST | `/api/hermes/runs/{run_id}/stop` | Stop a native Hermes run through `POST /v1/runs/{run_id}/stop`. |
| GET | `/api/hermes/live` | Compatibility live-event polling for CLI fallback. |
| POST | `/api/hermes/chat` | Compatibility CLI chat fallback when the native API is unavailable. |
| GET | `/api/hermes/approval/pending` | Read pending Hermes approval state. |
| GET | `/api/hermes/approval/stream` | One-shot event-stream approval check. |
| POST | `/api/hermes/approval/respond` | Respond to a Hermes approval. |
| GET | `/api/hermes/test` | Test Hermes connection. |
| POST | `/api/hermes/test` | Test Hermes connection with supplied config. |

Hermes API keys, if used, belong in local settings or `.env`, not in docs or commits.

## Browser and SMS

These features are locked until licensed and configured.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/browser-status` | Browser configuration and availability. |
| GET | `/browser-tabs` | Current browser tabs from configured CDP endpoint. |
| GET | `/browser-controller` | Browser controller placeholder/status. |
| GET | `/sms-status` | SMS configuration status. |
| GET | `/sms-threads` | SMS thread list. |
| GET | `/sms-thread?phone=<number>` | Messages for a phone number. |
| GET | `/sms-contacts` | SMS contacts derived from threads. |
| POST | `/sms-send` | Send SMS through configured provider. |

Never commit Twilio credentials or customer phone data.

## Upload and Transcription

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/upload` | Upload chat media for agent-readable use. |
| GET | `/chat-media` | Serve uploaded chat media by token/query. |
| POST | `/transcribe` | Proxy audio to configured Whisper service. |

Uploaded files are runtime data. Do not commit them.
