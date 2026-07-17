# Live Agent Mode: Authoritative Spatial Perception

Status: implemented
Schema: `agent-live-mode-spatial-perception/v1`

Live Agent planning now receives a compact spatial frame built from the
realtime sidecar's authoritative `agent-runtime.json` body coordinates and the
persisted building/object model. The server does not infer proximity from an
assignment, an action's destination, or a browser-only mesh.

## Perception model

Each snapshot includes:

- exact self, peer, object, and active-route coordinates;
- distance in API units and tiles (`1 tile = 40 API units`);
- building, floor, room, indoor/outdoor, and occupancy context;
- route id, route state, authority/lease owner, target distance, and nearby
  agent blockers;
- nearby and visible agents;
- nearby, visible, occupied, and currently interactable objects;
- interaction/action spots, their authoritative coordinates, and reservation
  availability;
- explicit reasons when a target is not visible.

The read endpoint is:

```text
GET /api/agent/<agent-id>/spatial-perception
```

The same snapshot is embedded as `spatial` in
`GET /api/agent-live-loop/perception?agentId=<agent-id>`. A bounded
`spatialContext` is also included in each temporary evidence frame inside the persistent Live session and model
prompt.

Collections are returned in stable nearest-first order, including valid
zero-distance/co-located records. `resultSets` reports the total, returned,
and truncation state for each collection so consumers never mistake a bounded
response for complete occupancy. The read API can return up to 64 nearby
agents and 128 nearby objects; the planner receives a smaller compact view to
control model context size.

## Field of view decision

The perception system uses a hybrid policy:

- 20-tile omnidirectional awareness radius;
- 12-tile visual radius;
- 8-tile interaction radius;
- 120-degree forward visual cone;
- 1.5-tile omnidirectional close-awareness bubble.

A hard visual cone alone is unsafe and brittle: a resident would fail to
notice a person immediately behind them, and brief heading changes while
routing could make nearby targets flicker in and out of existence. The hybrid
keeps an efficient forward-attention signal while preserving close-range
awareness for collision safety and natural interaction. Close rear targets are
reported as `perceived=true` but not falsely labeled `visible` or
`inFieldOfView`.

Visibility additionally requires the same floor and a compatible place. Two
known but different room ids, different buildings, and indoor/outdoor
boundaries occlude each other. Interior wall segments from the same persisted
geometry used by routing block line of sight. If room ids are absent, wall
geometry remains the visibility authority.

## Authority and failure behavior

The realtime sidecar document is the only body-position authority. Runtime
records not present in the current provider roster are ignored. If the current
resident has no authoritative position, perception fails closed with empty
nearby collections and `authority.available=false`; it does not substitute a
home/work assignment or action destination.

Persisted building transforms, including 90/180/270-degree rotations, convert
interior and outdoor object-local coordinates into the same API coordinate
system used by runtime bodies. Runtime object-use state and durable world
action reservations both contribute to interaction readiness.

## Verification

Run:

```bash
npm run verify:spatial
```

The verifier covers field-of-view boundaries, close awareness, floors, rooms,
indoor/outdoor separation, wall occlusion, authoritative distances, rotated
object transforms, object occupancy, interaction spots, route blockers,
planner prompt integration, stable co-located ordering, API result-set
metadata, missing-authority behavior, outdoor nodes, and 100,000 randomized
geometry relations with visibility invariants.
