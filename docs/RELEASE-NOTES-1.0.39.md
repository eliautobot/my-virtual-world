# v1.0.39 — Interactive Furniture & Stable Chat Follow

Released: July 29, 2026

This release gives furniture and activity objects dependable, visible interactions across manual placement, autonomous behavior, and the authoritative realtime runtime. It also includes the latest chat-window scrolling correction so conversations follow new messages without overriding deliberate user scrolling.

## Furniture and activity interactions

- Remediated 26 furniture and activity objects with formal action points, matching context actions, registered animations, and production-renderer verification.
- Corrected seated, lying, resting, exercising, performing, and equipment-use poses so agents dock on the intended surface and face the authored direction.
- Added true whole-character lying poses for beds, clinic beds, and the gym bench.
- Moved treadmill, training mat, outdoor exercise station, gym bench, slide, and swing activation onto their actual usable surfaces instead of nearby approach points.
- Corrected stage performer and audience orientation, barber/exam/office seating direction, table seating, and other furniture-facing paths.
- Added complete interaction coverage for legacy counter, dining table, sink, stove, and TV actions.

## Multi-seat furniture

- Upgraded Couch / Lounge Seat, Sectional Sofa, Loveseat, Hallway Bench, and Park Bench with independent per-seat reservations and occupancy.
- Added exact per-seat approach, activation, and safe dismount points for manual drag-and-drop and automatic routing.
- Protected manually placed occupants through the authoritative runtime handoff and prevented stale runtime frames from cancelling seated animations.
- Added clone-on-write handling for immutable reservation snapshots and cleanup for stale seat claims, preventing second-agent Render Errors.
- Added persisted live color preview and editing for visible furniture materials.
- Rebuilt the Couch, Sectional Sofa, and Loveseat as cleaner cohesive assets with tightly spaced independent cushions and simplified couch-style palettes.
- Corrected cushion-top seating heights and front-edge positioning so hips rest on the cushion while legs clear the furniture.
- Removed misleading numbered debug markers from sectional approach, stand, and social points while preserving genuine service-queue numbering.

## FIFO service queues

- Unified 20 queue-enabled object types behind one complete first-in, first-out lifecycle.
- Added manual front insertion, queue member shifting, per-slot retargeting, activation promotion, completion/release, next-person promotion, and empty-queue cleanup.
- Kept approach, spectator, clearance, exit, and shared-use points out of FIFO capacity calculations.

## Realtime and manual-placement reliability

- Added page-host-relative realtime URL resolution for localhost, LAN/Tailnet, reverse-proxy, and HTTPS deployments.
- Preserved exact object slot, animation, facing, and seat-surface metadata through client/server runtime handoff.
- Added protected manual occupancy holds with clean release when an agent is picked up again.
- Prevented frozen runtime registries and stale object claims from producing Render Errors during repeated manual placement.

## Stable chat follow-scrolling

- Detects deliberate transcript movement from the mouse wheel, touch gestures, scrollbar dragging, and middle-button scrolling.
- Pauses bottom-follow only for genuine manual scroll intent, so layout and history refresh events no longer falsely disable automatic following.
- Automatically resumes following when the user manually reaches the latest message.
- Makes the jump-to-latest control target the true transcript bottom immediately, without the previous timer and stale-scroll race.
- Keeps streaming responses and periodic history updates pinned to the newest message while follow mode remains active.
- Applies the same behavior independently to the primary and all additional chat windows.

## Verification

- Expanded browser verifiers for multi-seat geometry, independent drop targets, color rendering, seating height, immutable-state safety, stale-claim cleanup, runtime handoff, and sectional debug-marker cleanup.
- Expanded realtime smoke coverage for FIFO behavior, object lifecycle metadata, host-affinity URL resolution, manual placement, and release/promotion behavior.
- Expanded chat UI regressions for manual scroll intent, reaching the bottom, jump-to-latest restoration, history refreshes, middle-button scrolling, and multi-window parity.
- Passed the public smoke suite, realtime smoke suite, chat UI regressions, JavaScript syntax checks, Docker builds and configuration validation, dependency audit, whitespace checks, and live 8590 browser verification.
