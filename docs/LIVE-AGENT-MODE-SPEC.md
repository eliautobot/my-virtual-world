# Live Agent Mode Implementation Spec

Status: implementation proposal
Owner: product architecture review
Scope: My Virtual World product architecture, APIs, data model, and frontend playback
Goal: build a reliable autonomous resident mode where agents can decide, move, communicate, use objects, create visible world changes, remember outcomes, and continue operating without depending on an open browser tab.

## Summary

Live Agent Mode should turn selected agents into persistent residents of My Virtual World. A resident agent should:

- observe the current world state
- choose goals and tool calls
- move through the world
- interact with objects and buildings
- communicate with nearby or remote agents
- remember outcomes
- update relationships and plans
- produce visible animation/state events for the browser
- recover cleanly after server restarts or browser disconnects

The key architectural rule is:

**The backend is the source of truth for autonomous action. The browser renders, replays, and optionally assists with high-fidelity animation, but a browser tab must not be required for a Live Agent action to progress or complete.**

The existing Live Agent Mode UI can remain hidden behind the current `Live Agent Mode Coming Soon` message until the acceptance criteria in this spec are met.

## Current Foundation

The product already has useful pieces:

- agent roster and presence APIs
- per-agent Live Mode profile flags
- durable world actions under `world-meta.json#agentLife.worldActions`
- move intent records under `world-meta.json#agentLife.moveIntents`
- object availability checks
- world-action transition, completion, cancel, fail, and timeout endpoints
- provider communication relay for OpenClaw, Hermes, Codex, and future platforms
- Three.js rendering, movement, object-use animations, and interaction spots

The problem with the previous attempt was ownership. The server could validate and persist a world action, but movement and completion still depended on `main3d.js#setAgentTarget()` in a live browser client. That made the system fragile: actions could sit in `route_pending`, executor leases could expire, and scene confirmation could drift from actual action state.

The current backend executor moves Agent Live Mode world actions through routing, arrival, object use, and completion on the server. Browser clients no longer need to claim a route for autonomous completion; they can poll `/api/live-agent-mode/animation-events` and replay server-emitted movement/object-use events while the durable world action and final simulated agent location remain server-owned.

The next reliability bar is online-game-style presence. Every browser tab must be a client of one authoritative world, not a separate visual instance. Refreshing the page must not reset an agent to a spawn/default location. If an agent moves, builds, places an object, deletes an object, or changes a building, the server must persist that action and publish it to every connected client so the change appears without a manual refresh. Agent actions must be presence-defined: the agent routes to the target building/floor/object/coordinates first, then the backend applies the mutation only after arrival.

The next "alive world" bar is society-level behavior, not just more animation. Live Agent Mode should act like a persistent resident simulation where agents choose from a location-gated tool frame, take multi-step turns, speak in-world, form memories, maintain todos/plans, update relationships, and leave public evidence of what happened. The loop should feel alive because agents have goals, places to go, constraints, follow-up reactions, and consequences.

The redesigned mode keeps the good API vocabulary, but moves autonomous execution authority to the backend.

## Non-Goals

- Do not re-enable the existing product UI until this mode is reliable.
- Do not bypass license gates, setup gates, or operator controls.
- Do not allow hidden arbitrary world mutation.
- Do not require an always-open browser tab for progression.
- Do not let Live Agent Mode override explicit user-directed movement or edits.
- Do not make agents modify network, firewall, DNS, filesystem, license, or infrastructure settings.
- Do not ship broad destructive actions until approval, audit, and rollback exist.

## Local Autopilot Test Harness

Autonomous Live Agent Mode development should use the isolated 8587 harness instead of the normal product port. The harness starts a temporary-data server, checks `/healthz`, proves repeated backend scheduler turns complete before any browser client is opened, verifies typed object actions, verifies social agent-target routing, verifies in-world communication/memory side effects, verifies operator pause/kill-switch controls, then opens the real product browser client and verifies its `/api/live-agent-mode/animation-events` replay consumer renders scene and agent state. It refuses environment or argument targets that point at 8590.

```bash
npm run verify:live-agent-mode:8587
```

The default harness target is the 8587 scale/soak acceptance gate: at least five Live Agent Mode agents and 5 backend turns, isolated from the protected 8590 runtime. Smaller or larger local runs use the same script:

```bash
VW_LIVE_AGENT_MODE_SOAK_AGENT_COUNT=3 VW_LIVE_AGENT_MODE_SOAK_TURNS=20 npm run verify:live-agent-mode:8587
```

The read-only metrics endpoint is:

```text
GET /api/live-agent-mode/metrics
```

It returns `agent-live-mode-autonomy-metrics/v1` with a checklist and counts for completed backend-owned turns/actions, per-agent live turn/action distribution, p50/p95 turn duration, action success/recovery rates, route-pending actions, typed object-use action types, simulation locations, animation replay events, in-world communication events, reaction opportunities, bounded memory growth, relationship records, operator proposals, persisted Live Agent buildings, pause status, and kill-switch status. Mutation/tick endpoints remain license-gated; metrics are read-only so locked/demo states can still explain what is missing.

