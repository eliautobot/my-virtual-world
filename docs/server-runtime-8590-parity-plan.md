# Server Runtime 8590-Parity Fix Plan (for PR #58)

Companion to `server-runtime-8590-parity-audit.md`. Ordered, implementable checklist. All work in `src/realtime/agent-runtime-room.mjs` (and small helpers) on branch `fix/server-runtime-definitive-8590-parity`. 8590 references are file+line in `/tmp/8590-main3d.js`.

## Event-loop safety constraints (apply to every item)

- **No unbounded per-tick sync I/O.** Building documents are cached (commit d6f5555) — keep it that way; any new file/DB reads must be cached or amortized.
- **Bound per-tick work** like the existing budgets (`MAX_ACTIVE_ROUTES 8`, `MAX_ROUTE_STEPS_PER_TICK 12`, `MAX_STARTS_PER_TICK 3`, `MAX_IDLE_CHECKS_PER_TICK 6`, lines 68–71). New passes (esp. proximity scanning) get their own per-tick caps.
- Proximity checks must not be naive O(n²) every tick: use a coarse spatial bucket (tile-hash) or round-robin a bounded subset of agents per tick (e.g. ≤6 proximity evaluations/tick, matching `MAX_IDLE_CHECKS_PER_TICK` style).

---

## M1 — Blockers: stuck agents & missing core lifecycles

### M1.1 Route/activity watchdog (fixes `permi`-class hangs) — risk: low
- **Build:** per-activity deadline. When a scripted-object target enters `routing`, record `routeStartedAt`; if not arrived within a stale window (8590 uses **45s**: `AGENT_INTENT_APPROACH_STALE_AFTER_MS`, main3d.js:7387), abort the activity: release reservation/queue slot/lease, clear target, set short cooldown, return agent to idle wander.
- **Where:** scripted-object runtime tick in `agent-runtime-room.mjs` — alongside `expireStaleRouteLeases()` (:5293) which currently only sweeps leases, not activities. Add the check in the per-agent route-advance path (`makeServerRuntimeStep` callers, ~:1699+).
- **Acceptance:** inject an unreachable target in a test; agent abandons within 50s and picks a new activity. Live: re-run `/tmp/vw-audit/sample-8587.py` for 10 min; no agent shows a single `routing` state for >60 consecutive seconds.

### M1.2 Fix queue-slot target coordinate frame — risk: medium
- **Build:** diagnose why `permi`'s armchair queue target was `(1492,-1036)` while the agent/world position is `(≈500,-28)` — looks like interior/grid-scaled coords leaked into a world-space target (factor ≈3 + offset). Normalize queue/interaction spot targets to the same frame the movement integrator uses.
- **Where:** `service-queue-wait` target builders, agent-runtime-room.mjs :3173–:3300 (queue slot construction, `interactionSpotId`/`queueTargetId` coords); compare against desk/meeting target derivation (:2107, :2131) which demonstrably works.
- **8590 ref:** furniture spot resolution + `faceAngle` computation (main3d.js:1457–:1491, :1937).
- **Acceptance:** unit test asserting queue-slot target coords lie within the building's world-space bounding box; `permi` (and all agents) reach armchair queue slots and sit within one dwell cycle.

### M1.3 Align live-status walk speed + run triggers — risk: low
- **Build:** set `LIVE_STATUS_RUNTIME_SPEED_UNITS_PER_SEC` from 96 → 70–72 (line 49). Mirror 8590 run conditions: run when entering building, returning to desk, work-presence not at desk, or distance > 8 tiles (main3d.js:20255–:20262, baseSpeed 200 run / 70 walk).
- **Acceptance:** side-by-side 8590 vs 8587: walking gait speed visually indistinguishable; working agents still run to desks.

### M1.4 Deskless working-agent fallback — risk: low
- **Build:** verify + fix behavior when a work-presence agent has no available desk: must fall back to wander/wait near work building, never freeze. 8590 gate: main3d.js:4895.
- **Where:** live-status desk assignment `agent-runtime-room.mjs:2107+`.
- **Acceptance:** test with more working agents than desks; surplus agents keep moving (idle-style) and grab a desk when freed.

## M1.5 — Movement smoothness parity (Eli-reported: choppy paths, corner slowdowns) — risk: medium

