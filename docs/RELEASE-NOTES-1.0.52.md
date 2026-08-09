# v1.0.52 — Provider Endpoint Resolution

Released: August 9, 2026

This release adds a provider-neutral connection resolver for agent frameworks that expose network services. My Virtual World can now locate a supported service inside its Linux container, on the Docker host, or at a custom URL without requiring separate Windows and Linux builds.

## Shared endpoint resolution

- Adds four connection modes for network-capable providers: Auto-detect, Docker host, Container local, and Custom URL only.
- Uses provider manifest data to declare transports, supported protocols, settings, and default endpoints instead of branching on provider names or host operating systems.
- Preserves configured schemes, ports, and paths when switching between Docker-host and container-local locations.
- Probes and authenticates one candidate at a time, then selects and displays a single active endpoint.
- Rechecks a cached endpoint before submitting work and never sends the same run to multiple endpoints.
- Falls through only when an endpoint is unreachable. Authentication, authorization, protocol, and explicit rejection failures stop immediately and remain visible.

## OpenClaw and Hermes

- OpenClaw Gateway supports Auto, Docker host, Container local, and Custom modes through its authenticated WebSocket protocol.
- Hermes API supports the same modes through authenticated health and capability checks.
- Hermes run submission, streaming events, approvals, cancellation, and interruption remain pinned to the endpoint selected before the run.
- Hermes can operate as an API-only provider when its Linux CLI profiles are unavailable or intentionally disabled.
- Windows Docker setup defaults Hermes to the host API topology and disables invalid Linux-local profile discovery and auto-start behavior.
- Existing remote and custom URLs are preserved during settings migration rather than being rewritten as local endpoints.

## Provider SDK transport contract

- Adds additive Contract 1.1 `connectionSchema` declarations for all six built-in frameworks.
- OpenClaw declares a Gateway network transport; Hermes declares API and CLI transports.
- Codex, Claude Code, OpenCode, and Antigravity declare their actual server-runtime process transports.
- Provider SDK screens show each framework's runtime boundary and only offer endpoint modes when the framework has a genuine HTTP or WebSocket transport.
- Existing third-party adapters without `connectionSchema` remain compatible.
- The interface explains that `host.docker.internal` routes network traffic to the Docker host but cannot execute a Windows CLI without a real provider bridge.

## Setup and configuration

- Adds endpoint-mode controls to native Connections settings, Provider SDK settings, and initial setup.
- Adds environment and Compose options for OpenClaw Gateway mode, Hermes API mode, Hermes local-profile discovery, and endpoint-cache lifetime.
- Updates the Windows configuration helper for host-routed Hermes APIs.
- Documents endpoint topology, Docker-host routing, security behavior, transport limits, and upgrade configuration.
- Keeps endpoint credentials server-side and redacts secrets from diagnostics.

## Reliability fixes

- Prevents an unsaved Hermes connection test from falsely reporting healthy through unrelated globally discovered agents.
- Preserves non-default ports and paths in explicit Docker-host and container-local modes.
- Rejects Custom mode without a URL.
- Prevents ambiguous Hermes API submissions from falling back to the CLI and potentially running work twice.

## Verification

- Passed 35 Provider SDK backend tests and 14 endpoint unit/integration tests.
- Exercised real authenticated HTTP, SSE, and WebSocket test services.
- Verified Auto, Docker host, Container local, Custom, wrong-key, and wrong-token boundaries inside an isolated Docker image using `host.docker.internal`.
- Passed public smoke, chat-event architecture, chat UI, starter furniture, provider runtime integration, syntax, Compose, packaging, Docker hygiene, and secret checks.
- Verified all six Provider SDK tabs at desktop and mobile widths with no overflow, console errors, page errors, or HTTP 5xx responses.

## Upgrade notes

No manual migration is required. Existing explicit remote/custom URLs remain exclusive. Local OpenClaw and Hermes URLs adopt Auto-detect unless an endpoint mode was already selected.

For Hermes installed on a Windows Docker host, run its API gateway on Windows, configure the matching API key, and use Auto-detect or Docker host mode. The resolver supplies the route through `host.docker.internal`; it does not install, start, authenticate, or expose the host service itself.
