# Live Agent Mode Colyseus Sidecar

Status: stacked implementation path for the online-game foundation
Scope: phases 1-3 of the Live Agent Mode restart plan

This document defines how My Virtual World uses Colyseus without replacing the existing Python server.

## Purpose

The Colyseus sidecar is the authoritative realtime runtime for live agent location, route leases, and heartbeat snapshots.

It exists because Live Agent Mode needs online-game behavior before AI behavior:

- refresh must not reset agent location
- a second browser must see the same agent positions
- only one client may execute a live route for an agent
- observers must render from shared runtime state instead of simulating their own copy
- runtime state must survive a sidecar restart

Three.js remains the renderer. Colyseus does not replace the visual world, pathfinding, or object interaction code.

## Ownership Split

| Owner | Responsibility |
| --- | --- |
| Python server | Static files, world/building/chunk APIs, saved world data, licensing, provider integrations. |
| Browser client | Three.js rendering, current interior/exterior route execution, object action animation. |
| Colyseus sidecar | Realtime agent runtime snapshots, route leases, heartbeat state, multi-client broadcast, runtime persistence. |

The parent PR starts the sidecar. The first child PR wires the browser to hydrate and observe agent locations from it.

## Runtime Room

Room name:

```text
agent_runtime
```

Runtime file:

```text
VW_DATA_DIR/agent-runtime.json
```

The room stores a map of agent snapshots:

```json
{
  "schemaVersion": "agent-runtime/v1",
  "agentId": "adam",
  "mode": "live",
  "owner": "agent-live-mode",
  "x": 3.5,
  "y": 4.25,
  "floor": 1,
  "buildingId": "",
  "roomId": "",
  "heading": 0,
  "state": "routing",
  "target": {
    "kind": "world-point",
    "x": 8,
    "y": 9,
    "floor": 1
  },
  "routeId": "route-adam-1",
  "worldActionId": "",
  "leaseOwner": "main3d-session",
  "leaseExpiresAt": "2026-06-23T18:00:00.000Z",
  "updatedAt": "2026-06-23T17:59:55.000Z",
  "version": 4
}
```

## Colyseus Messages

Client to server:

```text
runtime:snapshot
runtime:claimRoute
runtime:heartbeat
runtime:releaseRoute
```

Server to client:

```text
runtime:welcome
runtime:ack
runtime:error
runtime:event
```

Lease rules:

- a route executor must claim a route before sending movement heartbeats
- a second lease owner is rejected while the current lease is active
- heartbeats extend the lease TTL
- releasing a route clears the lease and persists the final runtime snapshot
- stale leases are automatically expired after their TTL
- plain snapshots cannot overwrite an active route lease owned by another browser

## Local Development

Run only the sidecar:

```bash
VW_DATA_DIR=.local-data VW_REALTIME_PORT=8591 npm run realtime
```

Run the Python app and realtime sidecar together:

```bash
VW_DATA_DIR=.local-data VW_REALTIME_ENABLED=true VW_REALTIME_URL=ws://127.0.0.1:8591 npm run dev:realtime
```

Configuration variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VW_REALTIME_ENABLED` | `false` | Exposes the realtime config to the browser config payload. |
| `VW_REALTIME_URL` | empty in app config | Browser-facing Colyseus WebSocket URL. |
| `VW_REALTIME_ROOM` | `agent_runtime` | Colyseus room name. |
| `VW_REALTIME_PORT` | `8591` | Sidecar HTTP/WebSocket port. |

## Verification

Realtime smoke test:

```bash
npm run verify:realtime
```

The smoke test starts a sidecar on a temporary port, joins the `agent_runtime` room with the current Colyseus SDK client, writes a snapshot, claims a route lease, verifies lease conflicts, blocks a plain snapshot from overwriting an active lease, sends a heartbeat, releases the route, expires a stale lease, restarts the sidecar, and verifies the saved position reloads from `agent-runtime.json`.

The public product smoke suite remains:

```bash
npm test
```

## Browser Hydration Child PR

The browser loads the Colyseus browser SDK from:

```text
/node_modules/@colyseus/sdk/dist/colyseus.js
```

The Three.js client then connects through:

```text
src/client/js/agent-runtime-client.mjs
```

Hydration flow:

1. the browser fetches `/vw-config`
2. if realtime is enabled, it joins the `agent_runtime` room
3. `loadAgents()` builds the normal roster with desk/home fallback positions
4. matching Colyseus snapshots override those positions before `createAgent3D(...)`
5. runtime updates continue to reposition matching agents
6. live-owned or leased runtime snapshots are marked observer-only in this browser until route ownership is implemented

Matching is done by stable identity keys:

```text
agentId, id, statusKey, name
```

This keeps the current product behavior safe when the sidecar is disabled or when no runtime snapshot exists for an agent.

## Route Lease Child PR

The second child PR starts Phase 3 by letting the active browser become a route executor for a live-mode route.

Route flow:

1. `setAgentTarget(...)` admits a live-mode route through the existing intent/router system
2. the browser sends `runtime:claimRoute` to Colyseus before the route moves
3. the agent waits while the route lease is pending
4. after claim ack, the browser becomes the executor and existing movement/routing runs normally
5. while movement is active, the browser sends `runtime:heartbeat` snapshots
6. when `_wanderTarget` clears at arrival, the browser sends a final heartbeat and `runtime:releaseRoute`
7. observer browsers render the heartbeat snapshots and do not simulate the same route

The route executor does not calculate a new path. It uses the current Virtual World pathing:

```text
setAgentTarget(...)
dynamic-interior-routing.js
dynamic-exterior-routing.js
physics.js
```

The browser exposes a verification helper:

```text
window.__VWStartRuntimeLeasedRoute(agentId, { x, y, floor })
```

That helper is for local/browser testing only. It gives Phase 3 a deterministic way to prove route claim, heartbeat, movement, and release before the AI planner exists.

## Visible Persistence And Recovery Child PR

The third child PR makes Phase 3 visible through normal movement paths, not only the deterministic debug helper.

Runtime persistence flow:

1. admitted `setAgentTarget(...)` routes claim a Colyseus route lease by default
2. while the route is pending, the local agent waits instead of moving ahead of server ownership
3. after claim ack, the existing browser route executor moves the agent
4. route heartbeats update Colyseus while the agent moves
5. route release persists the final location and clears route metadata
6. manual drag/drop placement writes a forced `runtime:snapshot`
7. ordinary idle/settled positions are published through a throttled snapshot path

Recovery flow:

1. every route heartbeat extends `leaseExpiresAt`
2. the sidecar sweeps expired leases every second
3. expired leases clear `routeId`, `worldActionId`, `target`, `leaseOwner`, and `leaseExpiresAt`
4. the sidecar records a `route-lease-expired` event
5. another browser can claim a new route after the stale lease is cleared

This still does not add AI behavior. It makes the online-game foundation testable: move/place an agent, refresh, and the runtime snapshot should now be the source of the next load position.

## Next PRs

The sidecar parent PR starts the runtime server. The hydration child PR changes initial/observed placement. The route-heartbeat child PR proves route claim/heartbeat/release. The visible persistence child PR wires ordinary route movement and stale-lease recovery into that runtime.

Follow-up work:

- richer observer interpolation from Colyseus state
- promotion from normal movement persistence to Live Mode toggle ownership
- promotion from debug/manual route trigger to real planner/model route requests
