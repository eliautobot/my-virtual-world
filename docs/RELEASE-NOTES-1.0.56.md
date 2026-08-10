# v1.0.56 — Hermes API Discovery & Remote Sessions

Released: August 10, 2026

This release makes the authenticated Hermes API a complete cross-operating-system connection path for the Hermes features that the current API can safely expose. A Windows-hosted Hermes gateway can now provide discovery, sessions, model aliases, skill metadata, runs, approvals, and cancellation to My Virtual World running in Docker without mounting Windows profile paths into Linux.

## Capability-negotiated discovery

- Reads `/v1/capabilities` before enabling any remote Hermes feature.
- Discovers API-only Hermes profiles/connections even when no Linux Hermes CLI or profile mount exists.
- Preserves stable identities across multiple named Hermes connections.
- Supports Hermes multiplex profile URLs such as `/p/coder` without dropping the profile prefix.
- Uses each routed profile's configured API key and never exposes endpoint credentials to the browser.
- Keeps existing mounted-Linux profile and CLI behavior as a compatible fallback.

## Remote session support

- Lists Hermes sessions through `GET /api/sessions`.
- Creates sessions through `POST /api/sessions`.
- Loads normalized conversation history through `GET /api/sessions/{id}/messages`.
- Deletes sessions through `DELETE /api/sessions/{id}`.
- Marks API and CLI session paths explicitly for diagnostics.
- Falls back to the local CLI only when a valid Linux Hermes installation is actually available.

## Models, skills, and Agent Desk behavior

- Discovers Hermes model aliases through `/v1/models` and shows API-only profiles as read-only model cards.
- Discovers enabled skill names, descriptions, and categories through `/v1/skills`.
- Shows remote skill metadata as read-only instead of inventing local file paths.
- Shows a clear Agent Desk explanation when native profile files are unavailable over the API.

Hermes currently advertises `admin_config_rw: false` and does not document a profile-resource endpoint. For that reason, remote `SOUL.md`, workspace-document, skill-content, profile-create, and profile-delete operations remain unavailable over the API. Those operations still require a real Linux Hermes profile mounted into the My Virtual World container. The product does not attempt unsafe host-path access, terminal prompting, or Windows-path execution from Linux.

## Existing Hermes runtime features

The same authenticated connection continues to support the previously implemented Hermes runtime contract:

- run submission through `/v1/runs`;
- Server-Sent Event progress through `/v1/runs/{id}/events`;
- approval responses when advertised;
- run cancellation when advertised;
- authenticated health and connection diagnostics.

## Settings and documentation

- Renames the Hermes preference to **Use Hermes API discovery and runtime features** in Native Connections and Provider SDK settings.
- Expands the field help to explain the complete API transport.
- Documents Windows Docker Desktop, Linux Docker, named profile routing, API keys, capability negotiation, and the current file-access boundary.
- Adds the Virtual World-to-Hermes endpoint map to the API guide.

## Verification

- Passed the complete public smoke, secret scan, connection-help, SMS, Provider SDK, endpoint-resolution, and Python regression suites.
- Added authenticated integration coverage for capabilities, models, skills, session list/create/history/delete, and multiplex profile URLs.
- Completed 100 concurrent API discovery snapshots against a real HTTP test server with no failures.
- Completed a live API create/discover/history/delete cycle against the configured 8590 Hermes endpoint and removed the temporary session afterward.
- Completed 240 concurrent live Virtual World requests (160 Hermes session reads and 80 model-discovery reads) with 24 workers, zero failures, and 30.89 requests per second.
- Verified API-only capability isolation so a remote connection cannot inherit filesystem write permissions.
- Verified desktop and 390 x 844 mobile connection guides and remote session history in the browser with no current console/page errors or horizontal overflow.
- Verified the production Docker build and live 8590 deployment without replacing persistent data or the realtime sidecar.

## Upgrade notes

No data migration is required. Existing Hermes settings remain valid. For Hermes running on a Windows Docker host, enable Hermes and **Use Hermes API discovery and runtime features**, choose **Docker host**, use `http://host.docker.internal:8642` (or the port configured by Hermes), and enter the matching `API_SERVER_KEY`. Disable local profile discovery and local API auto-start when no Linux Hermes profile is mounted.
