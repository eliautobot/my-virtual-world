# v1.0.43 — Interactive Shared Spaces & Table Games

Released: August 4, 2026

This release makes tables, benches, meetings, consumable breaks, and Ping-Pong behave as complete shared activities. Agents can reliably occupy individual indoor or outdoor seats, choose nearby places to consume items, participate in larger meetings without overlapping, and play a synchronized Ping-Pong match with live scoring and realistic paddles.

## Reliable indoor and outdoor table seating

- Completed behavior parity for Dining, Small Café, Outdoor Café, Picnic, and Small Round Meeting tables.
- Added exact per-seat selection, reservations, docking, center-facing orientation, transformed seat following, finite visits, and safe approach/dismount routes.
- Fixed manual agent placement on Outdoor Café and Picnic Tables in parks, including exact chair and bench-half raycasts.
- Added four independent Picnic Table bench positions—two per bench—with exclusive occupancy.
- Raised the Outdoor Café umbrella and center pole by 30% for agent head clearance and completed all four legs on each integrated chair.
- Added persistent color controls and complete placement metadata for newly placed tables.
- Corrected occupancy summaries so active and reserved seats are counted once and never offered to another agent.

## Improved Park Bench

- Widened the Park Bench and increased spacing among its three seats to prevent seated-agent overlap.
- Moved the dark upper supports from the front of the seat to the backrest side.
- Added five persistent color groups for the seat base, seat tops, backrest, top rail, and frame.
- Kept exact seat positions, facing, approach routes, and dismount routes correct after movement or rotation.
- Fixed editing and seating behavior for existing saved park benches as well as newly placed ones.

## Smarter consumable breaks

- Unified Coffee Machine, Water Cooler, Vending Machine, Fridge, Microwave, and Stove/Oven consumption under one shared destination workflow.
- Agents now choose randomly among their own desk and nearby available table or standalone seats, weighted by proximity.
- Added an efficient spatial index scoped by building or outdoor area and exact floor, avoiding full-world seat scans and incorrect cross-floor choices.
- Added immediate reservations, availability rechecks, movement/rotation following, and cleanup on completion or cancellation.
- Table and desk consumers place the item at a seat-specific serving position, then move it between the surface and mouth.
- Standalone-seat consumers keep the item in hand and animate it to the mouth without inventing a table surface.
- Fixed coffee, water, snacks, and cooked food so they land on the actual highest tabletop surface across every supported table and agent height.

## Cleaner tables and complete meetings

- Removed built-in static tabletop props from all tables except the large Meeting Table.
- Simplified the Dining Table to one substantial tabletop with no decorative frame or accent layers while preserving its chairs.
- Retained exactly four paperwork packets and one conference speaker on the large Meeting Table.
- Made all ten Meeting Table chairs individually selectable and exclusively reservable.
- Added six exclusive overflow standing positions—three at each chair-free end—for meetings larger than the seated capacity.
- Routed called meetings through authoritative realtime occupancy so agents fill chairs first, then standing positions, without sharing a location.
- Corrected seated and standing orientation after table or building movement and rotation.
- Added eleven persistent Meeting Table color controls covering the table, chairs, paperwork, and speaker.

## Live Ping-Pong gameplay

- Fixed a realtime epoch/version mismatch that could leave the browser displaying a frozen ball and score after the realtime service restarted.
- Ball position, rally state, and score indicators now remain synchronized with the authoritative match state.
- Added authoritative self-healing cleanup for paddles left behind after match completion, interruption, preemption, or missed transitions.
- Replaced box-shaped paddles with recognizable table-tennis paddles featuring thin oval rubber blades, wooden edges, dark reverse faces, and wooden handles.
- Preserved distinct red and blue paddles for the two player sides.

## Verification

- Expanded public smoke coverage for table geometry, colors, seat independence, tabletop policy, exact consumable placement, meetings, runtime epoch handling, paddle cleanup, and realistic paddle construction.
- Expanded realtime coverage for multi-seat contention, outdoor seating, floor-aware consume destinations, tabletop metadata, meeting overflow, orientation, and lifecycle cleanup.
- Passed JavaScript syntax checks, whitespace checks, the public smoke suite, the full realtime smoke suite, Docker rebuilds, Product service health checks, persistent-volume checks, and live 8590 browser verification.
- Live validation confirmed changing Ping-Pong ball coordinates and score, synchronized runtime versions, correct red/blue paddle assets, and no stale paddles on inactive agents.
