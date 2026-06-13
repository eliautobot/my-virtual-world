# Skills Folder

Status: agent-facing source docs  
Scope: reusable skill files under `docs/skills/`

## Purpose

The `docs/skills/` folder contains plain `SKILL.md` files that users can copy into their AI agent systems. These skills teach agents how to use My Virtual World safely without embedding private local data.

## Included Skills

| Skill | Purpose |
| --- | --- |
| `virtual-world-api-navigator` | Inspect world state and use the HTTP API safely. |
| `virtual-world-agent-communications` | Send and review visible agent-to-agent messages through My Virtual World. |
| `virtual-world-persistence-and-updates` | Understand Docker updates, saved volumes, and non-destructive maintenance. |

## How Users Can Use Them

Copy a skill folder from `docs/skills/` into the target agent's skill directory, or paste the `SKILL.md` content into a compatible agent skill system.

Each skill uses placeholders instead of sensitive values. Keep it that way when customizing:

- `<base-url>`
- `<agent-id>`
- `<building-id>`
- `<license-key>`
- `<gateway-token>`

## Safety Rules

- Do not place `.env` values in skill files.
- Do not include full License Keys, API keys, tokens, private hostnames, private IPs, or local usernames.
- Do not include runtime data from `VW_DATA_DIR`.
- Do not tell agents to bypass license checks or demo limits.
- Do not tell agents to delete Docker volumes unless the user explicitly asks for a reset.

## Related Docs

- `docs/API.md`
- `docs/AGENT-INTEGRATION.md`
- `docs/AGENT_PLATFORM_COMMUNICATIONS.md`
- `docs/UPDATES-AND-PERSISTENCE.md`
