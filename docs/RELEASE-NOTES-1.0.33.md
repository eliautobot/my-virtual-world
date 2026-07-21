# v1.0.33 — Fluid Rendering and Lean Realtime

Released: July 21, 2026

This release improves world fluidity on both software and hardware renderers, reduces browser main-thread work, and makes the Colyseus realtime path incremental from server state through client updates.

## Rendering and browser performance

- Added vertex-color batching and shared immutable materials for compatible scene geometry, cutting the audited world from roughly 2,170 draw calls to about 1,190 without changing its palette.
- Added distance-based agent detail levels so small facial and accessory geometry is skipped when it cannot contribute visible detail.
- Replaced the per-frame ping-pong scene traversal with a maintained set of visual roots and avoided redundant material updates.
- Paused chat and status polling while the page is hidden, and stopped hidden or minimized chat bubbles from continuously rebuilding typewriter markup.
- Preserved agent mouth visibility when expressions rebuild face geometry.
- Added conditional chat responses with ETags and a bounded server-side chat cache to reduce repeated payload and session-scan work.

## Realtime and persistence efficiency

- Updated existing Colyseus Schema objects in place so movement-only changes emit compact scalar patches instead of retransmitting bulky target and visual-state JSON.
- Added incremental client-side Schema listeners for agents, runtime objects, traffic lights, vehicles, and world metadata.
- Removed steady-state full runtime-document broadcasts; Schema patches are now the authoritative transport, with a small compatibility welcome for rolling updates.
- Moved runtime checkpoints to a background worker, coalesced superseded checkpoints, and added atomic checkpoint replacement.
- Added a durable lifecycle journal so important ownership, state, and object transitions survive a restart between periodic checkpoints.
- Compacted expired runtime entities and transient events during load, and made the checkpoint interval configurable with `VW_REALTIME_CHECKPOINT_INTERVAL_MS`.

## Measured results

- Audited draw calls fell by approximately 45 percent, from roughly 2,170 to 1,189–1,203.
- A representative movement-only Schema patch fell from 8,556 bytes to 37 bytes.
- In the unchanged software-rendered test environment, measured output improved from about 11.2 FPS with a 100 ms median frame gap to about 13 FPS with an 83 ms median frame gap.

## Verification

- Public smoke suite passed, including product files, syntax, packaging, Docker hygiene, and secret scanning.
- Full realtime smoke suite passed, including compact-patch and lifecycle-journal recovery coverage.
- Server runtime collision guards passed.
- Route corner smoothness and route watchdog tests passed.
- Social conversation tests passed.
- Live 8590/8592 browser rendering, health, and logs were verified before release.
