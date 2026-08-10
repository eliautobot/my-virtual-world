# v1.0.54 — Connection Guides & Reliable Settings

Released: August 10, 2026

This release makes native and Provider SDK connection setup easier to understand and fixes settings that appeared to save but were silently replaced by Docker or Compose environment defaults.

## Connection guidance in the product

- Adds an accessible information control beside every Native Connections setting for OpenClaw and Hermes.
- Adds the same information control beside every manifest-driven Provider SDK setting, including fields inside additional Hermes connection rows and third-party provider extensions.
- Explains what each field controls, its expected/default value, the expected provider connection, Linux + Docker setup, Windows + Docker Desktop setup, and the checks required before a provider is considered healthy.
- Documents the process boundary clearly: Windows executables cannot run inside the Linux application container, while host services are reached through `host.docker.internal`.
- Includes provider-specific defaults and requirements for OpenClaw, Hermes, Codex CLI, Claude Code, OpenCode, and Antigravity.

## Hermes setup clarity

- Documents the recommended Windows-hosted Hermes gateway URL: `http://host.docker.internal:8642`.
- Explains that the configured key must match Hermes `API_SERVER_KEY`.
- Requires a healthy `GET /health` response and `run_submission` plus `run_events_sse` from `GET /v1/capabilities`.
- Explains when local profile discovery and API auto-start are appropriate for a real Linux CLI and when they must be disabled for a Windows-hosted API.
- Clarifies that a Hermes CLI path inside Docker must be an executable Linux file, never a directory or a Windows launcher.

## Reliable Save and Apply

- Fixes saved UI values being overwritten immediately by deployment environment variables when the active config was reloaded.
- Persists field-level ownership for settings explicitly saved through the UI or API. Explicit saved values now win; untouched fields continue to inherit Docker or Compose bootstrap defaults.
- Preserves environment-backed Gateway, Hermes, and Twilio secrets when their password fields are left blank, without copying those secrets into the persisted config file.
- Makes the main Save Settings action await the server response, prevents duplicate submissions, reports saving/success/error state, refreshes the form from the applied response, and applies live UI changes only after persistence succeeds.
- Keeps Provider SDK saves synchronized with the parent Settings window and refreshes provider discovery after a successful save.

## Accessibility and mobile behavior

- Uses keyboard-focusable, labeled information controls and restores focus after a guide closes.
- Presents connection guidance as a readable modal with click-outside, Escape, close, and confirmation controls.
- Keeps the guide and Provider SDK settings within compact mobile viewports with touch-friendly controls and no horizontal page overflow.

## Regression coverage

- Adds guide-content coverage for all six built-in providers and generic Provider SDK extensions.
- Adds backend coverage proving that explicitly saved settings override Compose defaults while untouched settings still follow the deployment environment.
- Adds secret-preservation and internal override-metadata validation coverage.
- Extends the public smoke suite to require connection-help assets, Provider SDK synchronization, reliable save/apply behavior, and persisted settings precedence.

## Verification

- Passed the public smoke, packaging, Docker hygiene, secret scan, connection-guide, Provider SDK backend, and endpoint-resolution suites.
- Passed chat event, chat session, chat UI, chat bubble, OpenClaw event, starter furniture, runtime collision, floor/elevator, Live Mode separation, and realtime regression checks.
- Verified every built-in Provider SDK field and every additional Hermes connection field has an information control in the live application.
- Verified Native Settings and Provider SDK saves against conflicting Compose defaults, then restored the original live values.
- Verified desktop and 390 × 844 mobile behavior with zero page errors, zero error-level console logs, and zero horizontal overflow.

## Upgrade notes

No manual migration is required. Existing saved configuration remains valid. Deployment environment values continue to supply defaults until a user explicitly saves the corresponding field through Settings or the Provider SDK API. Secrets left blank remain unchanged and are not written back from the environment.
