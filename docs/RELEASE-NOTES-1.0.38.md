# v1.0.38 — Reliable Chat Window Navigation

Released: July 28, 2026

This release makes long conversations easier to navigate while keeping chat-window resizing clear of message scrollbars and controls. The same behavior is shared by the primary and all additional chat windows.

## Controlled bottom-follow scrolling

- Kept chat windows automatically following the latest response while the user remains at the bottom.
- Paused bottom-follow when the user manually scrolls away from the latest message.
- Added a circular down-arrow control that appears while the transcript is paused and jumps back to the latest message when selected.
- Made the jump-to-latest restoration resistant to stale browser scroll events so automatic following reliably resumes.
- Preserved a manually selected scroll position across periodic history refreshes.
- Continued following streaming responses only when bottom-follow remains active.

## Middle-button scrolling

- Added standard middle-click autoscrolling inside chat transcripts.
- Added middle-button hold-and-drag scrolling for direct transcript navigation.
- Added a visible scroll origin and direction indicator while middle autoscroll is active.
- Allowed Escape, another mouse button, or a second middle click to stop hands-free autoscrolling.

## External resize zones

- Moved edge resize detection outside the chat panel so it no longer overlaps the message scrollbar or corner controls.
- Tightened corner resize zones around the panel curves.
- Kept resize handles unobtrusive until the panel is hovered or actively resized.
- Corrected the input-row clipping and inherited bottom radii to remove rectangular gray bleed behind curved bottom corners.

## Multi-window parity

- Applied the bottom-follow control, history preservation, middle-button scrolling, and revised resize zones to the primary chat window and every additional chat window.
- Kept each window's follow state and scroll interaction independent.

## Verification

- Extended chat UI regression coverage for bottom-follow interruption, guarded jump-to-latest restoration, history refresh preservation, middle-click and middle-drag behavior, external resize zones, curved corners, and additional-window inheritance.
- Updated the public smoke suite for the new chat assets and cache keys.
- Passed JavaScript syntax checks, the complete public smoke suite, chat UI regressions, Docker Compose validation, dependency audit, and whitespace checks.
- Verified both primary and additional chat windows live on port 8590, including deliberately injected stale scroll events and periodic real history refreshes.
- Verified the live deployment with 28 agents, 3 buildings, persistent world data, and the realtime service preserved.
