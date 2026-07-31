# v1.0.41 — Complete Interactive Fridge

Released: July 31, 2026

This release turns the Fridge into a complete, configurable service object. Agents now line up in a reliable first-come-first-served queue, select one of ten distinct foods, carry it back to a desk, consume it, and clean up afterward. The appliance itself also gains six persistent color controls with live preview.

## Ten unique fridge foods

- Added Greek Yogurt Cup, Red Apple, Fresh Orange, Green Grape Bunch, Garden Salad Bowl, Sushi Box, Cheese Wedges, Berry Parfait, Carrot Snack Pack, and Turkey Avocado Wrap.
- Built a distinct multi-part 3D asset for every food instead of reusing one generic chilled snack.
- Preserved each selected food's identity, appearance, and hunger effects through pickup, hand carry, queue promotion, desk placement, and consumption.
- Temporary foods remain omitted from saved-world persistence and are removed cleanly after consumption.

## Complete desk-consumption lifecycle

- Agents open the fridge, retrieve a selected food, close the door, and carry the item in their right hand.
- Fridge users route to a valid desk and enter a dedicated `fridge-desk-consume` activity.
- The food is visibly available throughout the carry and consumption flow, then removed when the activity finishes.
- Server-authoritative runtime state preserves the temporary item across browser hydration and realtime handoffs.

## First-come-first-served fridge queue

- Added one exclusive `use-front` position and three numbered queue positions with strict arrival ordering.
- Automatic agents, action-button requests, and manually dragged agents all use the same queue contract.
- Added exact queue placement, contention handling, promotion, line shifting, completion release, and final empty-queue cleanup.
- Queued agents keep their originally selected food when promoted to the fridge.
- Corrected the fridge door-swing clearance location so it remains non-reservable and can never be mistaken for a queue position.

## Persistent fridge colors

- Added independent colors for the shell, sides, trim, door seals, handles, and dispenser.
- Added live preview with Apply, Cancel, and Reset controls through the shared furniture color editor.
- Stored selections persist in the fridge's `fridgeColors` data and restore when the world reloads.
- Updated the immutable browser bundle key so existing installations load the new renderer and editor immediately.

## Verification

- Added static checks for exactly ten unique food IDs, labels, visual kinds, and rendered geometry signatures.
- Added queue-routing regression coverage proving agents use the authored queue instead of the door clearance point.
- Added a three-agent realtime stress test covering manual placement, two occupied queue positions, promotion, line shifting, selected-food preservation, desk consumption, temporary cleanup, and final queue release.
- Added live browser checks for all six rendered color parts, custom/default color application, persistent model data, and all six editor inputs.
- Passed the public smoke suite, full realtime smoke suite, JavaScript syntax checks, whitespace checks, Docker rebuilds, Product service health checks, and live 8590 browser verification with realtime connected.
