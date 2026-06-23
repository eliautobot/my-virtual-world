# Live Agent Mode Restart Spec

Status: fresh-start architecture spec
Date: 2026-06-23
Scope: My Virtual World runtime, API, browser sync, and agent cognition

This is the clean source of truth for the restarted Live Agent Mode. It intentionally does not inherit older Live Agent Mode spec text or old staging harness plans.

## Goal

Live Agent Mode makes selected AI agents act like persistent residents inside My Virtual World.

A live agent must:

- keep a persistent world location across refreshes, browser tabs, devices, and server restarts
- move visibly through the existing virtual world instead of teleporting or silently mutating state
- use the existing interior and exterior routing systems
- be enabled or disabled per agent at any time
- take precedence over normal scripted behavior while enabled
- fall back to standard scripted behavior when disabled
- perceive the world, remember experiences, plan, reflect, converse, and act using a Generative Agents-style loop
- expose clear operator status and audit trails without leaking private chain-of-thought

The first working version must prove persistence and synchronization before advanced intelligence is added.

## Non-Goals

- Do not import new visual assets from reference projects.
- Do not replace `dynamic-interior-routing.js` or `dynamic-exterior-routing.js`.
- Do not create a second pathfinding system for the same movement problem.
- Do not let LLM/model output write raw world state.
- Do not allow hidden build, delete, move, profile, network, filesystem, license, DNS, or firewall mutations.
- Do not make Live Agent Mode depend on old staging specs or old PR #1 implementation decisions.
- Do not expose the feature as production-ready until the acceptance gates in the phased plan pass.

## Current Repo Foundation

The current repo already has useful pieces that should be reused:

- per-agent Agent Live Mode setting endpoints
- `POST /api/agent-model/actions`
- durable world actions
- movement intents
- object availability checks
- `main3d.js#setAgentTarget(...)`
- dynamic interior routing
- dynamic exterior routing
- browser-side action executors for visible world actions
- OpenClaw/Hermes/Codex presence and communication surfaces

The main missing foundation is authoritative runtime state:

- no dedicated server-owned position snapshot API
- no route executor lease API
- no heartbeat API for live coordinates
- no guaranteed multi-client same-location rendering
- no reliable refresh/new-device placement from current persisted runtime state

## Online Runtime Foundation

Phases 1-3 use a Colyseus sidecar as the first online-game runtime layer.

Colyseus owns:

- live agent runtime snapshots
- route leases
- heartbeat updates
- realtime multi-client broadcast
- `agent-runtime.json` persistence

Python keeps owning saved world data and existing HTTP APIs. Three.js keeps rendering the world and, initially, the browser keeps executing existing routes through `setAgentTarget(...)`.

See [LIVE-AGENT-MODE-COLYSEUS-SIDECAR.md](LIVE-AGENT-MODE-COLYSEUS-SIDECAR.md).

## Reference Architecture

The `joonspk-research/generative_agents` repository and paper are part of this architecture.

Use them for:

- memory stream design
- observation/retrieval/planning/reflection/action loop
- spatial memory concepts
- daily planning and replanning patterns
- believable social behavior patterns
- conversation and relationship memory patterns

Do not use them for:

- visual assets
- map format
- Django/server structure
- old OpenAI SDK usage
- direct Tiled/grid movement
- full-stack wholesale import

The product architecture should adapt the Generative Agents pattern into My Virtual World's existing server, JSON persistence, world actions, browser renderer, and routing stack.

### License Handling

`joonspk-research/generative_agents` is Apache-2.0 licensed. Apache-2.0 code can be used if we preserve required license notices, attribution, and any changed-file notices.

Policy for this project:

- Prefer clean-room reimplementation of patterns.
- If copying nontrivial code, record the copied source path, commit, license, and local destination in a third-party attribution note before merging.
- Do not copy assets, storage fixtures, character data, prompts, or map content unless explicitly reviewed.
- Keep the Stanford/Generative Agents citation in docs if its architecture materially shapes the implementation.

Reference links:

- https://github.com/joonspk-research/generative_agents
- https://arxiv.org/abs/2304.03442