The metrics endpoint must also expose the online-game presence contract:

- `metrics.presencePersistence.agentCount`
- `metrics.presencePersistence.persistedLocationCount`
- `metrics.presencePersistence.refreshResetCount`
- `metrics.presencePersistence.ok`
- `metrics.worldEventFeed.lastSequence`
- `metrics.worldEventFeed.replayableEventCount`
- `metrics.worldEventFeed.connectedClientCount`
- `metrics.worldEventFeed.maxObservedClientCount`
- `metrics.worldEventFeed.multiClientSyncLatencyMs.p95`
- `metrics.worldEventFeed.multiClientAppliedSampleCount`
- `metrics.worldEventFeed.latestMultiClientSync.sampledClientCount`
- `metrics.worldEventFeed.multiClientWorldSyncOk`
- `metrics.worldEventFeed.ok`
- `metrics.routeBeforeAction.violationCount`
- `metrics.routeBeforeAction.violations`
- `metrics.routeBeforeAction.ok`
- `metrics.presenceDefinedMutation.mutationCount`
- `metrics.presenceDefinedMutation.violationCount`
- `metrics.presenceDefinedMutation.violations`
- `metrics.presenceDefinedMutation.ok`
- `metrics.reconnectReplay.clientCatchupCount`
- `metrics.reconnectReplay.completedMutationEventCount`
- `metrics.reconnectReplay.missedMutationCount`
- `metrics.reconnectReplay.ok`
- `finalGate.checks.presencePersistenceOk`
- `finalGate.checks.multiClientWorldSyncOk`
- `finalGate.checks.routeBeforeActionOk`
- `finalGate.checks.presenceDefinedMutationsOk`
- `finalGate.checks.reconnectReplayOk`

The 8587 final gate treats `worldEventFeedOk`, `routeBeforeAction`, and `presenceDefinedMutation` as compatibility aliases. The PR-final online-game presence contract uses the `*Ok` names above and requires reconnect replay evidence from a client that recorded a cursor, disconnected while a backend-owned action completed, then fetched a current snapshot plus replay events after that cursor with `expectedWorldActionId` set and at least one completed mutation event for that action after the cursor. Multi-client sync evidence must include sampled applied cursors and latency from at least two active world-event clients; connected streams without applied-event samples are not enough for `multiClientWorldSyncOk`.

The default 8587 soak gate must prove the 5 completed backend turns are distributed across at least five enabled Live Agent Mode residents. The metrics surface this as `metrics.perAgentDistribution` and repeat the compact evidence under `finalGate.evidence` so reviewers can see which enabled agents completed live turns and backend-owned actions.

It also reports lightweight provider readiness plus ClawMind-style architecture contract readiness and runtime execution evidence:

- `providerSupport.schemaVersion = agent-live-mode-provider-adapter-contract/v1`
- `providerSupport.providerKinds`
- `providerSupport.checklist.allProviderKindsHaveCoreAdapter`
- `providerSupport.optimization.providerCallsDuringMetrics = 0`
- `providerSupport.optimization.modelCallsDuringMetrics = 0`
- `providerModelCallCounts`
- `metrics.perAgentDistribution`
- `metrics.completedTurnCountByAgent`
- `metrics.completedBackendActionCountByAgent`
- `clawMindArchitecture.schemaVersion = agent-live-mode-clawmind-architecture/v1`
- `clawMindArchitecture.modules`
- `clawMindArchitecture.checklist.allModuleContractsReady`
- `clawMindArchitecture.checklist.allModulesExecuted`
- `clawMindArchitecture.modules.*.executionCount`
- `clawMindArchitecture.modules.*.lastExecutionAt`
- `clawMindArchitecture.modules.*.lastLatencyMs`
- `clawMindArchitecture.modules.*.latency.p50Ms`
- `clawMindArchitecture.modules.*.latency.p95Ms`
- `clawMindArchitecture.runtime.traceCount`
- `clawMindArchitecture.optimization.heavyWorldScan = false`
- `finalGate.ok`
- `finalGate.checks.featureGateOpen`
- `finalGate.checks.configGateOpen`
- `finalGate.checks.noRoutePendingActions`
- `finalGate.checks.noUnresolvedMismatches`
- `finalGate.checks.memoryWithinCaps`
- `finalGate.checks.memoryGrowthBounded`
- `finalGate.checks.providerModelBudgetOk`
- `finalGate.checks.clawMindRuntimeEvidence`
- `finalGate.checks.defaultSoakEnabledAgentRosterPresent`
- `finalGate.checks.defaultSoakCompletedTurnTargetMet`
- `finalGate.checks.defaultSoakCompletedBackendActionTargetMet`
- `finalGate.checks.turnsCompletedAcrossEnabledAgents`
- `finalGate.checks.actionsCompletedAcrossEnabledAgents`
- `finalGate.evidence.enabledAgents`

