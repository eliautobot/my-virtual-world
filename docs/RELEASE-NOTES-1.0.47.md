# v1.0.47 — Unified Chat Timeline & Tool Display Controls

Released: August 8, 2026

This patch gives every supported provider one consistent chat timeline and adds a user preference for opening tool-call details expanded or collapsed.

## Unified chat timeline

- Added a provider-neutral event reducer for OpenClaw, Hermes, Codex, Claude Code, and Provider SDK streams.
- Kept public commentary, thinking, task/TODO updates, tool calls, tool results, and final replies in their true chronological order.
- Reused one in-place card as each tool moves from running to completed, failed, or cancelled, preventing duplicate and permanently-running tool cards.
- Handled fast results, repeated terminal snapshots, stale starts, cumulative and delta text streams, late final amendments, and equal-timestamp history without reordering or duplication.
- Preserved provider message boundaries when loading history and restored the same order after refresh.
- Recovered only public Codex commentary omitted from standard OpenClaw history; encrypted reasoning and final-answer records remain excluded.

## In-world chat synchronization

- Applied the same commentary, thinking, tool, approval, and final ordering to the compact yellow in-world chat bubbles.
- Fixed yellow-bubble refresh recovery so public commentary remains synchronized with the full chat window.
- Kept fast tool results above the final reply and suppressed duplicate reasoning that matches visible final text.

## Tool-call display preference

- Added **Settings → General → Chat Window → Tool Call Details**.
- Added **Expanded by default** and **Collapsed by default** options.
- Saved the preference in the product configuration and applied it to every chat window.
- Updated already-rendered tool cards immediately when the preference changes.
- Kept expanded as the backward-compatible default when no preference has been saved.

## Responsive chat behavior

- Prevented desktop secondary chat windows from being squeezed into unusable strips on mobile widths.
- Kept one usable primary chat window on mobile while preserving the existing four-window desktop layout.
- Preserved follow detach, Jump to latest, reattach, refresh, resize, and keyboard behavior.

## Verification

- Passed 59 provider-neutral ordering and replay checks.
- Passed 36 chat-session and commentary-recovery checks.
- Passed the OpenClaw event, public smoke, chat UI, Provider SDK backend, realtime, syntax, packaging, Docker hygiene, secret scan, and production dependency audit suites.
- Verified live desktop at 1600×900 and mobile at 390×844 with real persisted tool cards, refresh parity, clean overflow checks, and zero product console or page errors.

## Upgrade notes

- No manual migration is required.
- Existing installations continue to open tool-call details expanded until a user chooses a different preference.