## Live Agent Ownership Model

Every agent has one active behavior owner.

```json
{
  "agentId": "adam",
  "mode": "live",
  "owner": "agent-live-mode",
  "liveModeEnabled": true,
  "scriptedSuppressed": true,
  "manualOverrideActive": false
}
```

Allowed owners:

- `manual`: user-directed action, highest priority
- `agent-live-mode`: AI resident loop owns behavior
- `agent-scripted-mode`: existing normal scripted behavior
- `paused`: no autonomous action may start

Precedence:

```text
manual/user > agent-live-mode > agent-scripted-mode > idle
```

Enable behavior:

- keep the agent at its current runtime location
- stop new scripted decisions for that agent
- cancel or release interruptible scripted state
- let user/manual state finish or explicitly interrupt only through a user-approved path
- seed the live perception frame from the current runtime position

Disable behavior:

- stop new Live Agent Mode turns
- release any live route lease
- terminalize or pause active live world action safely
- keep the agent at its current runtime location
- allow normal scripted behavior to resume from that location

## Authoritative Runtime State

Live Agent Mode needs a dedicated runtime state store.

Recommended initial store:

```text
VW_DATA_DIR/agent-runtime.json
```

Use a separate file instead of high-frequency writes to `world-meta.json`.

Required per-agent snapshot:

```json
{
  "schemaVersion": "agent-runtime/v1",
  "agentId": "adam",
  "mode": "live",
  "owner": "agent-live-mode",
  "x": 120.5,
  "y": 87.25,
  "floor": 1,
  "buildingId": "office-1",
  "roomId": "break-room",
  "heading": 90,
  "state": "routing",
  "target": {
    "kind": "object-instance",
    "buildingId": "office-1",
    "objectInstanceId": "coffee-machine-1",
    "interactionSpotId": "front"
  },
  "routeId": "route-adam-001",
  "worldActionId": "wa-adam-001",
  "leaseOwner": "main3d-session-abc",
  "leaseExpiresAt": "2026-06-23T18:00:00Z",
  "updatedAt": "2026-06-23T17:59:55Z",
  "version": 42
}
```

Required runtime APIs:

```text
GET  /api/agent-runtime
GET  /api/agent-runtime/<agent-id>
POST /api/agent-runtime/<agent-id>/snapshot
POST /api/agent-runtime/<agent-id>/claim-route
POST /api/agent-runtime/<agent-id>/heartbeat
POST /api/agent-runtime/<agent-id>/release-route
GET  /api/agent-runtime/events
```

Behavior:

- server snapshot is authoritative for initial placement
- one route executor lease may update an agent at a time
- other browser clients render/interpolate from server snapshots
- stale leases expire automatically
- route heartbeat writes are bounded and coalesced
- current location survives page refresh and server restart

## Routing Strategy

The current interior/exterior routing systems stay in place.

Phase 1 routing authority:

- browser `main3d.js#setAgentTarget(...)` remains the route executor
- the executor must hold a server lease before advancing a live agent
- the executor posts heartbeats with position, floor, building, route state, and target progress
- all other clients render snapshots and must not simulate that live agent independently

Later routing authority:

- a server-side route worker may be added after the browser-leased model is stable
- server-side routing must reuse or faithfully adapt the same routing constraints
- no hidden movement shortcut may bypass route-before-action rules

## Multi-Client World Model

There is one world state, not one world per browser tab.

On page load:

1. fetch roster and world data
2. fetch `/api/agent-runtime`
3. place agents from runtime snapshots when present
4. only use desk/home/random fallback when no valid runtime snapshot exists
5. subscribe or poll for runtime events

During movement:

- lease owner calculates path and sends heartbeat snapshots
- server records current location and event sequence
- observer clients interpolate toward server snapshots
- refresh/new device starts from latest server position

Required event model:

```json
{
  "sequence": 101,
  "eventId": "agent-runtime-event-101",
  "type": "agent-position",
  "agentId": "adam",
  "snapshotVersion": 42,
  "position": {"x": 120.5, "y": 87.25, "floor": 1},
  "routeId": "route-adam-001",
  "createdAt": "2026-06-23T17:59:55Z"
}
```