Provider and ClawMind metrics intentionally use cached roster/world state plus bounded persisted module traces only. They must not call OpenClaw, Hermes, Codex, or any model provider while serving the metrics endpoint.

For manual browser checks, keep the same isolated server open:

```bash
npm run dev:live-agent-mode:8587
```

Then open `http://127.0.0.1:8587`. Do not restart, bind over, or kill a product instance that may already be running on 8590.

## Core Principles

1. Backend-authoritative simulation
   Every autonomous action is represented by backend records and backend-owned state transitions.

2. Tools are the only mutation path
   An agent cannot directly edit world JSON. It can only call validated tools.

3. Physical presence matters
   Location, building, floor, room, distance, object availability, and interaction spots control which tools are available.

4. Visible outcome, backend truth
   The frontend shows animation events from the backend. If no frontend is connected, the backend still advances the simulation and records replayable events.

5. Bounded autonomy
   Agents may act continuously, but within schedules, cooldowns, budgets, permissions, locks, and operator pause/veto controls.

6. Replayability
   Every turn, decision, tool call, validation result, side effect, and animation event should be inspectable after the fact.

7. Progressive capability
   Start with safe resident actions. Add build/create/social/governance tools only after typed tool contracts and tests exist.

8. Resident society over scripted chores
   The loop should not be a tiny hard-coded chore selector. Each turn should assemble location, nearby agents, available tools, memories, relationships, plans, and recent outcomes into a resident affordance frame. The planner chooses from that frame, and every action must remain validated by backend contracts.

9. Multi-step turns, bounded by policy
   A normal resident turn should have enough budget to observe, choose, act, remember, and optionally write a todo/diary entry. The default implementation budget is 5 tool calls per turn. Risky tools remain operator-reviewed even when the turn budget is larger.

10. Places unlock behavior
   Homes, work buildings, public spaces, shops, and future civic buildings should unlock different tools. A home can unlock rest/self-care/decoration; a shared room can unlock speech and social reactions; a construction site can unlock typed build completion; future civic spaces can unlock governance or public posting tools.

## Target User Experience

In Settings, Live Agent Mode eventually becomes an operator console instead of a simple toggle.

Expected controls:

- global enable/disable
- per-agent enable/disable
- pause/resume loop
- max actions per minute/hour
- quiet hours
- allowed tool categories
- require approval for risky tool categories
- clear stuck actions
- inspect active turn
- inspect active world action
- inspect recent tool calls
- inspect agent memory and plans
- replay recent animation events
- view conversation history

Expected status:

- loop health
- current scheduler tick
- currently acting agent
- current goal
- active tool call
- current location
- blocked reason
- last error
- next scheduled turn
- connected browser viewers

## Architecture

### 1. Simulation Engine

Add a backend simulation engine responsible for:

- scheduling agent turns
- assembling context
- exposing available tools
- validating tool calls
- applying side effects
- recording events
- producing animation directives
- reconciling stale or failed work

The engine should run inside the server process at first. It should be structured so it can later move to a worker process without changing public APIs.

### 1a. Provider Adapter Contract

Live Agent Mode must be provider-neutral. OpenClaw, Hermes, Codex, and future providers should all enter the same backend simulation contract instead of each provider owning a separate resident loop.

Required adapter capabilities:

- `identity`: stable `id`, `statusKey`, `name`, and `providerKind`
- `profileStorage`: Live Mode settings stored in `world-meta.json#agentProfiles`
- `liveModeToggle`: per-agent enable/disable works for any provider kind
- `providerNeutralToolRegistry`: all autonomous actions use `LIVE_AGENT_TOOL_REGISTRY`
- `backendActionExecution`: provider agents use the same server executor
- `inWorldCommunication`: `say_to_agent` creates world communication, not provider relay
- `memoryBuckets`: `add_memory` writes provider-neutral resident memory
- `relationshipStorage`: social outcomes update shared relationship records
- `animationReplay`: all providers emit replayable animation events
- `readOnlyMetrics`: readiness can be measured without calling provider APIs

Provider-specific chat/model execution can be added later, but it must plug into this contract. A provider adapter may enrich reasoning, but it must not bypass world-action validation, license gates, operator controls, or backend action ownership.

The minimum readiness metrics are:

