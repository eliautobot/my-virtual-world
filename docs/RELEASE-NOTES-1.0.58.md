# v1.0.58 — Hermes Conversation Continuity

Released: August 10, 2026

This release fixes multi-turn conversation context for API-connected Hermes agents. My Virtual World v1.0.57 preserved the Hermes session id, but Hermes' `/v1/runs` endpoint does not automatically hydrate prior messages from that id. As a result, consecutive messages could reach the same stored session while each model turn behaved like a new conversation.

## Conversation continuity

- Sends the explicitly selected native Hermes session id from the chat window on every run.
- Loads canonical prior messages from Hermes' authenticated Sessions API before continuing an existing session.
- Supplies that bounded history through Hermes' supported `conversation_history` run field.
- Applies the same behavior to both native Hermes chat and the universal Provider SDK transport.
- Preserves messages written to the same Hermes session by other clients instead of relying on a browser-local transcript.

## Safety and compatibility

- Replays only meaningful user and assistant text, excluding tool-protocol rows that could create invalid call sequences.
- Bounds hydrated history by message count, per-message size, and total character size to avoid unbounded prompts.
- Keeps the most recent conversational context when limits are reached and marks clipped message content.
- Stops before run submission with `session_history_unavailable` when an existing selected session cannot be loaded, rather than silently sending a contextless turn.
- Keeps first-message behavior and compatibility with Hermes endpoints that do not advertise session-history support.

## Container topology

Hermes remains an independent, optional Compose sidecar. It contains the full Hermes runtime and CLI, uses a private Docker-network API connection, and is not installed inside the My Virtual World application container. Rebuilding or replacing My Virtual World therefore does not replace the Hermes container or its persistent data directory.

## Verification

- Added regression coverage for selected-session propagation, history hydration, structured content normalization, tool-row exclusion, bounded history, and fail-closed submission behavior.
- Verified the authenticated Hermes client sends `conversation_history` through the real HTTP transport.
- Passed the complete smoke, connection-help, SMS, Provider SDK, endpoint-resolution, chat UI, and chat event architecture suites.
- Completed two consecutive live Hermes turns in one disposable session and verified that the second response recalled information supplied only in the first turn.
- Rebuilt and verified the production service on port `8590` while preserving its persistent world data.

## Upgrade notes

No data migration is required. Existing Hermes sessions and persistent data remain compatible. Deploy with the normal non-destructive update command; do not remove the `vw-data` volume. Attachment transfer behavior and browser CDP configuration are unchanged in this release.
