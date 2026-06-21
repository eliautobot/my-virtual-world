# Live Agent Mode Unified Autonomy Plan

Status: PR #1 consolidated implementation plan
Owner: product architecture review
Scope: Live Agent Mode and ClawMind only

This document turns the Live Agent Mode direction into an ordered implementation plan. The target is a coherent resident system where Live Mode supersedes browser scripted behavior, the backend owns intent and state, and agents make self-authorized decisions through validated tools.

Scope update: PR #1 is now the consolidation branch for the full working Live Agent architecture, not merely a preparation/specification branch. The implementation slices below are retained as ordering and review boundaries, but remaining work should be folded into PR #1 before final merge unless Eli explicitly reopens separate child work.

## User Requirement

When an agent is in Live Agent Mode:

- Live Mode is a separate behavior system that can be enabled or disabled per agent.
- Live Mode supersedes browser scripted behavior for that agent.
- The browser must not run local idle/wander/proximity/object-use scripts for a live-owned agent.
- The backend must be the source of truth for intent, movement, object use, speech, memory, plans, and visible state changes.
- The scheduler must not feel like a hard-coded chore selector.
- Agents should choose their own goals and tool calls from a live perception frame.
- The world experience must feel connected: observe, decide, act, observe result, remember, replan, and display visible intent.

## Current Diagnosis

The current implementation has useful infrastructure, but its ownership boundaries are still mixed.

The backend has a Live Agent scheduler, provider bridge, tool registry, memory/planning records, action execution, animation replay events, and world-event feed support. This is the right foundation.

The disconnected parts are:

- `src/client/js/main3d.js` still contains a large local scripted behavior layer around `_wanderTarget`, `_idleActivity`, proximity triggers, seating/standing object routines, queue routines, social proximity routines, and random idle routing.
- `src/server/server.py#LIVE_AGENT_LOOP_ACTIONS` still defines a small static action catalog.
- The provider bridge can observe/decide, but provider choices must currently resolve back to available entries from that static catalog.
- The deterministic fallback planner is doing too much product behavior instead of being limited to offline tests, smoke tests, and provider failure recovery.
- The browser can render backend replay events, but the product contract does not yet say strongly enough that live-owned agents reject every browser scripted writer.

This explains the observed feel: the agent looks present in the world, but its autonomy still resembles "pick one available chore, route there, finish, repeat."

## Reference Options Review

Only MIT-compatible sources should be candidates for code reuse. Non-MIT sources may inform architecture, but must not be copied into the product.

| Source | License fit | What it provides | How to use it |
| --- | --- | --- | --- |
| `a16z-infra/ai-town` | MIT | Virtual town where AI characters live, chat, and socialize; shared global state, transactions, and a simulation engine. | Primary reusable reference for resident simulation architecture, shared state, game-loop separation, multiplayer-friendly world state, and extensibility. Do not migrate the product to Convex as part of this PR; adapt patterns into the existing Python/Three.js stack. |
| `nmatter1/smallville` | MIT | Generative agents for video games; agents observe surroundings, store memories, and react to state changes. | Secondary reusable reference for memory/reaction loops and game-facing NPC autonomy. Use concepts and small compatible patterns after code review. |
| `neural-maze/philoagents-course` | MIT | AI-powered game simulation engine, REST API, RAG/LLMOps, LangGraph/LangChain patterns, observability. | Secondary reusable reference for production agent orchestration, API boundaries, tracing, and evaluation. It is less directly a spatial-world engine than AI Town. |
| `joonspk-research/generative_agents` | Apache-2.0 | Canonical Generative Agents implementation and research lineage for memory, reflection, planning, and believable behavior. | Study and reimplement concepts where useful. Do not treat it as MIT; Apache-2.0 is usable but should stay clearly attributed and reviewed separately. |
| `EmergenceAI/Emergence-World` | Not MIT; research/non-commercial/proprietary terms | Long-horizon multi-agent world, location/context-gated tools, persistent memory, governance/economy concepts, "no scripts/no resets" direction. | Architecture inspiration only. Do not copy code, content, profiles, datasets, tool catalogs, prompts, or licensed material. PR #1 must keep MIT/code-reuse sources primary and classify Emergence World as inspiration-only. |