```json
{
  "providerSupport": {
    "schemaVersion": "agent-live-mode-provider-adapter-contract/v1",
    "discoveredAgentCount": 3,
    "providerKindCount": 3,
    "providerKinds": {
      "openclaw": {"agentCount": 1, "liveModeEnabledCount": 1, "gaps": []},
      "hermes": {"agentCount": 1, "liveModeEnabledCount": 0, "gaps": []},
      "codex": {"agentCount": 1, "liveModeEnabledCount": 0, "gaps": []}
    },
    "checklist": {
      "allProviderKindsHaveCoreAdapter": true,
      "providerNeutralToolRegistry": true,
      "providerNeutralCommunication": true,
      "providerNeutralMemory": true
    },
    "optimization": {
      "providerCallsDuringMetrics": 0,
      "modelCallsDuringMetrics": 0
    }
  }
}
```

### 1b. ClawMind-Style Lightweight Orchestration

Live Agent Mode should follow the ClawMind pattern without making the product heavy. That means the architecture exposes parallel module contracts, but the first implementation can keep those modules lightweight and deterministic.

Required modules:

- `perception`: builds the current world frame
- `memory`: stores observations, conversations, diary, and facts
- `reflection`: summarizes experience into higher-level beliefs
- `planning`: chooses goals and next tool calls
- `socialReasoning`: tracks relationships and nearby agents
- `conversation`: creates in-world communication events
- `actionExecution`: runs validated tools through backend execution
- `outcomeAwareness`: compares expected action outcomes against recorded results
- `orchestrator`: schedules modules and decides which output wins

The important product rule is that modules produce proposals and evidence; only the backend executor mutates world state.

Readiness and runtime execution are measured separately by:

```json
{
  "clawMindArchitecture": {
    "schemaVersion": "agent-live-mode-clawmind-architecture/v1",
    "modules": {
      "perception": {"contractReady": true, "runtimeEvidence": true, "executionCount": 12, "lastExecutionAt": "2026-06-19T19:35:00Z", "lastLatencyMs": 1.2, "gaps": []},
      "memory": {"contractReady": true, "runtimeEvidence": true, "executionCount": 12, "lastExecutionAt": "2026-06-19T19:35:00Z", "lastLatencyMs": 0.1, "gaps": []},
      "reflection": {"contractReady": true, "runtimeEvidence": true, "executionCount": 12, "lastExecutionAt": "2026-06-19T19:35:00Z", "lastLatencyMs": 0.1, "gaps": []},
      "planning": {"contractReady": true, "runtimeEvidence": true, "executionCount": 12, "lastExecutionAt": "2026-06-19T19:35:00Z", "lastLatencyMs": 1.6, "gaps": []},
      "socialReasoning": {"contractReady": true, "runtimeEvidence": true, "executionCount": 12, "lastExecutionAt": "2026-06-19T19:35:00Z", "lastLatencyMs": 0.1, "gaps": []},
      "conversation": {"contractReady": true, "runtimeEvidence": true, "executionCount": 12, "lastExecutionAt": "2026-06-19T19:35:00Z", "lastLatencyMs": 0.1, "gaps": []},
      "actionExecution": {"contractReady": true, "runtimeEvidence": true, "executionCount": 12, "lastExecutionAt": "2026-06-19T19:35:00Z", "lastLatencyMs": 35.0, "gaps": []},
      "outcomeAwareness": {"contractReady": true, "runtimeEvidence": true, "executionCount": 12, "lastExecutionAt": "2026-06-19T19:35:00Z", "lastLatencyMs": 0.1, "gaps": []},
      "orchestrator": {"contractReady": true, "runtimeEvidence": true, "executionCount": 12, "lastExecutionAt": "2026-06-19T19:35:00Z", "lastLatencyMs": 40.0, "gaps": []}
    },
    "contractGaps": [],
    "runtimeEvidenceGaps": [],
    "runtime": {"traceCount": 108, "boundedTraceStore": true},
    "optimization": {
      "readOnly": true,
      "providerCallsDuringMetrics": 0,
      "modelCallsDuringMetrics": 0,
      "heavyWorldScan": false
    }
  }
}
```

`contractReady` means the product has a stable module slot and validation path. `runtimeEvidence` means the current world/test run has produced bounded persisted trace data for that module. Each trace records timing, input/output summaries, decisions, and gaps without invoking a provider/model call during metrics reads. This distinction prevents the UI from claiming a feature is actively working just because the code contract exists.

### 2. Scheduler

The scheduler should be deterministic and bounded.

Required behavior:

- one autonomous agent turn at a time by default
- fair round-robin scheduling
- configurable interval
- per-agent cooldowns
- max actions per tick
- max tool calls per turn, defaulting to 5 so one turn can observe, act, communicate or remember, and leave a follow-up plan
- pause/resume
- force dry-run tick
- stale turn recovery
- crash-safe resume from persisted state

Suggested records:

```json
{
  "id": "turn-<timestamp>-<agent-id>",
  "agentId": "adam",
  "status": "running",
  "reason": "scheduled",
  "startedAt": "2026-06-18T12:00:00Z",
  "endedAt": null,
  "toolCallBudget": 8,
  "toolCallsUsed": 2,
  "currentGoalId": "need.energy",
  "currentLocation": {
    "buildingId": "office-main",
    "floor": 1,
    "roomId": "break-room"
  }
}
```

