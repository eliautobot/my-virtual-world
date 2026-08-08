# v1.0.46 — Provider SDK Connection Settings

Released: August 8, 2026

This patch places the Universal Provider SDK where users configure connection methods: **Settings → Connections**.

## Connection settings

- Added dedicated **Native Connections** and **Provider SDK** tabs inside the existing Connections settings page.
- Kept Native Connections as the default method for direct OpenClaw and Hermes configuration.
- Embedded the complete manifest-driven Provider SDK settings as an optional connection method, including provider tabs, health, authentication guidance, validation, redacted secret preservation, connection testing, discovery, models, runtime behavior, permissions, files, and skill rules.
- Removed the duplicate Provider SDK entry and standalone modal from **Edit Agents** so connection configuration has one clear home.
- Retained `/providers.html` as a supported direct deep link and retained the compatibility function used by existing internal callers.
- Hid the general Settings save footer while the Provider SDK tab is active because each provider has its own validated **Save settings** action.

## Responsive behavior

- Added a compact embedded Provider SDK layout inside Settings.
- Added touch-friendly connection-method tabs and a contained provider settings frame for desktop and mobile widths.
- Preserved the standalone responsive Provider SDK page for direct navigation.

## Verification

- Expanded the public smoke suite to require the **Settings → Connections → Provider SDK** hierarchy and reject the retired Edit Agents entry/modal.
- Verified JavaScript syntax, provider settings loading, all six provider tabs, responsive containment, and existing chat UI behavior.
- Passed the public smoke, chat UI, Provider SDK backend, realtime, dependency audit, and live desktop/mobile browser checks.