Recommended source priority:

1. Use `a16z-infra/ai-town` as the primary MIT reference.
2. Use `nmatter1/smallville` for observe-memory-react behavior.
3. Use `neural-maze/philoagents-course` for production-grade agent/API observability ideas.
4. Use Stanford Generative Agents and Emergence World as cited design inspiration only.

## Target Architecture

### 1. Behavior Ownership Boundary

Add an explicit per-agent behavior owner:

```json
{
  "agentId": "adam",
  "behaviorOwner": "live-agent-mode",
  "liveModeEnabled": true,
  "scriptedBehaviorSuppressed": true
}
```

Allowed owners:

- `manual`: user-directed actions have temporary priority.
- `scripted`: browser scripted behavior may run.
- `live-agent-mode`: backend Live Mode owns behavior.
- `paused`: no autonomous behavior may start.

Rules:

- If `behaviorOwner == "live-agent-mode"`, browser local scripted behavior is disabled for that agent.
- Browser code may render backend animation and speech for that agent.
- Browser code may not assign `_wanderTarget`, start `_idleActivity`, recruit proximity behavior, route object-use scripts, or return the agent to a desk/home through local logic.
- User-directed actions can interrupt or pause Live Mode through an explicit priority path, not through hidden browser side effects.

### 2. Backend Resident Runtime

The backend runtime should own:

- resident scheduler
- turn ownership
- perception assembly
- model/provider decision call
- deterministic fallback only when explicitly configured
- tool validation
- movement/action execution
- server-authoritative presence
- world-event feed
- memory, reflection, plans, relationships
- visible intent and audit records

The browser should own:

- scene rendering
- smooth interpolation of backend movement events
- speech bubble rendering
- object-use animation playback
- operator controls
- active-turn inspection

### 3. Self-Authorized Decision Layer

Self-authorized does not mean raw world writes. It means the agent chooses its own goal and tool call from a validated perception/tool frame.

Required loop:

1. Observe current world and agent state.
2. Assemble compact resident context.
3. Generate location-gated affordances from the real world state.
4. Send context plus tool contracts to the model/provider adapter.
5. Receive a structured decision: goal, tool, arguments, reason, expected outcome.
6. Validate the decision against tool schema, location, permissions, cooldowns, and operator rules.
7. Execute only through backend tools.
8. Record result, memory, reflection, and follow-up plan.
9. Publish replayable world events.

The model should choose tools such as `go_to_place`, `go_to_coordinates`, `use_object`, `say_to_agent`, `speak_to_room`, `publish_note`, `add_memory`, `write_diary`, `add_todo`, and `idle`. It should not choose from a tiny list of hard-coded "coffee/water/vending/printer" loop action ids.

### 4. Generated Affordance API

The current API is not too limited at the storage/action level. The limiting layer is the semantic affordance frame.

The backend should generate a frame like:

```json
{
  "agentId": "adam",
  "place": {"buildingId": "office-main", "roomId": "break-room", "floor": 1},
  "nearbyAgents": [{"agentId": "codexone", "relationship": "new contact"}],
  "visibleObjects": [
    {"objectInstanceId": "coffee-1", "tool": "use_object", "interactions": ["make_coffee"], "distance": 2.1},
    {"objectInstanceId": "bulletin-1", "tool": "publish_note", "interactions": ["post_note"], "distance": 4.8}
  ],
  "reachablePlaces": [
    {"placeId": "gym", "tool": "go_to_place", "known": false},
    {"placeId": "home-adam", "tool": "go_home", "known": true}
  ],
  "openPlans": [{"goal": "learn where food is", "next": "visit cafe"}],
  "availableTools": ["observe_world", "go_to_place", "use_object", "say_to_agent", "add_memory", "write_diary", "idle"],
  "blockedTools": [{"tool": "build_structure", "reason": "approval_required"}]
}
```

