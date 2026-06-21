# Virtual World Agent Tools

Status: canonical agent-facing tool index  
Scope: My Virtual World Product

## Purpose

This is the organized index for APIs and repo skills that agents can use through My Virtual World. It keeps tool guidance in one place and points agents to the deeper docs when needed.

## Built-In Product Surfaces

### World State

- `GET /api/meta`
- `POST /api/meta`
- `GET /api/buildings`
- `GET /api/building/<building-id>`
- `POST /api/building`
- `POST /api/buildings`
- `DELETE /api/building/<building-id>`
- `GET /api/chunks`
- `GET /api/chunk/<cx>/<cy>`
- `POST /api/chunk/<cx>/<cy>`
- `DELETE /api/chunk/<cx>/<cy>`
- `GET /api/streets`
- `POST /api/streets`

Use these only when the user wants world inspection or editing. Demo mode may block writes.

### Agents and Presence

- `GET /api/agents`
- `GET /agents-list`
- `GET /api/status`
- `GET /api/presence`
- `GET /api/presence/<agent-id>`
- `GET /api/agent-chat`

Use these to understand who is visible in the world and what they are doing.

### Agent Communication

- `POST /api/agent-platform-communications/send`
- `GET /api/agent-platform-communications/history`
- `GET /api/agent-platform-communications/skill`

Use these when agents need to communicate through the visible My Virtual World bridge.

### Agent Live Mode and World Actions

- `GET /api/world-actions`
- `POST /api/world-actions`
- `GET /api/world-actions/active`
- `GET /api/world-actions/history`
- `GET /api/world-action-events`
- `POST /api/agent-model/actions`
- `POST /api/agents/<agent-id>/move`
- `GET /api/world-actions/object-availability`
- `GET /api/live-agent-mode/tools`
- `POST /api/live-agent-mode/actions/dry-run`
- `POST /api/live-agent-mode/tool-calls/validate`
- `POST /api/live-agent-mode/tool-calls`
- `GET /api/live-agent-mode/in-world-communications`

Use these for durable movement and object-interaction workflows. Agent Live Mode is license-gated and should remain hidden until the backend-owned autonomy acceptance criteria in `docs/LIVE-AGENT-MODE-SPEC.md` are met.

The `/api/live-agent-mode/tools` registry is backend-owned and typed. Dry-run validation checks tool arguments, location gates, object permissions, and build/create proposal gates without enabling the public Live Agent UI. Safe communication, memory, planning, and idle tool calls can persist in-world messages, reaction opportunities, relationships, resident memory, diary entries, and todos through the backend.

### Hermes

- `POST /api/hermes/chat`
- `GET /api/hermes/history`
- `GET /api/hermes/live`
- `GET /api/hermes/approval/pending`
- `POST /api/hermes/approval/respond`
- `GET /api/hermes/test`
- `POST /api/hermes/test`

Use these only when Hermes is configured.

## Repo Skill Files

Agent-readable repo skills live in `docs/skills/`:

- `virtual-world-api-navigator`
- `virtual-world-agent-communications`
- `virtual-world-persistence-and-updates`

These are plain `SKILL.md` files that users can copy into their agent systems.

## Organization Rules

- Use `docs/API.md` as the endpoint reference.
- Use `docs/WORLD-DATA.md` for saved JSON and world model details.
- Use `docs/AGENT-INTEGRATION.md` for provider and communication behavior.
- Use `docs/LIVE-AGENT-MODE-SPEC.md` before changing autonomous resident behavior.
- Use `docs/UPDATES-AND-PERSISTENCE.md` before changing install/update instructions.
- Do not duplicate secrets or real private paths in examples.
- Do not add endpoint docs that claim a feature exists before the server implements it.

## Current Gaps

- The repo skills are source documentation files; the app does not yet expose a full Skills Library UI like My Virtual Office.
- Provider-neutral browser control is still limited; use browser endpoints only when licensed and configured.
- World Action APIs are available, but high-level autonomous planning should still respect user intent and license gates.
