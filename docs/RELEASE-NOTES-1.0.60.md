# v1.0.60 — Durable Provider Sessions & Approvals

Released: August 12, 2026

This release makes chat sessions, Hermes approvals, and agent lifecycle state
durable and consistent across OpenClaw, Hermes, Codex, Claude Code, OpenCode,
Antigravity, and Universal Provider SDK extensions. Multiple chat windows can
now use the same agent without redirecting, truncating, or consuming each
other's conversations and approval requests.

## Durable provider sessions

- Gives each browser chat window its own explicit provider session key.
- Starts new conversations without resetting or deleting the previous session;
  explicit **Delete** is now the only destructive session-panel action.
- Adds atomic per-provider/profile/session transcript mirrors in the persistent
  data volume.
- Merges native provider exports into the richer local transcript rather than
  replacing progress, reasoning, tool, approval, or earlier message rows.
- Keeps late run responses in their originating session without switching a
  window back from a newer conversation.
- Synchronizes session creation, switching, reopening, and deletion across
  OpenClaw, Hermes, Codex, Claude Code, OpenCode, and extension providers.

## Hermes conversation and approval reliability

- Serializes Hermes history updates with locked, atomic transactions so
  concurrent progress writers cannot truncate earlier messages.
- Isolates pending approvals by Hermes agent, profile, and native session.
- Delivers approval responses upstream before consuming the pending request, so
  transient failures remain retryable instead of making the prompt disappear.
- Persists pending, approved, denied, and expired approval cards in the exact
  originating session and restores them after reload.
- Tracks approval bridge status transitions and cleans up unresolved requests
  only when their owning run terminates.
- Pins polling and approval responses to the selected session so one Hermes
  window cannot consume another window's request.

## Unified provider lifecycle and presence

- Adds one provider-neutral lifecycle coordinator for run, stream, tool,
  approval, finishing, idle, and stale-activity state.
- Keeps task presence, provider connectivity, and Live Agent controller state as
  independent state planes.
- Preserves working state for quiet long-running tools and overlapping runs, and
  prevents one completed run from idling an agent that is still active elsewhere.
- Treats failed turns as completed lifecycle events with an error record rather
  than incorrectly marking the provider offline.
- Uses server-owned Hermes and Codex monitors so browser SSE attachment does not
  determine whether an agent appears working or finished.
- Displays the finishing state distinctly while retaining existing working,
  idle, and offline behavior.

## Consistent chat rendering

- Routes live and historical messages from every provider through the same safe
  local Markdown renderer.
- Preserves formatted headings, lists, tables, links, inline code, and fenced
  code during streaming and after finalization.
- Retains approval-only history rows during client-side history merging and
  includes an asset-version update so browsers load the corrected reducer.

## Verification

- Added 54 cross-provider session checks covering create, switch, reopen,
  delete, rich-history preservation, lazy sessions, and late-completion races.
- Expanded the Provider SDK backend suite to 55 tests, including a 24-writer
  Hermes concurrency regression and approval isolation/retry/persistence checks.
- Added 11 provider-neutral lifecycle tests, 17 endpoint-resolution tests, and
  approval reload coverage in the chat UI suite.
- Passed the complete smoke, chat UI, chat-session, connection-help, SMS,
  Provider SDK, endpoint-resolution, presence, and OpenClaw Gateway test suites.
- Verified live on port 8590 that a Hermes approval survives polling from a
  second agent window, resumes the original run, returns its final response, and
  remains visible as approved after a fresh browser load.

## Upgrade notes

No data migration or provider configuration change is required. Rebuild the
application container normally and preserve the existing `vw-data` volume. The
new normalized chat-session mirrors are created automatically under the
persistent status directory. Existing world data, credentials, provider
profiles, native sessions, and Live Agent state remain compatible.