This is how Live Mode stops being a chore menu. The world exposes affordances; the resident chooses what matters.

### 5. Memory, Reflection, and Self-Feedback

Every completed or failed action should produce a feedback pass:

- What did I intend?
- What happened?
- Did it work?
- What changed in the world?
- What did I learn?
- What should I try next?

The answer is not shown as private chain-of-thought. It is stored as bounded structured memory/reflection and optionally surfaced as short visible intent:

- `Adam is looking for food.`
- `Coder is checking whether the printer is free.`
- `CodexOne is following up after hearing Adam.`

### 6. Safety Boundary

Autonomy remains bounded:

- Tier 0: observe, idle, memory, diary, todo.
- Tier 1: movement, safe object use, spatial speech.
- Tier 2: safe public expression and non-destructive decoration.
- Tier 3: construction, governance, economy, persistent relationship changes.
- Tier 4: destructive or harmful actions, disabled unless explicitly designed later.

Agents can self-authorize Tier 0-1 actions when Live Mode is enabled. Higher tiers require approval, quotas, or proposal workflows.

## Consolidated PR #1 Implementation Slices

These slices were originally written as child PRs targeting `docs/live-agent-mode-autonomy-spec`. Eli clarified that they should be addressed as part of PR #1 instead. Keep the slice numbers for traceability, but do not treat unopened PR numbers as completed work. PR #1 must avoid protected product runtime ports, run `npm test`, and run the relevant isolated Live Agent harness checks when feasible.

Current PR #1 consolidation status:

| Slice | Status in PR #1 | Evidence |
| --- | --- | --- |
| 26 - Live Behavior Ownership Boundary | Folded | Route-gate corrective commit interrupts/rejects scripted ownership conflicts and adds regression tests for scripted/user/live authority. |
| 27 - Backend Live Intent and Visible Status | Folded | Metrics, timeline, plan summaries, current intent/tool/result fields, and world-event replay evidence are asserted by the isolated Live Agent harness. |
| 28 - Generated World Affordance Frame | Folded | Turn context assembly and adaptive tool registry metrics prove real affordances, unavailable reasons, and bounded context frames. |
| 29 - Model-First Tool Planner | Folded with deterministic fallback bounded | Provider bridge and decision/proposal metrics prove provider/tool-call contracts while deterministic fallback remains smoke/offline recovery. |
| 30 - Core Tool Executor Parity | Folded | Backend world actions execute movement/object-use; safe communication, memory, public expression, planning, and idle tools execute through backend persistence. |
| 31 - Resident Memory, Reflection, and Self-Feedback | Folded | Outcome-awareness, memory-growth, replan, reflection, failed-expectation, and recovery metrics are final-gate evidence. |
| 32 - Spatial Social Loop | Folded | In-world speech, nearby reaction turns, relationship updates, and conversation memory are asserted by the isolated Live Agent harness. |
| 33 - Exploration and Public Expression | Folded | Tool exploration metrics, visible `publish_note` public expressions, world-event patches, and browser-rendered public markers are asserted by the isolated Live Agent harness. |
| 34 - Operator Console and Audit | Folded at API/audit level | `/api/agent-live-loop`, timeline/proposals endpoints, pause, kill switch, per-agent enablement, and proposal flows are asserted by tests and the isolated Live Agent harness. |
| 35 - MIT Reference Migration and Reuse Audit | Folded as a zero-import reuse audit | `LIVE_AGENT_REFERENCE_ARCHITECTURES` classifies MIT code-reuse candidates separately from non-MIT inspiration; no external code is copied into product sources. |
| 36 - Unified Autonomy Soak Gate | Folded | The isolated Live Agent harness checks no-browser turns, five-agent distribution, browser replay, reconnect replay, multi-client sync, public expression, memory growth, and final-gate evidence. |

