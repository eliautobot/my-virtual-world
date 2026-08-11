# v1.0.59 — Reliable OpenClaw Connections

Released: August 11, 2026

This release replaces My Virtual World's temporary per-request OpenClaw
WebSockets with one reusable server-side Gateway connection. Multi-chat startup,
periodic refreshes, streaming responses, and tool events now share the same
authenticated transport instead of repeatedly connecting and authenticating.

## Connection reliability

- Keeps one authenticated OpenClaw Gateway connection for chat RPCs and events.
- Multiplexes concurrent requests with unique ids and routes each response to the
  correct caller, even when responses arrive out of order.
- Fans OpenClaw chat, agent, and session events out to all connected browser chat
  windows without opening a separate upstream socket for each window.
- Resolves and health-checks the Gateway endpoint when connecting or reconnecting,
  rather than before every RPC.
- Reconnects with bounded backoff after a Gateway restart, connection loss, or
  saved OpenClaw connection-setting change.

## Chat and state continuity

- Preserves existing OpenClaw session keys and authoritative Gateway history, so
  the same conversation can continue between My Virtual World, My Virtual Office,
  and other OpenClaw clients.
- Preserves multi-window chat, streamed text, commentary, tool activity cards,
  final-response reconciliation, and history loading.
- Keeps the existing independent read-only presence observer, so working,
  finishing, idle, and offline behavior is unchanged.
- Leaves Live Agent controller state and persistence separate from presence and
  chat transport state.

## Safety and security

- Keeps the OpenClaw Gateway token on the My Virtual World server in proxy mode.
- Preserves the same-origin HttpOnly authorization cookie and the existing
  browser RPC allowlist.
- Does not automatically replay requests after an uncertain disconnect, avoiding
  duplicate messages or actions.
- Closes pending requests cleanly and restores event delivery after reconnect.

## Verification

- Added transport tests for 64 parallel out-of-order RPCs over one socket, event
  fanout to multiple subscribers, and forced disconnect/reconnect behavior.
- Passed the full smoke, connection-help, SMS, Provider SDK, endpoint-resolution,
  chat-event architecture, and starter-world suites.
- Completed an 80-request live proxy stress test with 80 successful HTTP and RPC
  responses and no additional upstream Gateway connections.
- Verified four simultaneous connected chat windows, live streamed text, tool
  cards, and final responses in the browser.
- Verified one disposable OpenClaw conversation continued both directions between
  My Virtual World and My Virtual Office.

## Upgrade notes

No data migration or OpenClaw configuration change is required. Existing agent
sessions, chat history, presence state, Live Agent state, credentials, and world
data remain compatible. A normal application-container rebuild is sufficient;
do not remove the persistent `vw-data` volume. In normal operation My Virtual
World keeps two stable OpenClaw connections: one read-only presence observer and
one reusable chat/RPC/event connection.
