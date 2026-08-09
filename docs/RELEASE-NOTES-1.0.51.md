# v1.0.51 — Starter World Compatibility & Interaction Polish

Released: August 9, 2026

This release refreshes the bundled starter Office so its furniture follows the same current runtime contract as newly placed furniture. It also fixes stale seated poses after agents leave desks and makes the Settings window resizable and maximizable.

## Starter furniture compatibility

- Upgrades every bundled Office furniture record to the current placement schema instead of shipping legacy minimal records.
- Uses one shared initializer for starter and newly placed furniture, keeping lifecycle, persistence, catalog, asset-class, color, and interaction metadata in sync.
- Makes starter and newly placed armchairs use identical seat, approach, seated-height, and dismount settings.
- Safely repairs the two original starter armchairs in existing worlds when their current metadata is missing.
- Preserves custom colors and routing, and does not recreate or alter starter armchairs that were moved, replaced, or deleted.
- Prevents single armchairs from incorrectly reusing their approach point when an agent stands up. Multi-seat sofas, benches, and tables retain their shared approach behavior.

## Agent pose reliability

- Requires authoritative desk occupancy before applying the seated desk pose.
- Prevents a remembered desk location from leaving agents seated in mid-air after dismounting or walking away.
- Keeps agents standing during non-desk object interactions and departure phases while preserving valid seated desk-consumable animations.
- Adds a tighter physical desk-dock check so the seated animation cannot override the agent's real location.

## Resizable Settings window

- Adds a visible bottom-right resize handle on desktop.
- Adds maximize and restore controls beside Close, plus double-click-header maximize and restore.
- Remembers custom Settings window dimensions and position.
- Constrains restored and resized bounds to the current viewport.
- Preserves responsive mobile behavior and hides the resize handle while maximized.

## Regression coverage

- Compares starter and newly placed armchair metadata and interaction behavior.
- Covers safe existing-world starter-armchair migration and customization preservation.
- Covers armchair dismount collision behavior.
- Covers desk pose behavior while docked, dismounted, departing, using another object, consuming at a desk, and outside the desk radius.
- Covers Settings resize, maximize, restore, persistence, responsive constraints, and required UI controls.

## Verification

- Passed the public smoke suite, including syntax, packaging, Docker hygiene, and secret checks.
- Passed starter-furniture parity, existing-world migration, and server collision/dismount regressions.
- Passed realtime smoke plus 69 chat-event, 41 chat-session, and 26 Provider SDK backend checks.
- Passed chat UI, OpenClaw event, bubble-layout, Compose, whitespace, package dry-run, and production dependency checks.
- Built and started a clean v1.0.51 Docker image, confirmed the packaged version, and loaded the application successfully.
- Production dependency audit reports zero vulnerabilities.

## Upgrade notes

No manual migration or configuration change is required. Fresh installations receive the current starter furniture schema. Existing installations repair only untouched original starter armchairs with missing compatibility metadata; customized, moved, replaced, or deleted furniture remains unchanged.
