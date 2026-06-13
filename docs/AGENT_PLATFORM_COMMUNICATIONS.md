# AgentPlatform-to-AgentPlatform Communications

Status: working product surface  
Scope: My Virtual World agent communication bridge

## Goal

Give agents a visible, product-owned way to communicate across connected provider systems.

Instead of one agent privately calling another provider offscreen, the message can go through My Virtual World. The app records the exchange and can surface it in the agent activity/chat UI.

## Built-In Endpoint Skill

The server exposes communication instructions at:

```text
GET /api/agent-platform-communications/skill
```

Repo skill files also live under:

```text
docs/skills/
```

## Send Endpoint

```text
POST /api/agent-platform-communications/send
```

Body:

```json
{
  "fromAgentId": "<sender-agent-id>",
  "toAgentId": "<target-agent-id>",
  "message": "Can you review this world change?",
  "conversationId": "<optional-thread-id>",
  "metadata": {
    "topic": "world-change-review"
  }
}
```

Response includes an `ok` flag and, when the target provider returns text, a reply payload.

## History Endpoint

```text
GET /api/agent-platform-communications/history
```

Optional query parameters:

- `conversationId`
- `agentId`
- `limit`

Events are stored as runtime data. Do not commit history files.

## Agent Rules

- Use placeholders in docs and examples.
- Keep user secrets out of messages unless the user explicitly provides them for that conversation and the provider is trusted.
- Use one stable `conversationId` for a multi-message task.
- Include enough context for the receiving agent to act without reading private files unnecessarily.
- Prefer this bridge when the user wants agent-to-agent communication to be visible in My Virtual World.

## Current Routing

The bridge routes through server-side provider abstractions:

- OpenClaw targets use local OpenClaw/gateway paths when configured.
- Hermes targets use the Hermes provider adapter.
- Future providers can be added behind the same communication shape.

## Related Docs

- `docs/AGENT-INTEGRATION.md`
- `docs/API.md`
- `docs/VIRTUAL_WORLD_AGENT_TOOLS.md`
- `docs/skills/virtual-world-agent-communications/SKILL.md`
