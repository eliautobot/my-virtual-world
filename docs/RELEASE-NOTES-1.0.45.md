# v1.0.45 — Universal Provider SDK

Released: August 8, 2026

This release adds a complete, provider-neutral compatibility layer to My Virtual World. Users can connect supported agent runtimes through a shared Contract 1.1 interface without embedding personal accounts, credentials, connection identifiers, models, or provider-specific agents in the product.

The implementation uses My Virtual Office v0.7.1 as the behavioral reference while retaining My Virtual World's own 3D world, Agent Character Builder, Agent Desk, full chat window, yellow in-world bubbles, responsive layout, realtime service, and persistent-data architecture.

## Universal Providers

- Added six built-in provider manifests: OpenClaw, Hermes, Codex CLI, Claude Code, OpenCode, and Antigravity.
- Added a My Virtual World-branded **Universal Providers** page for connections, models, authentication, runtime behavior, permissions, discovery, and capability details.
- Forms are rendered from provider manifests and schemas instead of hard-coded user or installation values.
- Added connection-list editing, client/server validation, redacted secret reads, blank-secret preservation, unsaved connection testing, health and authentication guidance, and manual discovery refresh.
- Added support for optional `vw_provider_*.py` extensions so compatible runtimes can register without changing the core UI.

## Agent creation and lifecycle

- Integrated provider selection into **New Agent** with manifest-driven and conditional creation fields.
- Added normalized native create, discover, profile update, offline retention, forget, and delete workflows.
- Provider identities remain stable across connections using `providerKind + providerConnectionId + providerAgentId`.
- Added guards that prevent deletion of main/default agents and provider workspaces not managed by My Virtual World.

## Agent Desk files and skills

- Added provider-aware file and AgentSkills management driven by each manifest's allowed paths and capabilities.
- Added open, edit, create, delete, diff preview, optimistic SHA conflict detection, automatic backups, revision history, and restore.
- Added AgentSkills frontmatter validation and clear read-only, runtime-active, generated-file, and unsupported-capability messaging.
- Blocked undeclared, sensitive, absolute, traversal, and escaping-symlink paths.

## Provider-native chat and sessions

- Added normalized provider runs, streaming events, history, interrupt, sessions, and approvals where declared by the provider.
- Integrated compatible provider history and progress into both the full chat window and the yellow in-world chat bubble.
- Preserved the established OpenClaw Gateway transport and the existing native Hermes and Codex paths.
- Added capability-driven attachment, session, interrupt, tool, and approval controls without changing existing mobile, follow-mode, scrolling, or realtime behavior.

## Configuration and privacy

- Added optional Docker mounts and environment settings for Claude Code, OpenCode, and Antigravity installations.
- Provider settings are installation-owned and persist independently from application defaults.
- Public health responses omit credentials, accounts, channels, discovered-agent lists, binary paths, and private runtime details.
- Generic attachments are confined to managed upload roots, and provider discovery caches use restricted file permissions.
- Updated the transitive `nanoid` dependency to the patched 3.3.18 release.

## Provider acceptance matrix

| Provider | Acceptance result |
| --- | --- |
| OpenClaw | Connected settings, discovery, lifecycle, files, skills, sessions, streaming chat, tools, interrupt, and approvals passed. |
| Hermes | Connected settings, discovery, lifecycle, files, skills, sessions, streaming chat, tools, interrupt, and approvals passed. |
| Codex CLI | Authenticated settings, discovery, lifecycle, files, skills, sessions, streaming chat, tools, interrupt, and approvals passed. |
| Claude Code | Settings, discovery, lifecycle, files, and skills passed; unauthenticated native runs correctly return actionable login guidance. |
| OpenCode | Connected settings, discovery, lifecycle, files, skills, sessions, streaming chat, tools, and interrupt passed. |
| Antigravity | Settings, discovery, lifecycle, files, and skills passed; unauthenticated native runs correctly return actionable login guidance and unsupported capabilities are identified clearly. |

Claude Code and Antigravity require their own native authentication before they can produce model responses. My Virtual World does not collect or ship provider credentials.

## Verification

- Added 21 focused backend tests covering all-six Contract 1.1 conformance, settings and redaction, lifecycle, resource and skill safety, revisions and restore, sessions, runs, history, interrupts, approvals, authentication gates, attachment confinement, deletion ownership, and 300 concurrent resource reads.
- Passed the public smoke suite, chat UI regression suite, and full realtime smoke suite.
- Completed live desktop and mobile acceptance at 1600×900 and 390×844 using the visible browser profile.
- Verified feature discovery, settings, lifecycle, Agent Desk, chat, in-world bubbles, tools, interrupts, approvals, world navigation, game interactions, realtime behavior, follow mode, console/network health, and horizontal overflow.
- Confirmed no HTTP 5xx responses, server tracebacks, browser console errors, or regressions in the existing world and mobile experience.

## Upgrade notes

- Existing world data, provider-owned workspaces, chat history, and saved provider settings remain preserved.
- Install and authenticate only the provider CLIs you intend to use. Missing or unauthenticated runtimes remain visible with setup guidance and do not prevent other providers from operating.
- Docker users can override the documented `VW_*` host paths, container paths, models, timeouts, and enablement flags for their installation.
- See `docs/AGENT-INTEGRATION.md`, `docs/API.md`, `docs/CONFIGURATION.md`, and `docs/PROVIDER-SDK-PARITY-8590.md` for the complete contract and operational details.