Eli observed 8587 agents do not follow interior/exterior routes as smoothly as 8590: motion is choppy and agents visibly slow down at turns. Root causes to fix (all three):

### M1.5a Continuous waypoint advance (no per-tick corner stalls)
- **Build:** in the server route stepper (`makeServerRuntimeStep` / `selectCachedServerRuntimeRouteStep` and the segment-step integrators ~:1478–:1699), carry unused per-tick movement distance through waypoints: when the step reaches a waypoint with residual distance, immediately continue along the next segment within the same tick (loop until residual exhausted or final arrival). Do NOT treat intermediate waypoints as arrivals; only the final target uses arrivalRadius dwell logic. This is how 8590's frame-based mover flows through corners.
- **Acceptance:** an agent walking an L-shaped route shows constant speed magnitude across the corner in consecutive snapshots (no tick where displacement drops >20% at a waypoint, except final arrival).

### M1.5b Heading blend through turns
- **Build:** heading should turn smoothly through corners rather than snapping/aiming at each waypoint. Blend heading toward the direction of actual displacement across the tick (or slerp with a max turn rate similar to 8590's visual turn smoothing) so observers render natural turns.
- **Acceptance:** heading deltas between consecutive snapshots along a corner are gradual (< ~60°/tick during normal walking).

### M1.5c Observer-side interpolation tuning (browser render smoothness)
- **Build:** verify `beginAgentRuntimeObserverInterpolation` in `src/client/js/main3d.js` interpolates over the full tick interval (250ms) with velocity-consistent easing, handles late/early snapshots without pauses (extrapolate briefly up to ~1 tick when the next snapshot is late), and does not reset mid-interpolation on identical-position updates. Compare rendered motion against 8590's frame-based movement side by side.
- **Acceptance:** side-by-side viewing of the same walking agent on 8590 vs 8587 shows comparable visual smoothness at 60fps; no rhythmic 4Hz stutter; no pause-per-waypoint.
- **Note:** crowd-avoidance impulses (`applyServerRuntimeAgentAvoidance`) should be damped/smoothed so per-tick corrections don't zigzag the path — cap lateral correction per tick and decay it near waypoints.

## M2 — Behavior vocabulary port

### M2.1 Fill missing object-type configs — risk: low
- **Build:** diff `SERVER_SCRIPTED_OBJECT_ACTIVITY_CONFIG` (:2398–:2497) against 8590 `RECOGNIZED_IDLE_ACTIVITY_PREFIXES` + `LOCAL_IDLE_FURNITURE_ACTIVITY_CONFIG` (main3d.js:2840–2900). Known missing keys: `fountain`, `gazeboPavilion`, `foodTruckCounter`; verify `busStop`, `outdoorStage` variants, `pantryShelf`, `sink/stove` coverage against actual world catalogs.
- **Acceptance:** every placeable catalog objectType that 8590 idles on has a server config row; 10-min sample shows ≥1 use of newly added types when present in world.

### M2.2 Worker + customer service roles (counters, barber) — risk: medium/high
- **Build:** paired-role lifecycle: a staff-capable agent reserves the `service`/`staff-work` spot, customers queue and use `customer` spot; barber chair gets customer(seated) + stylist(standing service). Introduce a `serviceState` on the object (worker, customer, spot ids) with lease-safe assignment.
- **8590 ref:** `counter.serviceState` (main3d.js:50652), reception routing lifecycle `staffSpotId/visitorSpotId/queueSpotId` (:40780), worker role assignment (:28212, :19622), barber kinds `barber-chair-standing-style-service` (Phase 3B tests :8587–:9075 show expected shapes).
- **Where:** extend scripted-object activation path (:3589–:3665) with a second role slot; reuse queue machinery for customers.
- **Acceptance:** at a cafe counter: one agent stands behind (serve anim), another orders (`order-food-drink`), queue forms behind. Barber chair shows seated customer + standing stylist simultaneously.

### M2.3 Bed sleep cycle + elevator/interior-door completeness — risk: low
- **Build:** bed rest→sleep→wake phases (8590 kinds `bed-sleep`, `home-rest-`); confirm interior-door pass-through works on multi-room buildings; port `_elevatorTrip` only if any current building has floors >1 reachable by agents (else document as N/A).
- **Acceptance:** agent at home building uses bed with `bed-rest` anim through a full dwell; no agent clips through interior walls between rooms.

## M3 — Social / proximity system (biggest visible gap)

### M3.1 Port `SCRIPTED_PROXIMITY_BEHAVIOR_RULES` + `_socialState` conversations — risk: medium
- **Build:** server-side proximity pass: for idle, non-committed agents (mirror eligibility gate `isCommittedObjectApproachActivity`, main3d.js:2973+), scan nearby agents (radius 5 tiles); with 22% chance / 45s cooldown start a conversation: both agents stop, face each other, `_socialState { convId, participants, role: talking|listening, timer 7–14s, switchTimer 3–5s }`, animation `gather-talk`, role swap on switchTimer, join-existing-conversation for a 3rd/4th agent.
- **8590 ref:** rules object main3d.js:2938–2967; conversation create :17090–:17091; participants/speaker helpers :17114–:17131; eligibility + cooldown :17173–:17186; group join :17201–:17226; post-conversation cooldown 20–40s :17258.
- **Where:** new bounded pass in the scripted-object runtime tick; persist `socialState` into agent runtime doc so clients render `gather-talk` + facing.
- **Event-loop:** bucket agents by coarse tile each tick (O(n)); evaluate ≤6 candidate agents/tick round-robin.
- **Acceptance:** 10-min sample shows `gather-talk` occurrences comparable to 8590 (order of 10–15% of samples); conversations have 2–4 participants, faces aligned, and always end (timer) with cooldown.

### M3.2 Social approach (sofa/cafe seats) + group gathering — risk: medium
- **Build:** socialApproach: idle agent approaches an occupied social seat (sofa/cafe spot ids `talk-front`, `seat-*`, `use-south`; max 3 approachers/object, 28%/60s cd, 9–17s) → seat/stand social variant anims (`armchair-seated-rest-talk`, `outdoor-cafe-table-sit-eat-drink-talk`). groupGathering: 12%/180s cd, 3–4 participants gather at a point, 18–32s.
- **8590 ref:** rules main3d.js:2954–2967; approach handler :4730+; gathering :4751+.
- **Acceptance:** observed multi-agent seating clusters (2+ agents on one sofa/table) at least once per 10-min sample with 25 agents.

### M3.3 Ping-pong partner recruitment — risk: low (system exists solo)
- **Build:** `pingpong-play` currently solo; add recruitment (34% chance, 90s cd, wait state `scripted-waiting-for-pingpong-partner`, 2 players, 16–28s match).
- **8590 ref:** rules :2939–2946; recruitment submit :4605, :4630, :9872–:9908.
- **Acceptance:** ping-pong table with 2 idle agents nearby ends up with both playing (one on each side) within a few minutes.

## M4 — Polish: timing naturalness & QA

### M4.1 Timing naturalness — risk: low
- Randomize per-activity cooldowns instead of flat `COOLDOWN_MS 12000` / `DWELL_MS 7000` (:64–:65); adopt 8590's per-config `stayMs` ranges everywhere (already partially done) and jittered idle re-pick (2–5s wander timer, main3d.js:17319).
- **Acceptance:** state-transition histogram from the sampler shows non-uniform inter-activity gaps.

### M4.2 Wait-pose fidelity in queues — risk: low
- Ensure queued agents actually plant + play `bus-stop-wait` (audit showed 310 `service-queue-wait` samples vs 12 wait-anim observations) once M1.2 lands. Verify pose activation at queue slot arrival (:3239–:3300).
- **Acceptance:** browser obs shows wait anim for queued agents ≥80% of their queue time.

### M4.3 QA passes (no code)
- Two-browser consistency check (same positions/anims both clients), reconnect mid-route, 25-agent tick-time telemetry before/after M3 (assert p95 tick < 50% of 250ms budget), and a fresh 8590-vs-8587 side-by-side video/sample diff as the parity sign-off.

## Suggested PR #58 commit order
1. M1.1 watchdog → 2. M1.2 queue coords → 3. M1.3 speeds → 4. M1.4 deskless → 5. M1.5 movement smoothness → 6. M2.1 configs → 7. M3.1 conversations → 8. M3.2/3.3 social approach + pingpong → 9. M2.2 service roles → 10. M2.3 bed/doors → 11. M4 polish + QA evidence.
(M2.2 deliberately after M3.1 — service roles reuse the paired-agent coordination built for conversations.)