### 3. Agent Turn Lifecycle

Each backend-owned turn should follow this pipeline:

1. Load agent profile, memory, relationships, assignments, needs, and current location.
2. Update decaying needs.
3. Build a perception frame from saved world state.
4. Build a tool frame containing only available tools.
5. Select the next action through the decision layer.
6. Validate the requested tool call against tool contracts.
7. Apply backend side effects.
8. Append world-action, tool-call, memory, relationship, and animation events.
9. Notify connected browser viewers through polling or streaming.
10. Schedule reactions, follow-up turns, or cooldown.

### 4. Decision Layer

The decision layer has two modes:

- deterministic fallback planner
- model-backed planner

The deterministic planner should remain available for smoke tests, offline mode, and safe fallback. It can score candidates from needs, personality, goals, cooldowns, and recent outcomes.

The model-backed planner should receive a structured context frame and choose tool calls from a validated tool list. It should not receive raw write access to world data.

Decision input should include:

- identity and role
- personality traits
- current needs
- current location
- visible nearby agents
- available landmarks
- available objects and tools
- active plans and todos
- recent memories
- recent conversations
- relationships
- operator rules
- current world time and weather

Decision output should be constrained to:

```json
{
  "goal": "restore energy",
  "tool": "use_object",
  "arguments": {
    "objectInstanceId": "coffee-machine-1",
    "interaction": "make_coffee"
  },
  "reason": "energy is the highest need and the coffee machine is available"
}
```

The backend must validate this output before it mutates world state.

### 5. Tool Registry

Introduce a backend tool registry. Each tool definition should include:

- name
- category
- description
- argument schema
- availability rule
- permission rule
- cooldown rule
- side-effect handler
- animation event builder
- rollback or compensation behavior where possible
- tests

Tool categories:

- navigation
- object use
- communication
- memory
- planning
- relationship
- content creation
- world construction
- governance or operator-reviewed actions
- utility

Initial tools:

```text
observe_world
list_agents
list_landmarks
get_current_location
go_to_place
go_to_coordinates
go_home
use_object
say_to_agent
speak_to_room
send_message
think_aloud
add_memory
write_diary
add_todo
complete_todo
idle
```

Implementation note: the backend registry currently exposes safe observe, movement-validation, object-use-validation, communication, memory, planning, idle, and operator-reviewed build/create contracts. `say_to_agent`, `speak_to_room`, `send_message`, `think_aloud`, `add_memory`, `search_memory`, `write_diary`, `add_todo`, `complete_todo`, and `idle` can execute through backend persistence. Physical movement and object-use tools still route through typed backend world actions so the agent must physically reach the target before mutation.

Every perception frame should include a compact `toolRegistry` summary with categories, executable tools, the current location, and argument-independent availability probes. This is the bridge from hard-coded chores to a generated affordance loop: the planner can see what the resident can do from where it is, while the backend still validates every specific call.

Later tools:

```text
build_structure
propose_world_change
vote_on_world_change
publish_note
create_event
invite_agent
accept_invite
rate_interaction
```

### 6. Tool Availability

Availability should be location-gated and state-gated.

Examples:

- `go_to_place` is always available unless the agent is blocked by an active higher-priority action.
- `use_object` is available only when an object exists, is reachable, is not reserved by another agent, and exposes the requested interaction.
- `say_to_agent` is available when the target agent is near enough or in the same room depending on the communication mode.
- `send_message` is available even when not co-located, but should be logged as remote communication.
- `build_structure` is proposal-only until typed construction tools and approval rules are implemented.
- risky actions require explicit operator approval and audit trails before activation.

### 7. World Actions

Keep `worldActions` as the durable public action model, but change autonomous records so route execution is backend-owned.

Current weak pattern:

```json
{
  "routeOwner": "client-runtime",
  "routingOwner": "main3d.js#setAgentTarget()"
}
```

Target pattern:

```json
{
  "routeOwner": "server-simulation",
  "routingOwner": "server.py#live_agent_simulation",
  "animationOwner": "client-runtime",
  "clientRequiredForProgress": false
}
```

The browser may still run smooth animation, but the backend should persist:

- intended path
- start and end coordinates
- current simulated progress
- final location
- arrival time
- object reservation
- object-use result
- animation events

### 8. Movement

Backend movement does not need to render every animation frame. It needs an authoritative route model.

For each movement:

- resolve destination
- validate building/floor/room/object exists
- validate route is allowed
- estimate travel duration
- set action status to `routing`
- emit `agent-move-started`
- update simulated location at coarse intervals or on completion
- set action status to `arrived`
- emit `agent-arrived`

The frontend can interpolate from animation events:

