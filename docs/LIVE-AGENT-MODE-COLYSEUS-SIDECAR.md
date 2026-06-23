# Live Agent Mode Colyseus Sidecar

Status: first implementation PR for the online-game foundation
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

This PR starts the sidecar. Later PRs will wire the browser to hydrate and observe from it.

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
- stale leases can be reclaimed after expiry

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

The smoke test starts a sidecar on a temporary port, joins the `agent_runtime` room with the current Colyseus SDK client, writes a snapshot, claims a route lease, verifies a lease conflict, sends a heartbeat, releases the route, restarts the sidecar, and verifies the saved position reloads from `agent-runtime.json`.

The public product smoke suite remains:

```bash
npm test
```

## Next PRs

This PR does not yet change visible browser movement.

Follow-up work:

- browser runtime client module
- hydrate agent positions from Colyseus before desk/home/random fallback
- observer interpolation from Colyseus state
- route executor lease claim before `setAgentTarget(...)`
- heartbeat publishing during existing route execution
- stale lease recovery on refresh or executor disconnect
