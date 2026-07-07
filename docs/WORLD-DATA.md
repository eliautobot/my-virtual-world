# World Data Model

Status: product reference  
Scope: saved world JSON and runtime concepts

## Storage

My Virtual World stores runtime data under `VW_DATA_DIR`.

In Docker, `VW_DATA_DIR=/data` and `/data` is backed by the Docker volume named `vw-data`.

Typical saved files:

```text
VW_DATA_DIR/
  world-meta.json
  buildings/
    <building-id>.json
  chunks/
    <cx>_<cy>.json
  config.json
  license.json
  vo-status/
```

Do not commit this data. It can contain private user world state, local configuration, agent names, messages, and activation receipts.

## World Metadata

`world-meta.json` contains global state:

- world name
- setup/initialization flags
- street list
- agent assignments
- agent profiles
- decorations
- Agent Life world action state

The `initialized` flag prevents starter buildings from being recreated after users delete them.

## Buildings

Building files live in `buildings/<building-id>.json`.

Common fields:

- `id`
- `name`
- `x`, `z`
- `width`, `depth`
- `interior`
- outdoor/exterior metadata when present

`interior.furniture[]` stores placed furniture and usable objects. These records are intentionally lightweight runtime records. Some newer Agent Life modules describe richer object-instance schemas, but existing persistence still centers on building furniture records.

`interior.walls[]` stores walls and structural interior layout.

## Furniture and Object Use

Furniture records usually include:

- `type`
- `x`, `z`
- `rotation`
- `floor`
- `buildingFloor`
- optional action metadata
- optional mount or appliance metadata
- optional state such as `coffeeState` or `applianceState`

Usable objects are connected to capability tags and world actions. Examples:

- `life.food`
- `life.hydration`
- `planning.meeting`
- `world.terrain`
- `maintenance.clean`

See:

- `src/client/js/agent-life-capability-tags.mjs`
- `src/client/js/agent-life-object-catalog-schema.mjs`
- `src/client/js/agent-life-object-instance-schema.mjs`
- `src/client/js/agent-life-world-action-schema.mjs`

## Counter Appliances

The starter Office counter appliance setup uses three slot ids:

- `appliance-left`
- `appliance-center`
- `appliance-right`

In the current starter Office:

- counter is furniture index `17`
- microwave is furniture index `18`
- coffee machine is furniture index `19`
- microwave mounts to `appliance-right`
- coffee machine mounts to `appliance-center`

The server has a narrow compatibility repair for this starter Office. It only updates metadata when the expected original objects are still present. It does not recreate appliances that a user deleted, and it does not replace a customized building.

## Chunks and Terrain

Chunks are terrain files addressed by integer coordinates:

```text
chunks/<cx>_<cy>.json
```

The client asks for chunks with:

```text
GET /api/chunk/<cx>/<cy>
```

If a chunk is missing, the server returns `null`. The client generates default terrain and applies road/sidewalk overlays from `/api/streets`.

## Streets

Street data is stored in world metadata as line segments. Streets drive:

- road visuals
- road/sidewalk terrain overlay
- vehicle paths
- road checks used by traffic logic

Fresh installs use the starter street map from `src/client/js/starter-map.mjs` and server-side guards in `server.py`.

## Agents

Agents come from connected provider systems such as OpenClaw or Hermes. The world stores overlays such as:

- home/work building assignments
- appearance
- personality
- Virtual World Resident Profile
- profile docs
- Agent Live Mode setting

Provider-owned runtime details stay with the provider. My Virtual World stores only the world-facing metadata it needs to render and coordinate agents.

### Agent Workspace vs Resident Profile

Agent framework files are provider-owned documents. For OpenClaw agents these are markdown files such as `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `TOOLS.md`, and `HEARTBEAT.md` under the resolved OpenClaw agent workspace. My Virtual World exposes these through the agent workspace editor, but the files remain source-of-truth documents for the agent framework.

The Virtual World Resident Profile is separate. It is stored under:

```text
world-meta.json
  agentProfiles
    <agent-id>
      residentProfile
```

Resident profiles are the world-facing roleplay/autonomy layer. They contain identity, life purpose, world home/work references, goals, needs, personality, short-term memory, long-term memory, relationships, reflections, and Live Mode behavior settings. New agents are seeded with the default resident template so Live Agent Mode has a purpose/memory layer without hardcoding individual agents.

## World Actions

World actions are durable interaction requests. They are stored under `world-meta.json` in the Agent Life section and exposed through `/api/world-actions`.

Lifecycle states include:

- `requested`
- `created`
- `reserved`
- `route_pending`
- `routing`
- `arrived`
- `in_progress`
- `completed`
- `cancelled`
- `failed`
- `expired`

Use the API instead of editing world-action JSON by hand.

## Update Behavior

Code updates do not wipe saved world data. A normal update changes the repo and rebuilds the container while keeping the Docker volume.

Only removing the data directory or Docker volume resets the world.