### PR 26 - Live Behavior Ownership Boundary

Goal: make Live Mode a real behavior owner that suppresses browser scripted behavior per agent.

Depends on: current PR #1 presence continuity fixes.

Work:

- Add/normalize `behaviorOwner` in live-mode profile/state.
- Expose ownership through `/api/agents` and Live Mode settings.
- In `main3d.js`, centralize `isAgentLiveOwned(agent)`.
- Gate all browser scripted behavior entry points for live-owned agents.
- Clear local `_wanderTarget`, `_waypointPath`, `_idleActivity`, proximity recruitment, desk-return timers, and local scripted reservations when an agent becomes live-owned.
- Keep backend replay, world-event feed, and explicit user commands allowed.

Acceptance:

- Enabling Live Mode for Adam prevents new browser `_wanderTarget` and `_idleActivity` creation for Adam.
- Other non-live agents can still use browser scripted behavior.
- Browser refresh does not re-enable scripted behavior for live-owned agents.
- Regression test proves local scripted proposals are rejected for live-owned agents.

### PR 27 - Backend Live Intent and Visible Status

Goal: make live-owned intent visible and backend-owned.

Depends on: PR 26.

Work:

- Persist `currentGoal`, `currentIntent`, `currentTool`, and `expectedOutcome` on each turn.
- Publish compact intent events through world-event feed.
- Render non-private status labels in UI and agent details.
- Add operator timeline rows for observe, decide, act, result.

Acceptance:

- UI shows "what the agent is trying to do" without revealing chain-of-thought.
- Metrics show current/last intent for every enabled live agent.
- Intent survives browser refresh.

### PR 28 - Generated World Affordance Frame

Goal: replace the static chore menu as the main planner input.

Depends on: PR 26.

Work:

- Add an affordance assembler that scans bounded world state around the resident.
- Generate reachable places, nearby agents, visible objects, available interactions, blocked tools, and reasons.
- Include memories, todos, relationships, recent failures, and current needs.
- Keep `LIVE_AGENT_LOOP_ACTIONS` only as a compatibility fallback.

Acceptance:

- Perception frame lists real nearby/reachable affordances, not only the static loop actions.
- Unknown/unvisited places can be discovered and later influence choices.
- Tool availability includes structured unavailable reasons.

### PR 29 - Model-First Tool Planner

Goal: let the resident/provider choose tool calls from the generated frame.

Depends on: PR 28.

Work:

- Add strict decision schema: `goal`, `tool`, `arguments`, `reason`, `expectedOutcome`, optional `followUp`.
- Provider bridge returns tool calls, not only `selectedActionId`.
- Backend validates every tool call before execution.
- Deterministic scorer becomes offline/smoke fallback only.
- Invalid model output produces a visible skipped/repair event, not a silent chore fallback.

Acceptance:

- A provider decision can select `go_to_place`, `use_object`, `say_to_agent`, or `add_memory` directly.
- The scheduler no longer requires the decision to map to `LIVE_AGENT_LOOP_ACTIONS`.
- Bad tool args are rejected with audit evidence.

### PR 30 - Core Tool Executor Parity

Goal: make core resident tools executable through backend-owned state.

Depends on: PR 29.

Work:

- Execute `observe_world`, `get_current_location`, `go_to_place`, `go_to_coordinates`, `go_home`, `use_object`, `idle`.
- Keep movement and object use server-authoritative.
- Ensure object use routes to target before mutation.
- Expand typed object executors beyond current coffee/water/vending/printer set.

Acceptance:

- A live agent can explore a place, route there, use an object, and persist the result without a browser.
- No route stays stuck waiting for browser claim.
- Object mutation has presence-at-mutation evidence.

### PR 31 - Resident Memory, Reflection, and Self-Feedback

Goal: every action changes the agent's future behavior.

Depends on: PR 29 and PR 30.

Work:

