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
| GET | `/api/building-placement-rules` | Read server-enforced building placement constraints. |
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

Placement rule: building footprints may snap next to streets, but cannot intersect any roadway, curb/gutter, or sidewalk surface. The server enforces this on `POST /api/buildings`, `POST /api/building`, and `POST /api/building/<building-id>`. A rejected placement returns HTTP `409` with error code `building_roadway_overlap` and details about the building footprint and street surface that overlapped.

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
| GET | `/gateway-info` | Safe OpenClaw browser transport metadata; in default proxy mode this sets the proxy cookie and omits the Gateway token/URL. |
| GET | `/api/openclaw/events` | Same-origin OpenClaw chat event stream backed by the server-owned Gateway connection. |
| POST | `/api/openclaw/rpc` | Same-origin, cookie-protected RPC proxy restricted to chat/session methods required by the UI. |
| GET | `/session-info` | Current model/context metadata when available. |

Status records are used for visual presence only. They do not grant tool access.

## Universal Provider SDK

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/providers` | Read public manifests, capabilities, schemas, and redacted health for installed providers. |
| GET | `/api/providers/settings` | Read manifest-driven settings and redacted configured values. |
| POST | `/api/providers/settings` | Validate and save one provider's settings; blank secret fields preserve existing values. |
| POST | `/api/providers/test` | Test unsaved provider settings without persisting them. |
| POST | `/api/providers/refresh` | Force provider and agent discovery refresh. |
| GET | `/api/providers/discovery` | Read the normalized provider roster. |
| POST | `/api/agent/create` | Create an agent using its provider manifest creation schema. |
| POST | `/api/agent/delete` | Safely delete a provider agent when the provider declares deletion. |
| POST | `/api/providers/profile` | Update a provider agent profile when supported. |
| GET/POST | `/api/providers/resources` | List, read, preview, write, delete, inspect revisions, or restore manifest-declared files. |
| GET/POST | `/api/providers/skills` | List, validate, save, delete, inspect revisions, or restore AgentSkills files. |
| POST | `/api/providers/runs` | Start a generic native provider run. |
| GET | `/api/providers/runs/<run-id>/events` | Stream normalized run events with SSE. |
| GET | `/api/providers/history` | Read normalized provider chat history. |
| POST | `/api/providers/interrupt` | Interrupt a native run when declared. |
| GET/POST | `/api/providers/sessions` | List, create, switch, or delete native sessions according to capabilities. |
| GET/POST | `/api/providers/approvals` | Read and answer native approval requests when declared. |

Provider identity is the tuple `providerKind + providerConnectionId + providerAgentId`. Public health responses intentionally omit accounts, channels, discovered agents, binaries, credentials, and private runtime details. Provider resource and skill endpoints reject undeclared, absolute, traversal, sensitive, and escaping-symlink paths.

## Assignments, Decorations, and Profiles

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/assignments` | Read agent home/work assignments. |
| POST | `/api/assignments` | Save assignments. |
| GET | `/api/decorations` | Read world decorations. |
| POST | `/api/decorations` | Save world decorations. |
| GET | `/api/agent/<agent-id>/live-mode` | Read Agent Live Mode setting. |
| POST | `/api/agent/<agent-id>/live-mode` | Enable or disable Agent Live Mode. |
| POST | `/api/agent/<agent-id>/live-mode/reset` | Cancel and clear one resident's Live Agent runtime state while preserving profile, assignments, buildings, and objects. |
| GET | `/api/agent/<agent-id>/goals` | Read the resident's restart-safe goal/task/step ledger and status counts. |
| POST | `/api/agent/<agent-id>/goals` | Create, update, activate, pause, cancel, replan, or retry a durable goal. |
| GET | `/api/agent/<agent-id>/workspace` | Read editable provider workspace files for the agent. |
| POST | `/api/agent/<agent-id>/workspace` | Save editable provider workspace files for the agent. |
| GET | `/api/agent/<agent-id>/resident-profile` | Read or create the Virtual World Resident Profile. |
| POST | `/api/agent/<agent-id>/resident-profile` | Save the Virtual World Resident Profile. |
| POST | `/api/agent/<agent-id>/profile` | Save name, appearance, personality, or profile docs. |

Profile writes may update local agent identity files when configured. Do not write private user data into profile documentation.

The legacy workspace endpoint remains available for compatibility. The Agent Desk uses `/api/providers/resources` for all providers and renders only each manifest's declared files, roots, write policy, and validation rules.

Resident profiles live in `world-meta.json` under `agentProfiles[agentId].residentProfile`. They are Virtual World-specific roleplay/autonomy profiles with identity, life purpose, goals, needs, short-term memory, long-term memory, and Live Mode behavior settings.

The global Agent Live Mode feature switch is server-enforced. When it is turned off or the license no longer permits Agent Live Mode, the server cancels active Live Agent actions and planner work, releases local world claims, and rejects new Live Agent action requests. Re-enabling the feature preserves the per-agent selections.

Reset body:

```json
{
  "actor": "operator-ui"
}
```

Reset clears only the selected resident's loop memory, durable goals, short execution plans, episodes, proposals, internal notes, planner transcript copies, pending model reply, and active Live Agent actions. It does not delete the resident profile, agent framework files, assignments, homes, buildings, furniture, or other world data.