Polling is acceptable for the first implementation. SSE/WebSocket can come later after snapshot semantics are proven.

## Cognition Architecture

The agent brain follows a Generative Agents-inspired loop:

```text
perceive -> retrieve -> plan -> act -> observe outcome -> reflect
```

### Persona

Persistent profile fields:

- name
- role
- personality traits
- routines
- home/work anchors
- goals
- preferences
- relationships
- safety constraints

### Spatial Memory

World-aware memory of:

- known buildings
- known rooms
- known objects
- known agents
- places visited
- successful route targets
- blocked or unavailable areas

This should adapt to existing Virtual World buildings, rooms, placed objects, outdoor nodes, and interaction spots.

### Memory Stream

Every meaningful experience writes a bounded memory record:

```json
{
  "id": "mem-adam-001",
  "agentId": "adam",
  "kind": "observation",
  "text": "Adam reached the break room coffee machine and made coffee.",
  "location": {"buildingId": "office-1", "roomId": "break-room", "floor": 1},
  "importance": 0.62,
  "tags": ["coffee", "break-room", "success"],
  "createdAt": "2026-06-23T18:00:00Z"
}
```

Retrieval should rank by:

- relevance to current perception
- recency
- importance
- relationship/person relevance
- location relevance

Embeddings can be added later. The first implementation can use deterministic tags and text scoring.

### Reflection

Reflection turns repeated memories into higher-level facts:

- preferences
- habits
- relationships
- unresolved goals
- avoided failures

Reflection is periodic and bounded. It should not run on every animation heartbeat.

### Planning

Plans are structured, inspectable, and interruptible:

```json
{
  "agentId": "adam",
  "goal": "take a short break",
  "steps": [
    {"tool": "go_to_object", "target": "coffee-machine-1"},
    {"tool": "use_object", "action": "makeCoffee"},
    {"tool": "reflect", "topic": "energy"}
  ],
  "status": "active"
}
```

Plans may be model-generated only after deterministic validation exists.

### Action Execution

The model never executes raw code or raw world mutation.

It can only request validated tools:

- observe world
- remember
- reflect
- plan
- go to place
- go to object
- use object
- speak
- wait/idle
- propose high-impact mutation

Every physical action must resolve to:

- route target
- route lease
- runtime location updates
- visible action or object-use event
- terminal success/failure state

## Data Stores

Initial JSON stores:

- `agent-runtime.json`: current position, owner, route lease, movement status
- `agent-runtime-events.jsonl` or bounded event array: recent position/action events
- `agent-memory.json`: memory stream, reflections, summaries
- `agent-plans.json`: current and recent plans
- existing `world-meta.json`: durable world objects, profiles, assignments, world actions

Later migration:

- SQLite when write volume or query complexity outgrows JSON
- append-only event log for audit and replay

## Safety and Operator Controls

Required from the first usable Live Mode:

- per-agent enable/disable
- global pause
- global kill switch
- visible current intent
- route lease inspector
- active world action inspector
- recent memory/outcome summary
- rejected action audit

High-impact actions start as proposals:

- create building
- delete building
- move/delete user-created object
- edit profile identity
- send external messages
- any filesystem, network, license, or infrastructure action

## Acceptance Gates

Live Agent Mode is not working until all foundation gates pass:

- refresh same browser and agent stays at persisted location
- open second browser/device and agent appears at same location
- move agent in one client and second client sees same movement
- disable Live Mode mid-route and scripted mode resumes from current location
- enable Live Mode while scripted behavior is idle and live ownership suppresses scripted decisions
- user/manual command can override Live Mode
- no live action mutates object/building state before route arrival
- server restart reloads current agent runtime snapshot
- stale route executor lease expires and another client can recover
- memory records are written only from completed/failed validated actions

## Relationship to the Phased Plan

Implementation order lives in:

```text
docs/LIVE-AGENT-MODE-RESTART-PHASES.md
```

That plan is mandatory. Do not skip to model cognition before the runtime persistence and multi-client gates pass.