```json
{
  "type": "agent-move",
  "agentId": "adam",
  "from": {"x": 120, "z": 90, "floor": 1},
  "to": {"x": 320, "z": 180, "floor": 1},
  "durationMs": 8500,
  "worldActionId": "wa-..."
}
```

Implementation note: backend-owned Live Agent actions now persist `execution.owner: "server-simulation"`, `route.routeOwner: "server-simulation"`, and `clientRequiredForProgress: false`. The executor records final agent locations under `world-meta.json#agentLife.simulation.agentLocations` and emits sequenced replay events under `world-meta.json#agentLife.animationEvents`.

### 8A. Server-Authoritative Presence and Permanence

Live Agent Mode must behave like a persistent online world:

- the server owns every agent's authoritative location
- browser clients render the current server location
- page refresh reloads the same server location instead of resetting to spawn
- server restart reloads resident locations from durable world state
- active route state survives browser disconnect/reconnect
- user-directed moves and Live Agent moves converge into the same location store

The authoritative presence record must include:

- `agentId`
- `providerKind`
- `buildingId`
- `floor`
- `roomId`, when known
- `x` and `z` in world-tile coordinates
- `apiX` and `apiZ`, when API-pixel compatibility is needed
- `facing`
- `routeId`
- `worldActionId`
- `target`
- `state` such as `idle`, `routing`, `arrived`, `acting`, `blocked`
- `updatedAt`
- `source` such as `live-agent-loop`, `user-move`, `browser-replay`, or `server-recovery`

The browser must never treat local spawn placement as authoritative once a persisted server location exists.

Implementation note: the backend now keeps the unified presence store at `world-meta.json#agentLife.presence.agentLocations`. Existing `agentLife.simulation.agentLocations` records are migrated into that store for compatibility, and every backend Live Agent movement, user move intent, world-action route transition, browser replay completion, and server recovery path writes the same presence record. `/api/agents` includes each agent's `presence` snapshot so `main3d.js` places refreshed clients at the server-owned location before applying desk/spawn fallback logic. `/api/live-agent-mode/metrics` reports `metrics.presencePersistence` and `finalGate.checks.presencePersistenceOk`.

### 8B. Shared World Event Feed

All clients should receive the same world changes from one durable event stream. The event feed must cover:

- agent location updates
- route start/progress/arrival
- action start/progress/complete/fail
- building create/update/delete
- object place/update/delete
- reservation create/release
- speech and visible reaction events

Each event must include:

- monotonic `sequence`
- `eventId`
- `eventType`
- `agentId`, when applicable
- `worldActionId`, when applicable
- `target`
- `patch` or typed payload
- `createdAt`
- `requiresSnapshotRefresh` when a patch cannot be applied incrementally

On load/reconnect, a client must fetch a current snapshot plus all events after the snapshot cursor. If the event gap is too large, the server must force a snapshot refresh. A connected client should not require a manual browser refresh to see another client or agent's world mutation.

### 8C. Route-Before-Action Contract

Every physical Live Agent action must be tied to a routeable target. The backend must reject, queue, or convert to operator proposal when it cannot resolve a target.

For physical actions:

1. Resolve the building/floor/object/coordinate/agent target.
2. Persist the action as `route_pending`.
3. Persist the route target and expected arrival location.
4. Move the server-authoritative agent location along that route.
5. Emit route and movement events.
6. Mark the action `arrived` only when the authoritative location matches the target tolerance.
7. Apply object/building mutation only after arrival.
8. Emit mutation and completion events.

The mutation record must include `agentId`, route target metadata, `arrivedAt`, persisted presence-at-mutation evidence, target location, and `mutationAppliedAt`. Object-use route metadata must include resolved world coordinates from the persisted object/interaction spot before mutation. A mutation applied while the agent is physically elsewhere, or while same-building presence omits required target coordinates, is rejected and remains a contract violation if it appears in persisted history.

### 8D. Presence-Defined World Mutations

Build, place, delete, and update operations must be location-gated:

- an agent can modify a building only from that building/floor or a valid construction target
- an agent can place an object only at the route target or within the target footprint
- an agent can delete/update an object only after routing to that object or its control point
- object changes must publish world-event patches immediately
- if an operation requires operator approval, the proposal must still include the route target and intended visible action

The server must record rejected mutations caused by missing or mismatched presence so acceptance tests can prove hidden background edits are not slipping through.

### 9. Object Use

Object use should be a backend tool, not just a client animation.

Flow:

1. Agent calls `use_object`.
2. Backend checks object exists and exposes the interaction.
3. Backend reserves the object or queue slot.
4. Backend routes the agent to the object if needed.
5. Backend marks `arrived`.
6. Backend marks `in_progress`.
7. Backend applies typed side effects.
8. Backend releases reservation.
9. Backend emits animation events for browser replay.
10. Backend records memory and feedback.

Example side effects:

