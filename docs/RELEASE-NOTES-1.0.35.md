# v1.0.35 — Configurable World Chat Bubbles

Released: July 27, 2026

This release makes the conversation bubbles above agents configurable, world-aware, and easier to use. Bubbles now remain clear of open side panels, support screen-consistent or fixed-world sizing, and scale their complete visual design—including text, session badges, and scrollbars—without clipping or changing layout unexpectedly.

## Configurable display behavior

- Added **Chat Bubbles** controls to **Settings > General**.
- Added **Consistent size**, which keeps bubbles and text at the selected screen size regardless of camera zoom.
- Added **Fixed size**, which anchors a rigid bubble to the world so moving the camera closer or farther scales the complete object naturally.
- Added Large, Medium, and Small choices for both display behaviors.
- Added hover and keyboard-focus explanations for every display and size option.
- Persisted the selected behavior and size in `world.chatBubbles`, with server-side validation and safe defaults for existing worlds.

## Fixed-world scaling

- Kept the entire Fixed-size bubble as one rigid layout: dimensions, text, wrapping, timestamps, header controls, session badge, padding, and scrollbar geometry remain internally stable.
- Applied camera distance as one uniform outer transform so zoom changes apparent distance without recalculating text layout.
- Removed the previous close-zoom ceiling so Fixed-size bubbles continue scaling across the complete supported camera range.
- Set Fixed Large to 47.6% of the original bubble, Medium 30% smaller than Large, and Small 30% smaller than Medium.
- Scaled minimized overhead icons using the same selected behavior and size.

## Visual polish and text safety

- Reduced Fixed-size bubble outline thickness and corner curvature.
- Scaled session-badge padding, inset outline, and corner radius with each Fixed size.
- Scaled scrollbar width and thumb radius with each Fixed size and removed native arrow controls that could not scale consistently.
- Prevented long agent names, session identifiers, activity text, and tool output from shifting or clipping the bubble horizontally.
- Kept timestamps on one line and right-aligned within the message area.
- Reset horizontal scroll after message updates.

## Side-panel awareness

- Replaced the stale hard-coded Edit World width with each panel's actual rendered bounds.
- Kept minimized icons and expanded bubbles outside the open Edit World panel.
- Preserved the same measured clearance beside the Info panel.
- Continued respecting responsive panel widths, transitions, and collapsed states.

## Verification

- Added `chat-bubble-layout.mjs` as the shared normalization, scaling, panel-boundary, and Fixed-chrome helper.
- Added behavioral regressions for open and collapsed panels, responsive renderer offsets, display settings, all size ratios, rigid world scaling, scaling beyond 3×, session-badge chrome, and scrollbar chrome.
- Extended the public smoke suite to cover UI controls, persistence wiring, server normalization, asset packaging, and the new styling contracts.
- Passed the public smoke suite, chat-bubble regression suite, syntax checks, Docker configuration validation, and whitespace checks.
- Verified the live 8590 deployment with 28 agents, 3 buildings, existing persistent world data, and the existing realtime service preserved.
