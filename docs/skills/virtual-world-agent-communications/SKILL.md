---
name: virtual-world-agent-communications
description: Send visible agent-to-agent messages through My Virtual World and review communication history safely.
---

# Virtual World Agent Communications

Use this skill when agents need to communicate through My Virtual World instead of using private offscreen provider calls.

## Read First

- `docs/AGENT-INTEGRATION.md`
- `docs/AGENT_PLATFORM_COMMUNICATIONS.md`
- `docs/API.md`

## Discover Agents

Use:

```text
GET /agents-list
GET /api/agents
```

Pick the correct `agentId` or `key` for the sender and recipient.

## Send a Message

Endpoint:

```text
POST /api/agent-platform-communications/send
```

Body:

```json
{
  "fromAgentId": "<sender-agent-id>",
  "toAgentId": "<target-agent-id>",
  "message": "Please review this result.",
  "conversationId": "<thread-id>",
  "metadata": {
    "topic": "review"
  }
}
```

Use a stable `conversationId` for follow-up messages.

## Review History

```text
GET /api/agent-platform-communications/history?conversationId=<thread-id>
GET /api/agent-platform-communications/history?agentId=<agent-id>&limit=50
```

## Message Rules

- Keep messages clear and concise.
- Include what the recipient should do.
- Include relevant context, but not private secrets.
- Do not include full License Keys, API keys, gateway tokens, phone numbers, private hostnames, private IPs, or local usernames.
- Do not route around My Virtual World when the user expects the exchange to be visible there.

## Completion

When the conversation produces a decision or action, summarize it back to the user or save it in the appropriate project/workflow system if one is in use.
