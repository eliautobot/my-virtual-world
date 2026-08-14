# v1.0.63 — Responsive Chat & Mobile Input

Released: August 14, 2026

This release keeps long conversations, chat-window resizing, and mobile typing
responsive while preserving the continuously animated 3D world. It also makes
OpenClaw session resets start with a genuinely clean conversation.

## Faster chat windows

- Displays the latest 120 merged history items while retaining all older
  messages in the saved session, substantially reducing active chat DOM size
  for long conversations.
- Removes the expensive live-WebGL backdrop blur from chat panels and
  temporarily suppresses bubble shadows during an active resize.
- Coalesces rapid pointer resize events into one visual update per animation
  frame and skips resize work when no chat window is being resized.
- Rejects stale asynchronous history and commentary responses after the user
  changes agents or sessions, preventing old content from appearing in the
  newly selected conversation.

## Reliable session reset

- Treats an explicitly requested OpenClaw session key as authoritative instead
  of falling back to the newest previous transcript when the new session has no
  messages yet.
- Keeps a newly reset conversation empty apart from its confirmation message,
  and prevents late events from the previous run from repopulating it.

## Responsive mobile typing

- Debounces deletion-driven textarea measurements until a held backspace has
  paused, eliminating queued layout work that could continue deleting text
  after the key was released.
- Removes textarea height animation and cancels pending resize work when a
  message is sent.
- Reserves a short main-thread input window between expensive 3D frames only
  while the mobile composer is actively receiving input, so the world remains
  animated without starving keyboard events.
- Keeps the WebGL canvas resolution constant during typing, preventing the
  drawing-buffer reallocations that caused the world to flicker.

## Verification

- The complete application test suite and whitespace checks pass.
- A throttled mobile regression processed 240 held-backspace events with zero
  deletion after release while the world continued rendering.
- Repeated typing/backspace transitions produced zero canvas mutations or
  replacements and kept the canvas dimensions stable.
- The live 8590 application, realtime service, persistent data, browser console,
  and source/container parity were verified before release.

## Upgrade notes

No data migration is required. Rebuild both application services normally and
preserve the existing `vw-data` volume. Saved worlds, agents, conversations,
and provider settings remain compatible.
