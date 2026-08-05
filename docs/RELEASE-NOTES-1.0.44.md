# v1.0.44 — Live Chat & Ping-Pong Reliability

Released: August 4, 2026

This patch release keeps live agent conversations current and responsive across desktop and mobile, while eliminating the remaining Ping-Pong paddle color flicker during player approach.

## Current live chat bubbles

- Fixed overhead chat bubbles that could remain stuck on older field-report history instead of streaming the agent's active OpenClaw session.
- Added normalized session timestamps and explicit active-session metadata so messages are ordered and selected consistently.
- Added current `toolCall` activity to the live bubble stream.
- Reduced the chat and bubble refresh interval to two seconds for faster updates.

## Predictable chat scrolling

- Fixed the sticky bottom state that could require several upward scroll gestures before releasing.
- A single upward wheel, touch, scrollbar, or middle-scroll gesture now immediately pauses automatic bottom-follow.
- Cancelled pending animation frames and timers when the user scrolls away so delayed callbacks cannot snap the chat back down.
- Bottom-follow resumes only after reaching the true bottom or selecting **Jump to latest**.

## Mobile keyboard support

- Added Visual Viewport tracking for mobile software keyboards.
- The chat panel now fits inside the visible portion of the screen while the keyboard is open.
- The composer and input field remain above the keyboard in both overlay-keyboard and viewport-resize browsers.

## Stable Ping-Pong player colors

- Preserved the assigned Ping-Pong side and canonical paddle color in the route target, activity, top-level visual state, and carried racket metadata.
- Fixed target normalization so hexadecimal color values are treated as metadata rather than rejected as world coordinates.
- Made the authoritative `pingpong-left` or `pingpong-right` activity determine the rendered paddle color before transient flattened metadata or carried-item aliases.
- The left player remains red and the right player remains blue for the complete walk to the table and during play, even across buffered observer frames.

## Verification

- Expanded chat session tests for active OpenClaw messages, sortable timestamps, tool-call activity, one-gesture bottom release, and mobile keyboard layout.
- Expanded Ping-Pong tests for route metadata, canonical side colors, transient metadata gaps, and stale opposite-color carry aliases.
- Live Product 8590 validation sampled 118 visible frames from a blue/right player's approach; every rendered paddle frame remained blue through arrival at the table.
- Passed the public smoke suite, full realtime smoke suite, syntax and whitespace checks, production dependency audit, Product service health checks, and live browser verification with no page errors.
