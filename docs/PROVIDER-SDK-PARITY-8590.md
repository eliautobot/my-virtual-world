# Universal Provider SDK parity checklist (8590)

Reference: My Virtual Office v0.7.1/current on port 8090. Base architecture: My Virtual World v1.0.44. Current release target: My Virtual World v1.0.64 on port 8590.

The target is behavioral parity adapted to My Virtual World's Three.js world, Agent Character Builder, full chat window, yellow in-world bubble, licensing, and persistent `/data` architecture. My Virtual Office branding, office-only layout, account values, and provider credentials are not copied.

## Contract and discovery

- [x] Contract 1.1 provider registry with stable `providerKind + providerConnectionId + providerAgentId` identity.
- [x] Six built-in manifests: OpenClaw, Hermes, Codex, Claude Code, OpenCode, and Antigravity.
- [x] Extension discovery through `vw_provider_*.py` modules.
- [x] Manifest-declared capabilities, creation fields, settings, resources, skills, and session support.
- [x] Discovery cache retains offline agents without deleting native files.
- [x] Manual discovery refresh and clear online/offline health state.
- [x] Public health payload omits account, channel, agent-list, credential, and private runtime internals.
- [x] Additive manifest `connectionSchema` declares network and process runtime boundaries without breaking legacy extensions.
- [x] Shared endpoint resolver selects one authenticated network endpoint across configured, Docker-host, container-local, and Custom modes.
- [x] Authentication/protocol failures stop fallback, and ambiguous run submissions are never retried through another endpoint or CLI.

## Provider settings UI

- [x] A dedicated **Settings → Connections → Provider SDK** tab, with native connections retained as the default connection method and `providers.html` retained as a direct deep link.
- [x] Provider tabs and health/auth guidance for all six manifests.
- [x] Runtime transport cards accurately distinguish network-capable OpenClaw/Hermes from process-only Codex, Claude Code, OpenCode, and Antigravity.
- [x] Manifest-rendered connection, model, runtime, discovery, session, permission, and authentication fields.
- [x] Connection-list add/remove editing.
- [x] Client and server validation for boolean, number, URL, slug, select, required, and connection-list fields.
- [x] Blank secret preservation and redacted reads.
- [x] Test unsaved connection values without persisting them.
- [x] Save, rebuild the registry, refresh discovery, and preserve unrelated settings.
- [x] Resource and skill rule visibility so users know what Agent Desk may access.
- [x] Desktop and mobile responsive layouts without horizontal overflow.

## New Agent and lifecycle

- [x] Provider list comes from `/api/agent-platforms`; no account/provider configuration is embedded in the form.
- [x] Extra controls come from each manifest's `creationSchema`, including conditional fields.
- [x] Required/select/slug/number validation on client and server.
- [x] Camel-case manifest fields map safely to native adapter signatures.
- [x] Native create, profile update, discovery, offline retention/forget, and native delete dispatch through capabilities.
- [x] Main/default agent deletion guard and managed-workspace ownership guard.
- [x] Live disposable lifecycle acceptance for every installed provider (recorded in final acceptance report).

## Agent Desk files and skills

- [x] File listing uses manifest `resourceSchema`, not a provider-name switch.
- [x] Undeclared, sensitive, absolute, traversal, and escaping symlink paths are rejected.
- [x] Read-only/generated/runtime-active state is visible.
- [x] Open, edit, preview diff, create declared paths, delete when allowed, and refresh.
- [x] Optimistic SHA conflict handling.
- [x] Automatic backups, revision listing, and restore.
- [x] AgentSkills roots come from `skillSchema` and validate required AgentSkills frontmatter.
- [x] Skill create/edit/delete, SHA conflict handling, backups, revisions, and restore.
- [x] Clear unsupported/read-only messaging from capabilities.
- [x] Hermes API runtime can use an independently mounted default, named, or explicitly mapped profile without installing a second Hermes CLI.
- [x] Read-only Docker mounts are detected from the effective filesystem and keep skill source readable while rejecting all writes.
- [x] Shared Hermes files retain the mounted profile owner when My Virtual World creates or replaces content.
- [x] Live file/skill acceptance for every disposable provider agent (recorded in final acceptance report).

## Sessions, chat, bubble, tools, and approvals

- [x] Existing OpenClaw Gateway chat remains the browser-to-Gateway streaming path.
- [x] Existing native Hermes and Codex transports remain intact.
- [x] Other compatible providers use generic `/api/providers/runs`, SSE progress, history, and interrupt.
- [x] Session list/create/switch/delete dispatches by declared capabilities.
- [x] Provider history feeds the full chat window.
- [x] Generic Provider SDK history feeds the yellow in-world bubble.
- [x] Capability-driven session, attachment, and interrupt controls.
- [x] Hermes and Codex approval cards and responses remain available where declared.
- [x] Authenticated streaming/tool/interrupt browser acceptance and auth-gated guidance checks (recorded in final acceptance report).

## Regression and operations

- [x] Focused backend contract, lifecycle, settings, resource, skill, run, session, approval, and security tests.
- [x] Public smoke checks for discoverability, manifest-driven UI, Agent Desk bridges, and generic chat transport.
- [x] Full automated regression suite after final patches.
- [x] Desktop and mobile Kasm/neko acceptance on live 8590.
- [x] Console, network 5xx/traceback, overflow, navigation, world/game, realtime, chat, and follow-mode checks.
- [x] 8590/8592 health, image/container IDs, rollback archive, cleanup proof, and final git status.

## Acceptance disposition

Acceptance completed on 2026-08-08 against the live 8590 deployment using the visible Kasm `neko` browser at 1600×900 and 390×844. OpenClaw, Hermes, Codex, and OpenCode passed connected checks. Claude Code and Antigravity passed manifest/settings/lifecycle/resources/skills checks and returned the expected native-login gate with user-actionable guidance for unauthenticated runs. Disposable native agents, Virtual World resident profiles, histories, sessions, and revision backups were removed after testing.
