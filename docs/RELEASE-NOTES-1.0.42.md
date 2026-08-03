# v1.0.42 — Complete Interactive Stove & Oven

Released: August 3, 2026

This release turns the Stove into two complete cooking stations: a Stove Top and an Oven. Agents can choose from ten distinct recipes, share one reliable first-come-first-served queue, follow visible staged cooking sequences, carry finished meals to a desk, consume them, and clean up afterward.

## Two complete cooking stations

- Added separate Stove Top and Oven actions with their own interaction positions, cooking methods, durations, and animations.
- Added five stovetop recipes: Veggie Stir-Fry, Pancake Stack, Tomato Pasta, Grilled Cheese, and Breakfast Skillet.
- Added five oven recipes: Baked Lasagna, Roast Chicken, Chocolate Chip Cookies, Vegetable Pizza, and Baked Salmon.
- Preserved the selected recipe and cooking method through queue admission, promotion, cooking, carry, desk consumption, and realtime hydration.

## Visible cooking and meal lifecycle

- Added staged raw, cooking, and cooked food visuals for both cooking methods.
- Stovetop cooking animates a round pan with an agent-facing handle, active burner, food tossing, and steam.
- Oven cooking animates door opening, loading, closing, heating light, staged food, reopening, and retrieval.
- Every finished recipe has a distinct multi-part carry asset held in the agent's right hand.
- Agents route to a valid desk, visibly consume the finished meal, receive its need effects, and remove the temporary item cleanly afterward.

## Shared first-come-first-served queue

- Added one authoritative three-position queue shared by the Stove Top and Oven.
- Automatic agents, action-button requests, and manually dragged agents all use the same queue contract.
- Added exact placement, contention handling, queue-full feedback, promotion, line shifting, completion release, and final empty-queue cleanup.
- Queued agents retain their requested recipe, method, and duration when they reach the appliance.
- Strengthened manual service-object ownership handoff so realtime updates cannot pull an admitted agent away from the active interaction position.

## Verification

- Added catalog checks for exactly five stovetop foods, five oven foods, ten unique IDs and labels, and ten distinct rendered meal assets.
- Added runtime coverage for shared-queue contention, promotion order, method and recipe preservation, desk consumption, temporary-item cleanup, and final queue release.
- Added browser verification for both interaction positions, all staged animations, pan geometry and motion, idle-effect visibility, realtime connectivity, and clean console/render state.
- Passed the public smoke suite, full realtime smoke suite, JavaScript syntax checks, whitespace checks, Docker rebuilds, Product service health checks, and live 8590 browser verification.