- Add structured outcome reflection after each turn.
- Store memories, facts, diary entries, active goals, open todos, and failed expectations.
- Use memory retrieval in the next decision frame.
- Add bounded retention and summarization.

Acceptance:

- After a failed action, the next turn avoids repeating the same failure blindly.
- After successful exploration, the agent remembers the discovered place/tool.
- Metrics prove bounded memory growth.

### PR 32 - Spatial Social Loop

Goal: make agents react to each other instead of only executing solo errands.

Depends on: PR 31.

Work:

- Execute `say_to_agent`, `speak_to_room`, `send_message`, `think_aloud`.
- Add hearing rules by room/floor/outdoor distance.
- Enqueue bounded reaction turns for nearby speech and visible actions.
- Update conversation memory and relationship records.

Acceptance:

- One live agent can speak near another live agent and trigger a bounded reaction turn.
- Relationship records update after repeated interaction.
- Conversation appears in API/UI and world-event feed.

### PR 33 - Exploration and Public Expression

Goal: make curiosity visible.

Depends on: PR 31.

Work:

- Add `inspect_place`, `inspect_object`, or equivalent observe tools.
- Add safe `publish_note` and visible world markers.
- Track discovered places, discovered tools, and public notes per agent.
- Let agents create public evidence of what they learned.

Acceptance:

- Agents can explore an unknown building/object and later remember it.
- Agents can publish a safe note/post with durable visible evidence.
- Metrics show location exploration and public expression per agent.

### PR 34 - Operator Console and Audit

Goal: make Live Mode inspectable and controllable.

Depends on: PR 27, PR 31, PR 32.

Work:

- Add Live Mode console views for current turn, current goal, tool call, result, memory summary, and recent timeline.
- Add pause, resume, kill switch, per-agent enable, category allowlist, and approval queue.
- Show backend running without a connected viewer.

Acceptance:

- Operator can pause within one tick.
- Kill switch cancels active autonomous work.
- Risky tool attempts enter approval/proposal flow.

### PR 35 - MIT Reference Migration and Reuse Audit

Goal: make reference guidance license-correct.

Depends on: PR 28 or earlier.

Work:

- Update `clawMindArchitecture.referenceArchitectures` to include MIT sources as primary reusable references.
- Keep Emergence World as non-copy architecture inspiration only.
- Add a reuse audit file for any copied/adapted MIT code.
- Update smoke expectations for the expanded reference contract.

Acceptance:

- Metrics distinguish `codeReuseAllowed: true` from `inspirationOnly: true`.
- Final-gate evidence lists AI Town, Smallville, PhiloAgents, Generative Agents, and Emergence World with license classification.
- No non-MIT content is copied into product code/docs beyond short attribution links and summaries.

### PR 36 - Unified Autonomy Soak Gate

Goal: prove the mode feels connected under real use.

Depends on: PR 26 through PR 35.

Work:

- Extend the isolated Live Agent harness for no-browser turns, browser replay, reconnect replay, multi-client sync, and scripted suppression.
- Add a multi-agent soak where at least five live agents complete distributed turns.
- Add checks for tool diversity, location diversity, memory growth, reaction turns, and public expression.

Acceptance:

- At least 50 backend-owned turns with no browser.
- At least five enabled agents each complete live turns/actions.
- Browser reconnect shows the same state without reset.
- No browser-scripted behavior starts for live-owned agents.
- Final gate remains false until all required evidence is present.

## PR #1 Consolidation Checklist

PR #1 should be considered ready for final review when it contains:

- this document
- `LIVE-AGENT-MODE-SPEC.md` updates that make browser-script suppression a hard requirement
- API/docs updates that classify reference repos by license and copyability
- current reset/presence continuity fixes preserved
- no protected product runtime changes
- the PR 26 route-gate corrective work folded into this branch
- implementation evidence for slices 27 through 36 in code, tests, metrics, or the isolated Live Agent harness
- no stale requirement that separate follow-up PRs must land before PR #1 can be considered complete
