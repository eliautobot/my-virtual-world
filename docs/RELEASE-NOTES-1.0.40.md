# v1.0.40 — Interactive Fitness & Furniture Reliability

Released: July 30, 2026

This release adds complete, visible workout experiences for the Dumbbell Rack and Gym Bench, upgrades the Sink into a polished interactive service object, and improves furniture colors, seating orientation, queue behavior, and safe dismounts throughout the world.

## Interactive Sink

- Rebuilt the Sink as a configurable asset with editable cabinet, countertop, basin, and faucet/hardware colors.
- Added a dedicated hand-washing pose that places both hands over the basin with natural arm and body movement.
- Added animated faucet droplets and basin bubbles that appear only while an authoritative Sink interaction is active and reset cleanly afterward.
- Added the full first-come-first-served service lifecycle for automatic and manual placement, including exact queue positions, strict arrival order, promotion, completion, and final cleanup.
- Prevented stale or inactive runtime frames from leaving agents frozen in the wash pose or leaving visual water effects active.

## Dumbbell Rack workouts

- Redesigned the rack with four correctly oriented, size-graded pairs of dumbbells and removed the decorative top bar.
- Added persistent color controls for the frame, rails, weights, handles, and feet.
- Added paired hand weights and three distinct workouts: Arm Curls, Shoulder Press, and Shoulder Flys.
- Added the complete three-position FIFO queue used by Coffee Machines, Water Coolers, Vending Machines, and Microwaves.
- Manual placements now land on the exact available use or queue point, retain workout selection through promotion, and cannot bypass existing occupants.
- Queue waiters remain in a neutral waiting pose without weights; only the active use-front agent performs the workout and holds dumbbells.
- Completed users dismiss immediately from use-front before the next queued agent is promoted.

## Gym Bench workouts

- Added persistent color controls for the bench frame, metal, pads, pad top, accents, and feet.
- Added a matched dumbbell to each hand during exercise mode, with clean removal during rest, queueing, and completion.
- Widened the press grip and limited the faceward range so the weights stay outside shoulder width and clear the agent’s head.
- Added a bounded 8–13 second exercise duration and immediate side dismissal after completion.
- Added a saved-world-compatible three-position FIFO queue with exact 50-pixel spacing, strict manual-placement ordering, queue reflow, and exercise/rest preservation through promotion.

## Chairs, seating, and safe dismounts

- Added persistent color controls to the Armchair and Conference Chair.
- Raised Conference Chair occupants onto the cushion surface, closed the armrest gaps, and centered all gray foot supports beneath their legs.
- Corrected placed-object rotation handling for Loveseats, Armchairs, Sectional Sofas, Conference Chairs, Hallway/Waiting Benches, Couches, and Lounge Seats so occupants always face with the rotated furniture.
- Added four dedicated rotation-aware Sectional Sofa dismount points outside its collision footprint, one for each seat including the chaise.
- Existing saved Sectional Sofas receive the safe release geometry automatically without replacement.
- Prevented approach, staging, stand, exit, clearance, and dismount locations from being misclassified as seats.

## Realtime and queue reliability

- Made paired workout props authoritative for active Dumbbell Rack and Gym Bench exercise states, even when older clients omit the field or publish stale false metadata.
- Reserved pending manual Gym Bench queue requests locally until realtime acknowledgement, preventing rapid placements from selecting the same slot.
- Hardened server-owned queue state against stale client mirrors and preserved exact queue/use metadata through hydration and promotion.
- Added saved-world compatibility for legacy Gym Benches, Dumbbell Racks, and Sectional Sofas that predate the new authored interaction metadata.

## Verification

- Added dedicated Dumbbell Rack and Gym Bench asset/runtime verification commands.
- Expanded realtime smoke coverage for exact FIFO order, manual placement, queue shifting, promotion, workout props, completion, immediate dismissal, and legacy saved-object compatibility.
- Added 24 rotated-seating regression cases covering six furniture types at 0°, 90°, 180°, and 270°.
- Added permanent checks for all four Sectional Sofa seats and their matching outside dismount points.
- Passed the public smoke suite, focused asset tests, full realtime smoke suite, JavaScript syntax checks, Docker builds and configuration validation, dependency audit, whitespace checks, live 8590 browser verification, and Product service health checks.
