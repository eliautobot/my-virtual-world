# Server Runtime Snapshot Interpolation Buffer

PR #59 fixes visible server-owned agent stutter by changing browser observers from latest-snapshot chasing to buffered playback.

## Runtime Shape

- The realtime sidecar remains authoritative for agent positions, headings, activities, leases, and object use.
- Browser clients stay observers for server-owned agents; they do not run local route logic for those agents.
- Colyseus schema patches carry movement updates at the active runtime tick.
- Full `runtime:state` documents are recovery/rejoin snapshots, not the frame-by-frame movement stream.

## Browser Playback

For each observed agent, the browser keeps a short ring buffer of authoritative samples:

- `AGENT_RUNTIME_OBSERVER_BUFFER_DELAY_MS = 220`
- delay clamps between `140ms` and `320ms`
- max buffer age `2000ms`
- max samples `32`

The render loop draws at `now - delay`, finds the two buffered samples around that render time, and linearly interpolates position plus shortest-path heading. If packets arrive late, the browser may extrapolate briefly for up to one small window, then holds the latest sample rather than repeatedly snapping.

## Snap Rules

The observer buffer resets only for hard corrections:

- first sample for an agent
- floor changes
- teleport/manual-placement-sized correction over `AGENT_RUNTIME_OBSERVER_SNAP_DISTANCE`
- leaving observer mode for local/manual control

Normal server ticks never reset an in-flight visual segment.

## Debug Hooks

`window.__VWGetAgentRuntimeDebug()` now exposes `runtimeObserverBuffer` with:

- `length`
- `delayMs`
- `mode`
- `renderVersion`
- `latestVersion`

This gives QA a direct way to see whether the browser is rendering from the buffer rather than chasing the latest server snapshot.