- coffee increases energy
- water decreases hydration need
- microwave food decreases food need
- whiteboard creates a planning note
- printer/copier creates a document-use event
- bed rest decreases energy need

### 10. Building and Creation

Live Agent Mode should not allow arbitrary hidden world edits.

Creation must use typed tools:

- `propose_world_change`
- `build_structure`
- `place_object`
- `write_sign`
- `publish_note`

For the first implementation:

- only allow pre-approved typed structures
- require valid footprint
- require collision checks
- require visible construction animation events
- persist the created building/object only after the construction action completes
- store `createdFromWorldActionId`
- provide rollback metadata

### 11. Communication

Communication needs two tracks:

1. provider communication
   Existing `/api/agent-platform-communications/send` can continue routing messages between OpenClaw, Hermes, Codex, and future providers.

2. in-world resident communication
   Live Agent Mode needs spatial communication tools controlled by the simulation engine.

Required tools:

- `say_to_agent`
- `speak_to_room`
- `whisper_to_agent`
- `send_message`
- `read_messages`
- `think_aloud`

When an agent speaks in-world:

1. Backend records the utterance.
2. Backend identifies nearby listeners by building/floor/room/distance.
3. Backend emits speech bubble animation events.
4. Backend creates optional reaction turns for nearby listeners.
5. Listeners decide to reply, react, gesture, ignore, or leave.
6. Backend records conversation memory.
7. Backend updates relationship summaries and scores.

Suggested hearing rules:

- same room: strong hearing
- same floor but different room: only if door/open area allows
- outdoor radius: configurable distance
- whisper: target only
- remote message: target only, no spatial hearing

### 12. Memory and Identity

The backend should persist memory separately from transient action logs.

Required memory layers:

- profile facts
- long-term memories
- recent observations
- diary entries
- todos/plans
- relationship records
- conversation summaries
- operator notes

Memory tools:

- `add_memory`
- `search_memory`
- `write_diary`
- `add_todo`
- `complete_todo`
- `summarize_memory`

The agent should not manually edit raw memory JSON. Memory writes go through tools.

### 13. Relationship Model

Each pair of agents should have a relationship record:

```json
{
  "agentId": "adam",
  "otherAgentId": "coder",
  "type": "neutral",
  "score": 0.12,
  "summary": "They discussed the current world state.",
  "interactionCount": 3,
  "lastInteractionAt": "2026-06-18T12:00:00Z"
}
```

Relationship updates should come from:

- direct conversations
- overheard conversations
- collaboration
- conflict
- fulfilled or broken commitments
- operator-approved social events

### 14. Data Model

The first implementation can remain compatible with `world-meta.json`, but the code should isolate persistence behind store helpers so the system can migrate to SQLite or PostgreSQL later.

Required stores:

- `agentLife.simulation`
- `agentLife.turns.active`
- `agentLife.turns.history`
- `agentLife.toolCalls`
- `agentLife.worldActions`
- `agentLife.moveIntents`
- `agentLife.animationEvents`
- `agentLife.conversations`
- `agentLife.memories`
- `agentLife.relationships`
- `agentLife.operatorControls`

### 15. APIs

Existing APIs should remain:

```text
GET /api/agents
GET /api/world-actions
POST /api/world-actions
GET /api/world-actions/active
GET /api/world-actions/history
POST /api/world-actions/<id>/transition
POST /api/world-actions/<id>/complete
POST /api/world-actions/<id>/cancel
POST /api/agent-platform-communications/send
GET /api/agent-platform-communications/history
```

New or revised APIs should include:

```text
GET /api/live-agent-mode/status
POST /api/live-agent-mode/settings
POST /api/live-agent-mode/tick
GET /api/live-agent-mode/turns
GET /api/live-agent-mode/turns/<turn-id>
GET /api/live-agent-mode/tool-calls
GET /api/live-agent-mode/events
GET /api/live-agent-mode/animation-events
GET /api/live-agent-mode/memory/<agent-id>
GET /api/live-agent-mode/relationships/<agent-id>
POST /api/live-agent-mode/operator-approval
POST /api/live-agent-mode/actions/dry-run
```

Compatibility endpoint:

```text
POST /api/agent-model/actions
```

This endpoint can remain as a high-level action request, but backend-owned Live Mode actions should execute through the server executor and skip the legacy move-intent/client-owned route handoff entirely.

### 16. Frontend Contract

The frontend should:

- display current resident status
- display speech bubbles and emotes
- animate backend movement events
- animate backend object-use events
- show active actions and recent history
- provide operator pause/resume/approval controls
- show when the backend simulation is running without a connected viewer

The frontend should not:

- be required to claim a route
- be required to complete an autonomous action
- write final world-action truth for backend-owned actions
- mutate world state directly for autonomous tools

### 17. Safety and Operator Controls

Required controls:

