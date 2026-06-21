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

The product UI currently keeps this mode hidden behind `Live Agent Mode Coming Soon`. The implementation target is a backend-owned autonomous resident loop where agents act through validated tools, persist decisions and side effects server-side, suppress browser scripted behavior for live-owned agents, and publish browser-replayable animation events. The MIT-first implementation references and ordered child PR plan live in [LIVE-AGENT-MODE-UNIFIED-AUTONOMY-PLAN.md](LIVE-AGENT-MODE-UNIFIED-AUTONOMY-PLAN.md); [LIVE-AGENT-MODE-SPEC.md](LIVE-AGENT-MODE-SPEC.md) remains the detailed contract and acceptance criteria.

Relevant endpoints:

```text
GET /api/agent/<agent-id>/live-mode
POST /api/agent/<agent-id>/live-mode
POST /api/agent-model/actions
POST /api/world-actions
POST /api/agents/<agent-id>/move
POST /api/live-agent-mode/tool-calls
GET /api/live-agent-mode/in-world-communications
```

Agent Live Mode is license-gated. Agents must not bypass or weaken that gate.

Live Agent Mode communication tools such as `say_to_agent`, `speak_to_room`, `send_message`, and `think_aloud` create My Virtual World in-world communication events. These are persisted separately from provider relay messages and include nearby observer/reaction opportunities. Memory and planning tools such as `add_memory`, `search_memory`, `write_diary`, `add_todo`, `complete_todo`, and `idle` persist resident memory/planning state in the Live Agent loop store.

ClawMind memory is a bounded stream of observations, conversations, facts, diary entries, and synthesized reflections. `GET /api/live-agent-mode/memory/<agent-id>` and the `search_memory` tool rank stream entries by relevance, recency, and importance. Reflection synthesis is deterministic and creates higher-level belief entries after enough salient experiences accumulate.

## World Actions and Movement

World actions are the preferred durable API for agent/object interactions. Movement can be requested through `/api/agents/<agent-id>/move`, while object interactions should be represented as world actions.

Read:

- `docs/API.md`
- `docs/WORLD-DATA.md`
- `src/client/js/agent-life-world-action-schema.mjs`

## Provider Secrets

Provider configuration may include tokens, API keys, or local paths. Keep them in local settings or `.env`; never place real values in docs, commits, examples, or agent replies.
