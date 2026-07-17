# Live Agent Mode Autonomy Upgrade — 2026-07-07

Implements the Live Agent Mode autonomy upgrade for OpenClaw agents.
All changes documented here for revert safety. Baseline release before these
changes: `v1.0.22` (`192f95d`).

## What changed

### 0. Location awareness + route progress watchdog
- `src/server/server.py`
- Perception now includes a `location` frame (`agent-live-mode-location/v1`):
  real body position read from the realtime `agent-runtime.json` document,
  the active action's intended coordinates, and the current distance to it,
  with the coordinate system documented (`api-units, 1 tile = 40 units`).
- The model decision prompt now tells the agent where its body currently is.
- New route progress watchdog: while a live-mode action is `routing` /
  `route_pending`, each tick samples distance-to-target. If ~75s pass without
  at least 12 api-units of improvement (and the agent is not already within
  the 60-unit arrival radius), the stalled action is cancelled with
  `no_route_progress`, the agent gets a short cooldown, and the next tick
  replans fresh. Events log `route-watchdog-cancel` with position/target
  evidence; agent stats count `routeWatchdogCancels`.

### 1. Model decision layer (`model-planner-v1`)
- `src/server/server.py`
- The live loop still builds the deterministic `planner-v2` decision frame
  (needs, goals, Resident Profile, memory, reliability scoring).
- When `modelDecisionEnabled` is on, the loop uses the resident's configured
  OpenClaw, Hermes, or Codex model as inference transport while the Virtual
  World Resident Profile remains the authoritative persona.
- The model cannot invent actions. Reply must resolve to a visible world
  affordance or skip; anything else waits for a valid resident-model decision
  instead of silently substituting the planner-v2 ranked choice.
- Per-agent cooldown (`modelDecisionMinIntervalSec`, default 20s) and timeout
  (`modelDecisionTimeoutSec`, default 45s) keep token usage bounded.
- All world execution still flows through the validated visible-action
  contract — the model only chooses WHICH safe action runs.

This earlier design note is superseded by
`LIVE-AGENT-MODE-RESIDENT-AUTONOMY-KERNEL.md` for the current authority,
memory, dynamic-affordance, and observability contract.
- New functions: `_live_agent_model_decision_config`, `_live_agent_model_decide`,
  `_live_agent_model_decision_parse`, `_live_agent_model_decision_prompt`,
  `_live_agent_model_decision_recover_reply`, plus in-memory cooldown state.

### 2. User chat preemption (user always has top priority)
- `src/server/server.py`, `src/client/js/chat.js`
- New endpoint `POST /api/agent-live-loop/user-attention`
  (`{agentId, source?, messagePreview?, holdSec?, clear?}`).
- When the user messages an agent (Virtual World chat window → OpenClaw
  gateway path or `/api/agent-platform-communications/send` human path), the
  agent is marked as "attending to the user":
  - active live-mode world actions/move intents are cancelled immediately
  - the live loop skips that agent (`reason: user-attention`) while the hold
    is active (default 180s per message, refreshed on each message)
  - presence shows "Attending to the user"
- User-directed and scripted actions from other sources are never touched.
- Config: `userChatPreemptionEnabled` (default true),
  `userChatPreemptionHoldSec` (30–1800, default 180).

### 3. Free consume placement (no forced desk return)
- `src/realtime/agent-runtime-room.mjs`
- New `makeServerScriptedFreeConsumeTarget(...)`: when a LIVE-mode agent
  finishes a dispense pickup (coffee/water/vending/microwave), it now picks a
  free seat it likes — couch, armchair, loveseat, sectional, chair, park
  bench — weighted toward nearby seats with a per-agent time-salted hash so
  choices vary. Scripted (non-live) agents keep the original desk routine.
- Queue-line order at dispensers is untouched (queue reservation/promotion
  logic runs before the consume handoff).
- Seat availability is checked through `isServerScriptedObjectTargetAvailable`
  so agents don't steal claimed seats.
- Physical presence rules unchanged: the consume target routes the agent to
  the seat before the consume animation plays.

### 4. Operator visibility
- `GET /api/agent-live-loop` runtime now includes:
  - `modelDecision` (enabled, mode, timeout, min interval, supported providers)
  - `guardrails.userChatPreemptionEnabled` / `userChatPreemptionHoldSec`
  - `userAttention` map of agents currently attending to the user
- Each agent's `lastDecision` now records `modelDecision` detail
  (status, chosen id, latency, reply preview) for the operator console.
- Loop events log `user-attention` entries with interrupted action ids.

### 5. Live Agent world awareness / cross-port conflict guard
- `src/server/server.py`, `src/client/js/settings.js`, `src/client/js/main3d.js`
- Each enabled live agent now claims one shared Live Agent world in
  `<OpenClaw home>/workspace/uploads/.runtime/live-agent-worlds.json`
  (`VW_LIVE_AGENT_WORLD_REGISTRY_FILE` can override the path).
- The claim records the owning world name, public origin, and configured host
  port with a freshness TTL (`VW_LIVE_AGENT_WORLD_REGISTRY_TTL_SEC`, default
  1800 seconds).
- `GET /api/agent-live-world` returns the current world and active claims.
- `GET /api/agents`, `GET /api/agent/{id}/live-mode`, and live-agent
  perception now include `liveWorld`.
- `POST /api/agent/{id}/live-mode` returns HTTP 409 if another fresh world
  owns that agent, with details about the current owning world.
- `POST /api/agent-model/actions` also refuses stale local metadata when the
  shared registry says another port owns the agent.
- Settings and the per-agent panel show/disable conflicted toggles so operators
  see the owning world before creating a control conflict.

## New/changed settings (POST /api/agent-live-loop)
| Key | Range | Default | Meaning |
| --- | --- | --- | --- |
| `modelDecisionEnabled` | bool | true | Ask the agent's own model to choose actions |
| `modelDecisionTimeoutSec` | 10–180 | 45 | Gateway chat timeout per decision |
| `modelDecisionMinIntervalSec` | 30–3600 | 90 | Per-agent cooldown between model calls |
| `userChatPreemptionEnabled` | bool | true | User messages halt live tasks |
| `userChatPreemptionHoldSec` | 30–1800 | 180 | How long the agent stays reserved for the user |

## Verification
- `python3 scripts/verify-live-agent-autonomy.py` — 40/40 checks
  (preemption, model parse/gating/fallback, location/watchdog, live-world conflict guard, settings persistence)
- `python3 scripts/verify-live-agent-resident-profile.py` — pass
- `python3 scripts/verify-building-placement-rules.py` — pass
- `npm run verify:smoke` — pass
- `npm run verify:realtime` — pass
- Manual live-world checks after deploy

## Revert
```bash
git checkout v1.0.22 -- src/server/server.py src/realtime/agent-runtime-room.mjs src/client/js/chat.js
rm scripts/verify-live-agent-autonomy.py docs/LIVE-AGENT-MODE-AUTONOMY-2026-07-07.md
# then rebuild the affected app and realtime services
```
Note: `src/server/server.py`, `main3d.js`, and the docs also contain the
2026-07-06 building-placement + resident-profile work that is NOT yet in a
release tag; revert selectively if only the autonomy layer must come out.