- global disable
- per-agent disable
- pause duration
- tool category allowlist
- risky tool approval queue
- max turns per hour
- max tool calls per turn
- max autonomous world edits per day
- kill switch for all active autonomous actions
- audit export

Risk tiers:

- Tier 0: observe, idle, think, memory
- Tier 1: move, safe object use, speak
- Tier 2: content creation, events, non-destructive building decoration
- Tier 3: world construction, economy, governance, persistent relationship changes
- Tier 4: destructive or harmful actions; disabled unless explicitly designed and approved

### 18. Failure Handling

Every action must have:

- timeout
- retry policy
- cancellation path
- stale detection
- terminal status
- final result
- audit event

Failure examples:

- target missing
- object reserved
- route blocked
- tool not available at location
- agent unavailable
- operator approval required
- model output invalid
- provider unavailable
- persistence failed

The loop should recover by marking the action terminal, logging feedback, updating memory, and continuing later.

### 19. Acceptance Criteria

The mode is not ready to expose in product UI until all of these pass:

- A selected agent can run at least 50 consecutive backend-owned turns without an open browser.
- The default 8587 soak can complete 5 backend-owned turns across at least five enabled Live Agent Mode agents, with per-agent turn/action counts in metrics and final-gate evidence.
- A selected agent can move to a building and persist its final location without browser help.
- Refreshing the browser three times does not reset any live-enabled agent's server-authoritative location.
- Two connected browser clients see the same agent movement and object/building mutation without manual refresh.
- Client reconnect catches up by snapshot plus world-event replay without missing a completed mutation.
- A selected agent can build/place/delete/update only after routing to the target location.
- Metrics report zero route-before-action violations and zero mutation-without-presence violations.
- A selected agent can use at least three typed objects and persist side effects.
- A selected agent can speak to a nearby agent and create a reaction turn.
- Conversation history appears in UI and API.
- Relationship records update after repeated interaction.
- Memory records update after completed and failed actions.
- Active action recovery survives server restart.
- Browser reconnect can replay recent animation events.
- No action remains stuck in `route_pending` because a browser was absent.
- Operator pause stops new turns within one tick.
- Kill switch cancels active autonomous actions.
- Tests cover create, transition, complete, cancel, timeout, restart recovery, and no-browser progression.
- Existing manual/user-directed movement and object use still work.
- License and feature gates remain intact.

### 20. Delivery Plan

Phase 1: backend ownership foundation

- add simulation status store
- add turn records
- add tool-call records
- add animation event records
- update `/api/agent-model/actions` to support backend-owned dry-run
- keep UI disabled

Phase 2: backend movement

- implement `go_to_place`, `go_to_coordinates`, `go_home`
- persist agent simulated location
- emit movement animation events
- support browser replay

Phase 3: safe object use

- implement typed `use_object`
- support water, coffee, food, rest, whiteboard/planning
- apply backend side effects
- release reservations reliably

Phase 4: communication

- implement spatial speech tools
- add hearing rules
- add reaction turns
- persist conversations
- update relationship records

Phase 5: memory and planning

- add memory tools
- add diary/todo tools
- add context assembly
- add deterministic planner fallback
- add model-backed planner behind a feature flag

Phase 6: operator console

- replace Coming Soon panel with status-only console
- add pause/resume and inspect views
- add approval queue
- keep activation controls hidden until acceptance tests pass

Phase 7: construction and creation

- add typed build tools
- add construction animation events
- require operator approval for persistent world edits
- add rollback metadata

Phase 8: product exposure

- run long no-browser soak tests
- run browser replay tests
- run manual regression tests
- expose per-agent enable controls only after green acceptance results

Phase 9: online-game presence hardening

- persist server-authoritative agent locations for refresh/restart permanence
- add durable world event feed and client patch application
- enforce route-before-action for build/place/delete/update/object-use mutations
- add reconnect catch-up by snapshot plus event cursor
- add two-client 8587 verification for movement and world mutations without refresh
- add metrics/final-gate checks for presence persistence, measured multi-client applied-event sync, route-before-action, presence-defined mutations, and reconnect replay with completed-mutation proof

## Testing Requirements

Unit tests:

- tool availability
- argument validation
- location gating
- reservation conflict
- state transitions
- timeout handling
- memory writes
- relationship updates

Integration tests:

- no-browser autonomous movement
- no-browser object use
- server restart during active turn
- browser reconnect animation replay
- browser refresh location persistence
- two-client movement/object mutation sync
- route-before-action mutation enforcement
- reconnect snapshot/event catch-up
- conversation and reaction turn
- operator pause and kill switch

Smoke tests:

- app health
- settings still show Coming Soon until explicitly enabled
- disabled agents do not act
- feature/license gates block unapproved activation
- existing world-action APIs remain backward compatible

## Done Definition

Live Agent Mode is considered working when an agent can live in the world continuously using backend-owned tools, with visible replay in the browser, without needing a browser tab to execute its decisions.
