# Agent Integration

Status: product reference  
Scope: OpenClaw, Hermes, and agent-to-agent communication

## Purpose

My Virtual World is a visual control surface for local agent systems. It can show agents in a shared 3D world, display their presence/activity, let users chat with them, and route agent-to-agent messages through a visible app-owned communication layer.

## Provider Model

The app can discover and represent agents from multiple providers.

Current provider paths:

- OpenClaw through local workspace/config and gateway status.
- Hermes through the local Hermes provider adapter.
- Future providers through an optional provider relay.

The world does not replace provider runtimes. Providers remain responsible for their own tools, sessions, permissions, and execution.

## Agent Roster

Use:

```text
GET /api/agents
GET /agents-list
```

`/api/agents` is the world-facing roster. It includes status, assignments, appearance, personality, and live-mode flags when available.

`/agents-list` is formatted for chat selection. It includes provider kind and session keys.

## Presence

Use:

```text
GET /api/status
GET /api/presence
GET /api/presence/<agent-id>
GET /api/agent-chat
```

Presence is visual state. It should not be treated as security authority.

## Chat

OpenClaw chat uses the local gateway information from:

```text
GET /gateway-info
GET /session-info
```

Hermes chat uses:

```text
POST /api/hermes/runs
GET /api/hermes/runs/{run_id}/events
POST /api/hermes/runs/{run_id}/approval
POST /api/hermes/runs/{run_id}/stop
POST /api/hermes/chat
GET /api/hermes/history
GET /api/hermes/live
```

The `/api/hermes/runs*` endpoints are the primary native Hermes API path and proxy Hermes' public run/SSE endpoints while keeping API keys server-side. `/api/hermes/chat` and `/api/hermes/live` remain compatibility fallback paths for installs without the native API server.

## AgentPlatform-to-AgentPlatform Communication

Use this when one agent needs to talk to another through My Virtual World so the exchange is visible and auditable.

Endpoint:

```text
POST /api/agent-platform-communications/send
```

Body:

```json
{
  "fromAgentId": "<sender-agent-id>",
  "toAgentId": "<target-agent-id>",
  "message": "Please review the current plan.",
  "conversationId": "<optional-thread-id>",
  "metadata": {
    "topic": "coordination"
  }
}
```

History:

```text
GET /api/agent-platform-communications/history?conversationId=<thread-id>
GET /api/agent-platform-communications/history?agentId=<agent-id>&limit=50
```

Agent-readable skill content:

```text
GET /api/agent-platform-communications/skill
```

## Communication Rules for Agents

- Keep messages concise and task-focused.
- Include the target agent id.
- Use a stable `conversationId` for ongoing work.
- Do not include secrets, tokens, full license keys, or private customer data.
- Do not use offscreen provider-specific messaging when the user expects the conversation to be visible in My Virtual World.
- Record important decisions in the relevant project or user-facing report when appropriate.

## Agent Live Mode

Agent Live Mode lets activated installs accept higher-level agent action requests.

Relevant endpoints:

```text
GET /api/agent/<agent-id>/live-mode
POST /api/agent/<agent-id>/live-mode
POST /api/agent/<agent-id>/live-mode/reset
GET /api/agent/<agent-id>/goals
POST /api/agent/<agent-id>/goals
POST /api/agent-model/actions
POST /api/world-actions
POST /api/agents/<agent-id>/move
```

Agent Live Mode is license-gated. Agents must not bypass or weaken that gate.

The in-app global feature switch is also a server-side authority boundary. Turning it off cancels active Live Agent work, fences late model replies, releases local world claims, and prevents API callers from forcing a tick or creating a new Live Agent action. Per-agent selections remain saved for a clean later re-enable.

Normal chat does not create Live Agent attention records while the global switch is off. The server independently rejects disabled-mode per-agent settings, attention, loop-setting, proposal-resolution, world-action, and move-intent writes, while observability endpoints remain read-only. The explicit selected-agent reset remains available for operator cleanup.

Model decisions use a two-phase asynchronous handoff: while a provider request is in flight, that resident does not also start a deterministic action from the same perception frame. A later tick applies a fenced choice only when it still maps to the current safe executable candidate surface. Provider failures/cooldowns remain in an inspectable wait state, while unsupported categories, unavailable typed actions, and stale choices return structured evidence to the next Resident turn; no unrelated deterministic action is substituted.

Planner turns can produce a durable hierarchy of stable goal, task, and step ids. The server persists dependency state and verified outcomes, schedules bounded retries, and asks the planner to repair only unfinished work when an action or target disappears. These ledgers survive normal restarts; disabling Live Mode pauses them, and re-enabling resumes them.

The selected-agent reset endpoint is narrower than a world reset: it clears transient loop state, notes, transcript copies, pending decisions, and active Live Agent actions for one resident only. It preserves provider workspace files, the Resident Profile, assignments, buildings, objects, and other residents.

Fresh restart specs:

- `docs/LIVE-AGENT-MODE-RESTART-SPEC.md`
- `docs/LIVE-AGENT-MODE-RESTART-PHASES.md`
- `docs/LIVE-AGENT-MODE-COLYSEUS-SIDECAR.md`
- `docs/LIVE-AGENT-MODE-DURABLE-GOALS.md`

## World Actions and Movement

World actions are the preferred durable API for agent/object interactions. Movement can be requested through `/api/agents/<agent-id>/move`, while object interactions should be represented as world actions.

Read:

- `docs/API.md`
- `docs/WORLD-DATA.md`
- `src/client/js/agent-life-world-action-schema.mjs`

## Provider Secrets

Provider configuration may include tokens, API keys, or local paths. Keep them in local settings or `.env`; never place real values in docs, commits, examples, or agent replies.
