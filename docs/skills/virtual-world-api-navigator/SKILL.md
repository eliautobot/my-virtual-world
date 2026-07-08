---
name: virtual-world-api-navigator
description: Inspect and use My Virtual World HTTP APIs safely without exposing secrets or overwriting user worlds.
---

# Virtual World API Navigator

Use this skill when a user asks you to inspect My Virtual World, debug world state, review buildings/roads/agents, or make API-backed changes.

## Start Safely

1. Read `docs/API.md`.
2. Read `docs/WORLD-DATA.md`.
3. Use the user's base URL, or default to `http://localhost:8590`.
4. Prefer read-only endpoints first.
5. Ask before destructive writes or deletes.

## Read-Only Checks

Useful endpoints:

```text
GET /healthz
GET /api/license
GET /vw-config
GET /api/meta
GET /api/streets
GET /api/buildings
GET /api/building-placement-rules
GET /api/chunks
GET /api/agents
GET /api/status
```

For one building:

```text
GET /api/building/<building-id>
```

For one chunk:

```text
GET /api/chunk/<cx>/<cy>
```

## Writes

Only write after the user asks for a change.

Common write endpoints:

```text
POST /api/meta
POST /api/building
POST /api/buildings
POST /api/chunk/<cx>/<cy>
POST /api/streets
POST /api/assignments
POST /api/decorations
```

Before saving a building, query `GET /api/building-placement-rules`. Building footprints may snap next to streets, but must not intersect roadway, curb/gutter, or sidewalk surfaces. If a save returns HTTP `409` with `building_roadway_overlap`, move or resize the footprint to a nearby non-overlapping location before retrying.

Destructive endpoints:

```text
DELETE /api/building/<building-id>
DELETE /api/chunk/<cx>/<cy>
```

Get explicit user approval before using destructive endpoints.

## Data Safety

- Do not print full License Keys.
- Do not print API keys, gateway tokens, Twilio credentials, private hostnames, private IPs, or private local usernames.
- Do not edit raw `VW_DATA_DIR` files when the API can do the job.
- Do not run Docker volume reset commands unless the user explicitly asks to wipe the world.
- Do not bypass demo/license feature locks.

## Reporting

Report:

- what you checked
- what changed
- which endpoint or file was involved
- how the user can verify it

Do not include sensitive values in the report.
