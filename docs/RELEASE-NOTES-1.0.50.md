# v1.0.50 — Reliable Chat Recovery & Settings Polish

Released: August 9, 2026

This release fixes stale OpenClaw progress messages appearing beneath newer answers, improves long-chat recovery, and polishes the Settings and Provider SDK experience on desktop and mobile.

## Reliable OpenClaw chat recovery

- Separates recovered Codex commentary by the actual OpenClaw run that produced it, even when multiple runs reuse one long-lived Codex thread.
- Prevents old progress messages from replaying under a newer response after refresh or reconnect.
- Preserves the original timestamp of recovered progress instead of displaying it as newly received.
- Rejects commentary that falls outside verified run boundaries.
- Applies one combined activity limit so recovery cannot return more items than requested.
- Raises the bounded OpenClaw RPC receive capacity to 8 MiB, allowing long histories such as 500-message sessions to load without a proxy 502 error. The limit remains configurable and capped at 64 MiB.

## Settings window polish

- Anchors Save Settings and Cancel to a dedicated footer flush with the bottom border of the Settings window.
- Keeps the settings body independently scrollable while the action buttons remain visible.
- Prevents Provider SDK cards, Agent Desk files, skills, paths, and provider metadata from overflowing the Settings window.
- Improves Provider SDK layouts at narrow desktop and mobile widths across every built-in provider.
- Changes the embedded Native Runtime Models page action to `← Back to Provider SDK`, returning to the same provider without closing Settings.

## Regression coverage

- Adds a multi-run recovery scenario where two OpenClaw runs share one Codex thread.
- Covers out-of-window commentary rejection, verified run boundaries, one combined activity limit, and original timestamp propagation.
- Covers large chat-history proxy responses within the configured receive bound.
- Covers Settings footer placement, responsive Provider SDK grids, and nested Models return navigation.

## Verification

- Passed 69 chat event and ordering checks.
- Passed 41 chat-session and recovery checks.
- Passed 26 Provider SDK backend checks.
- Passed public smoke, packaging, Docker hygiene, secret scan, chat UI, OpenClaw event, bubble layout, realtime, syntax, Compose, whitespace, and production dependency checks.
- Production dependency audit reports zero vulnerabilities.
- Desktop 1600×900 and mobile 390×844 browser acceptance passed for chat ordering, long-history refresh, follow behavior, Settings footer placement, Provider SDK containment, nested navigation, and horizontal overflow.

No data migration or configuration change is required.
