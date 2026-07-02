# Server Runtime Snapshot Interpolation Buffer

PR #59 fixes visible server-owned agent stutter by changing browser observers from latest-snapshot chasing to buffered playback.

## Runtime Shape

- The realtime sidecar remains authoritative for agent positions, headings, activities, leases, and object use.
- Browser clients stay observers for server-owned agents; they do not run local route logic for those agents.
- Colyseus schema patches carry movement updates at the active runtime tick.
- Every authoritative agent snapshot carries the server simulation timeline (`tickSeq`, `simTimeMs`, and per-step `tickMs`) so browser interpolation is driven by server simulation time rather than packet arrival time.
- The realtime runtime advertises a `100ms` cadence but advances movement by the actual elapsed server step when the Node event loop is late, capped at `250ms` to avoid teleporting after a stall.
- Full `runtime:state` documents are recovery/rejoin snapshots, not the frame-by-frame movement stream.

## Browser Playback

For each observed agent, the browser keeps a short ring buffer of authoritative samples:

- `AGENT_RUNTIME_OBSERVER_BUFFER_DELAY_MS = 360`
- delay is fixed so the playback cursor does not speed up or slow down while chasing packet arrival jitter
- max buffer age `2000ms`
- max samples `32`

The render loop draws at `now - delay`, using `snapshot.simTimeMs` to order and sanity-check the sample timeline, finds the two buffered samples around that render time, and linearly interpolates position plus shortest-path heading. `snapshot.updatedAt` remains a fallback for older/recovery snapshots. Stale recovery snapshots cannot seed a future playback clock; fresh samples reset large clock-offset jumps, timelines are clamped near receipt time, and samples remain monotonic per agent. If packets arrive late, the browser holds the latest known sample instead of extrapolating forward and then snapping back.

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
- `renderTickSeq`
- `latestTickSeq`

This gives QA a direct way to see whether the browser is rendering from the buffer rather than chasing the latest server snapshot.