Durable goal POST operations are `create`, `upsert`, `activate`, `resume`, `pause`, `cancel`, `replan`, and `retry`. Goal payloads contain stable task and step ids, `dependsOn` arrays, success/failure criteria, and per-step retry settings. Verified terminal outcomes cannot be overwritten by stale active saves. See `docs/LIVE-AGENT-MODE-DURABLE-GOALS.md`.

## Live Agent Loop

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/agent-live-loop` | Read loop state, scheduler cursor, feature-kill state, runtime status, and storage budgets. |
| POST | `/api/agent-live-loop` | Update loop, model, preemption, pause, cooldown, and scheduling settings. |
| POST | `/api/agent-live-loop/tick` | Request one loop tick; the global feature switch cannot be bypassed with `force`. |
| POST | `/api/agent-live-loop/user-attention` | Mark or clear user-chat preemption while Agent Live Mode is globally enabled. |
| GET | `/api/agent-live-loop/perception` | Read one resident's latest perception/decision surface. |
| GET | `/api/agent-live-sessions?agentId=<id>` | Read the resident's current durable Live activation, checkpoint, working memory, and lived journal. |
| POST | `/api/agent-live-sessions/message` | Send user speech into the same Live activation; questions preserve physical work while stop/resume/redirect update its checkpoint. |
| GET | `/api/agent/<agent-id>/spatial-perception` | Read authoritative coordinates, distances, place/occupancy, field-of-view, route, nearby agent, and nearby object context. |
| GET | `/api/agent-live-loop/proposals` | Read operator proposals. |
| POST | `/api/agent-live-loop/proposals` | Resolve an operator proposal without executing hidden world mutations. |

The scheduler uses a persisted round-robin cursor when the per-tick action limit is smaller than the enabled roster. Disabled, paused, and no-agent timer ticks are read-only. Model-backed residents use a two-phase decision: the tick that starts an asynchronous model request does not also start a deterministic action from the same perception frame. Typed action aliases resolve only within the current safe executable surface; unsupported categories, unavailable actions, and stale choices return structured evidence and do not trigger a server-ranked substitute.

When the global Agent Live Mode feature switch is off, the server returns `agent_live_mode_feature_disabled` for per-agent settings, durable-goal writes, attention, loop-setting, proposal-resolution, Live Agent world-action, and Live Agent move-intent writes. The explicit selected-agent reset remains available for operator cleanup. Live Agent status, durable-goal, feedback, proposal, and timeline reads remain available as read-only snapshots and do not migrate or reconcile persisted Live Agent state.

## World Actions

World actions are durable requests for agents to move, reserve, use, or complete interactions in the world.

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

For an API-connected Hermes agent, the unified provider endpoints also proxy
Hermes' documented authenticated discovery surfaces:

| Virtual World endpoint | Hermes API source |
| --- | --- |
| `GET /api/chat-sessions?agent=<id>` | `GET /api/sessions` |
| `POST /api/chat-sessions/create` | `POST /api/sessions` |
| `POST /api/chat-sessions/switch` | `GET /api/sessions/{id}/messages` |
| `POST /api/chat-sessions/delete` | `DELETE /api/sessions/{id}` |
| `GET /api/agent/{id}/skills` | `GET /v1/skills` (read-only metadata) |
| `GET /api/native-models` | `GET /v1/models` |

Every remote feature is gated by `/v1/capabilities`. API-only connections do
not inherit local filesystem write capabilities. Native profile/workspace files
remain unavailable unless Hermes advertises a future resource endpoint or a
Linux profile is mounted into the container.

Hermes API keys, if used, belong in local settings or `.env`, not in docs or commits.

## Provider Connection Schema

`GET /api/providers` and `GET /api/providers/settings` expose each manifest's
optional `connectionSchema`. It describes network and process transports without
embedding installation-specific values. Network declarations include the mode
and URL setting keys, allowed schemes, and topology defaults. Process declarations
identify the executable setting that must run in the server/container.

For network transports, connection results may include `transport`,
`endpointMode`, and `endpointLocation`. They do not expose API keys or resolved
endpoint URLs. Auto resolution selects one authenticated endpoint before a run;
it never sends the same work to multiple candidates. Custom mode is exclusive.

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
| POST | `/sms-sync` | Synchronize recent inbound and outbound history from Twilio. Accepts optional `{"force": true}`. |
| POST | `/sms-thread-mode` | Set one thread to `agent` or `user` control. |
| POST | `/sms-owner` | Assign or clear the roster agent that owns Agent-controlled SMS threads. |
| POST | `/sms-send` | Send SMS through Twilio. User sends require User control; Agent sends require Agent control and the assigned agent ID. |

Thread modes and contacts are runtime data in `/data`; Twilio credentials remain
configuration secrets. The Inbox can synchronize Twilio history without requiring
credentials to be exposed to the browser.

Never commit Twilio credentials or customer phone data.

## Upload and Transcription

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/upload` | Upload chat media for agent-readable use. |
| GET | `/chat-media` | Serve uploaded chat media by token/query. |
| POST | `/transcribe` | Proxy audio to configured Whisper service. |

Uploaded files are runtime data. Do not commit them.
