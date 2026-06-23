# Live Agent Mode Restart Phases

Status: fresh-start phased build plan
Date: 2026-06-23
Companion spec: `docs/LIVE-AGENT-MODE-RESTART-SPEC.md`

This plan builds Live Agent Mode progressively. Each phase must be small enough to review, test, and roll back.

The order matters: persistent runtime state comes before agent intelligence.

## Phase 0 - Baseline and Guardrails

Goal: lock the clean starting point.

Work:

- confirm current `main` is clean
- document existing routing/API ownership
- keep old spec files out of the repo
- add this fresh spec and phased plan
- define acceptance gates and terms

Do not:

- edit routing modules
- add model calls
- add browser automation harnesses
- change production feature exposure

Done when:

- fresh docs are committed or ready to commit
- current repo docs link to them
- no old Live Agent spec files remain in the active docs tree

## Phase 1 - Colyseus Agent Runtime Store

Goal: create the authoritative Colyseus location/presence foundation without changing visible browser behavior.

Work:

- add Colyseus `agent_runtime` room
- add `agent-runtime.json` helpers
- add runtime snapshot schema
- add route lease schema
- add event sequence schema
- add Colyseus messages:
  - `runtime:snapshot`
  - `runtime:claimRoute`
  - `runtime:heartbeat`
  - `runtime:releaseRoute`
- expose sidecar health and read-only runtime snapshot endpoints
- add validation for agent ids, coordinates, floors, buildings, route ids, and lease expiry
- add smoke tests for store read/write/restart recovery and lease conflicts

Acceptance:

- a test can write an agent location, restart the server process, and read the same location
- lease conflict returns a clear error
- stale lease can be reclaimed
- runtime events have monotonic sequence numbers

No AI yet.

## Phase 2 - Browser Hydration and Multi-Client Rendering

Goal: all browsers render agents from the same runtime snapshot.

Work:

- add browser Colyseus runtime client in `src/client/js/agent-runtime-client.mjs`
- load the Colyseus browser SDK from `/node_modules/@colyseus/sdk/dist/colyseus.js`
- update agent loading to connect to the runtime room
- place agents from runtime before desk/home/random fallback
- subscribe to Colyseus runtime events and state patches
- add interpolation for observer clients
- mark live-owned agents as observer-only unless this client owns the route lease
- add debug readout for runtime source, version, lease owner, and last update

Acceptance:

- refresh does not randomize a persisted agent
- second browser opens at the same location
- stale/missing runtime falls back cleanly to existing placement
- non-live agents still behave normally

First child PR scope:

- hydrate initial agent `x/y/floor` from the Colyseus runtime snapshot
- expose `window.__VWAgentRuntimeHydrationStatus` for browser verification
- keep desk/home/random fallback intact when realtime is disabled, disconnected, or missing a snapshot
- mark live-owned/leased snapshots as observer-only so old scripted movement does not immediately fight runtime truth
- leave route claims, heartbeat publication, and executor recovery to Phase 3

No live movement yet.

## Phase 3 - Leased Route Execution Through Existing Routing

Goal: move live agents through current routing while server snapshots stay authoritative.

Work:

- make the active browser route executor claim a lease
- executor uses existing `setAgentTarget(...)`
- executor sends heartbeat snapshots during movement
- observer clients render from heartbeat snapshots only
- terminal arrival writes final authoritative location
- route failure writes failure state and releases lease

Acceptance:

- one client moves a live agent and another client sees the same movement
- refresh during movement resumes from the latest server snapshot
- executor close/reload expires lease and another client can recover
- no duplicate browser clients simulate the same live-owned agent

No cognition yet. Movement can be triggered manually or by a test API.

## Phase 4 - Live Mode Ownership and Toggle Semantics

Goal: make enable/disable behavior reliable.

Work:

- add explicit behavior owner state to runtime
- implement enable Live Mode:
  - keep current runtime location
  - suppress new scripted decisions
  - clear interruptible scripted state
- implement disable Live Mode:
  - stop new live turns
  - release route lease
  - keep current runtime location
  - allow scripted behavior to resume
- preserve manual/user override priority
- expose owner/mode in `/api/agents` or runtime response

Acceptance:

- enabling Live Mode does not teleport the agent
- disabling Live Mode does not reset the agent
- user/manual move can override Live Mode
- Live Mode does not override an active manual action
- scripted behavior cannot take over while Live Mode owns the agent

## Phase 5 - Route-Before-Action World Actions

Goal: live physical actions require presence at the target.

Work:

- connect live action requests to runtime route targets
- require target resolution for object/building/room/world-point actions
- block mutation until runtime location is within target tolerance
- record presence-at-mutation evidence
- emit runtime/world-action events for route start, progress, arrival, action start, action complete/fail
- cover a small set of safe object actions first

Initial safe object actions:

- get water
- get coffee
- sit/rest
- inspect/read object
- use whiteboard/planning object if already supported

