# v1.0.37 — Flexible, Compact Chat Bubbles

Released: July 28, 2026

This release gives users direct control over when expanded agent chat bubbles switch into the grouped layout, while making every Fixed-size option more compact and keeping its corner shape proportional to the selected size.

## Configurable bubble grouping

- Added **Group Chat Bubbles** controls under **Settings > General > Chat Bubbles**.
- Added Activated and Disabled choices so users can turn grouped bubble layout on or off.
- Added **Minimum chat bubbles to start grouping**, accepting any whole number of `2` or more.
- Kept the existing behavior as the safe default: grouping is activated and starts at five expanded bubbles.
- Applied grouping changes immediately and persisted them in `world.chatBubbles`.
- Added client and server normalization so missing or invalid saved values fall back safely.

## Smaller Fixed-size bubbles

- Reduced Fixed Large, Medium, and Small by 25%.
- Kept the complete Fixed bubble rigid while scaling its dimensions, text, padding, badges, controls, and minimized icon together.
- Preserved camera-distance scaling and the existing size relationship between Large, Medium, and Small.
- Kept Consistent-size bubbles unchanged.
- Retained a readable `1.25px` minimum scrollbar width across the smaller Fixed sizes.

## Size-relative corners

- Kept Fixed Large at a `6px` outer corner radius.
- Scaled Fixed Medium to `4.2px`.
- Scaled Fixed Small to `2.94px`.
- Kept Consistent-size corner radii unchanged.

## Verification

- Extended chat-bubble layout regressions for grouping defaults, custom thresholds, disabled grouping, all reduced Fixed scales, and proportional outer radii.
- Extended the public smoke suite for the new Settings controls, persistence wiring, server normalization, asset versions, and styling contract.
- Passed the complete public smoke suite, chat UI verification, JavaScript and Python syntax checks, Docker Compose validation, dependency audit, and whitespace checks.
- Verified the live 8590 deployment with 28 agents, 3 buildings, saved settings, persistent world data, and the realtime service preserved.