Acceptance:

- action without route target is rejected or converted to proposal
- object use only completes after arrival
- hidden mutation attempts are rejected and audited
- existing manual object use still works

## Phase 6 - Generative Agents Memory Core

Goal: add the first Generative Agents-style cognitive store without model autonomy.

Work:

- add persona/profile adapter
- add spatial memory records
- add memory stream store
- add deterministic memory retrieval
- add reflection records
- add action outcome memory writes
- add bounded retention and summarization rules

Architecture mapping:

- Generative Agents persona -> Virtual World agent profile
- spatial memory -> buildings/rooms/objects/known places
- memory stream -> `agent-memory.json`
- reflection -> bounded summary records
- planning -> next phase

Acceptance:

- completed actions write memories
- failed actions write memories with failure reason
- retrieval returns relevant recent/important/location-matched memories
- memory growth is bounded
- no model call is required

## Phase 7 - Planner and Tool Frame

Goal: let the agent choose from validated world tools.

Work:

- build perception frame from:
  - runtime location
  - nearby agents
  - nearby objects
  - available actions
  - recent events
  - relevant memories
  - current needs/preferences
- define strict tool schema
- add deterministic planner fallback for tests
- add plan records
- validate all tool arguments before execution

Initial tools:

- `observe_world`
- `retrieve_memories`
- `make_plan`
- `go_to_place`
- `go_to_object`
- `use_object`
- `say_to_agent`
- `idle`
- `reflect`

Acceptance:

- planner can choose a valid tool from current affordances
- invalid tool args are rejected with audit evidence
- deterministic fallback can run without an LLM
- tool execution still routes through phases 3-5

## Phase 8 - Model/Provider Integration

Goal: add LLM-backed decisions safely after deterministic planning works.

Work:

- add provider adapter interface
- send compact perception/tool frame to provider
- require strict JSON/tool-call response
- repair or reject invalid output
- log safe intent summary, not private chain-of-thought
- add rate limits, timeouts, and fallback

Acceptance:

- model can choose a routeable object action
- invalid model output does not mutate state
- provider timeout falls back safely
- operator can inspect current goal/tool/result

## Phase 9 - Social Behavior and Conversations

Goal: make agents react to each other in the visible world.

Work:

- define hearing/range rules by room/floor/outdoor distance
- add `say_to_agent` and `speak_to_room`
- store conversation events
- write relationship/memory updates after completed conversations
- enqueue bounded reaction opportunities

Acceptance:

- one live agent can speak near another
- nearby live agent can react in a later turn
- conversation is visible in UI/API
- memories/relationships update after validated social events

## Phase 10 - Operator Console and Product Controls

Goal: make Live Agent Mode understandable and controllable.

Work:

- current agent mode/owner/status panel
- route lease panel
- current goal/tool/result panel
- memory summary panel
- pause/resume
- kill switch
- rejected action log
- proposal queue for high-impact actions

Acceptance:

- operator can pause new turns
- kill switch releases active live leases/actions
- operator can see why an agent is moving without reading private chain-of-thought
- high-impact actions remain proposal-only

## Phase 11 - Recovery, Restart, and Soak

Goal: prove reliability.

Work:

- browser refresh tests
- two-browser tests
- server restart tests
- stale lease recovery tests
- route failure tests
- long-run memory/plan tests
- performance checks for runtime writes

Acceptance:

- refresh three times without position reset
- two browsers stay synced during movement
- server restart preserves current location
- stale executor is recovered
- no unbounded event/memory growth
- no action remains stuck because of a missing browser lease

## Phase 12 - Optional Server-Side Route Worker

Goal: reduce dependence on an open browser after the leased-browser runtime is proven.

This phase is optional and should not block the first useful Live Agent Mode.

Work:

- evaluate extracting or mirroring route constraints server-side
- compare browser route result vs server route result
- add background route worker only if parity is testable
- keep browser replay as renderer

Acceptance:

- server route worker follows the same constraints as existing routing
- browser can replay server-owned movement
- fallback to browser lease still works

## Phase 13 - Production Exposure

Goal: expose Live Agent Mode only after foundations are reliable.

Work:

- lock feature flags
- update user docs
- add migration notes
- add release checklist
- add rollback plan

Acceptance:

- all foundation gates pass
- no old spec/harness dependency remains
- feature can be enabled/disabled without data loss
- rollback preserves agent runtime snapshots

## Required PR Strategy

Use small PRs. Suggested PR boundaries:

1. Docs only: fresh spec and phase plan
2. Runtime store/API
3. Browser hydration
4. Route lease/heartbeat
5. Ownership/toggles
6. Route-before-action for one object action
7. Memory core
8. Planner/tool frame
9. Provider integration
10. Social loop
11. Operator console
12. Recovery/soak

Each PR must include:

- exact scope
- focused tests
- no unrelated refactors
- no old staging spec resurrection
- no routing module rewrite unless the PR is explicitly about routing
