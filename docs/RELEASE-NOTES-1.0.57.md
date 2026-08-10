# v1.0.57 — Complete Hermes Docker Integration

Released: August 10, 2026

This release provides a production-ready connection between My Virtual World and a separately containerized Hermes Agent. Hermes' authenticated API remains the runtime transport, while an independently mounted Hermes data directory supplies allowlisted profile files and full skill source. A duplicate Hermes CLI inside the My Virtual World container is no longer required.

## Independent runtime and resource transports

- Uses the Hermes API for discovery, models, sessions, streaming runs, approvals, and cancellation.
- Maps the default profile to the mounted Hermes data root and named profiles to `profiles/<profile>`.
- Supports an explicit mounted profile path for connections whose API identity does not match the directory name.
- Negotiates API, CLI, and mounted-resource capabilities independently for every discovered agent.
- Keeps agent create/delete disabled unless a real local Linux Hermes CLI is available.

## Full Agent Desk resources

- Enables allowlisted `SOUL.md`, identity, workspace-document, and skill-source reads from mounted profiles.
- Supports both flat skills and the official image's nested `skills/<category>/<skill>/SKILL.md` layout for full read/edit/revision behavior.
- Enables resource, profile, and skill edits only when both policy and the mounted filesystem permit writes.
- Keeps skill content available on read-only mounts while disabling all skill and resource mutations.
- Preserves mounted-profile ownership when My Virtual World atomically creates or replaces shared files.
- Retains traversal, absolute-path, hidden-file, symlink-escape, extension, size, and optimistic-revision protections.

## Docker sidecar topology

- Adds an opt-in `hermes` Compose profile using the pinned `nousresearch/hermes-agent:v2026.8.3` image.
- Keeps Hermes port `8642` private to the Compose network instead of publishing it to the host.
- Shares one persistent Hermes data directory with both services; Hermes receives it at `/opt/data` and My Virtual World receives it at `/home/vw/.hermes`.
- Adds global and per-connection mounted-resource settings, including read-write, read-only, disabled, inherited, and exact-profile-path modes.
- Documents Linux and Windows Docker Desktop setup, UID/GID ownership, API-key requirements, upgrades, persistence, and rollback.

The sidecar is opt-in and existing native or remote Hermes configurations continue to work unchanged. Only one Hermes gateway should write a given Hermes data directory at a time.

## Verification

- Passed the complete smoke, secret scan, connection-help, SMS, Provider SDK, and endpoint-resolution suites.
- Validated an API-only Hermes agent on the live 8590 product port with no Hermes CLI in the My Virtual World container.
- Completed a real Hermes model turn through the Provider SDK and verified models, sessions, Server-Sent Event streaming, and the exact reply.
- Verified mounted resource list/read/write, profile editing, full skill-source editing, SHA checks, hidden-file blocking, traversal blocking, absolute-path blocking, and undeclared-extension blocking.
- Verified effective read-only detection using an actual Docker read-only bind mount; file and skill reads remained available while all writes were rejected.
- Started the pinned official Hermes sidecar and verified private Compose DNS, API authentication, 71 nested bundled skill sources, and no published Hermes host port.
- Verified shared files remained owned by the Hermes-side UID after edits.
- Restarted the Hermes sidecar and verified API reconnection plus workspace and nested-skill persistence.
- Completed 250 concurrent health, discovery, resource, skill, and session requests without failures or server errors.
- Verified the live Provider SDK UI, connection test, mounted data root, access policy, API-only mode, and connected state in a real browser.

## Upgrade notes

No data migration is required. For the integrated sidecar topology, set a strong shared `VW_HERMES_API_KEY`, choose a host directory for `VW_HERMES_HOST_HOME`, and start with `docker compose --profile hermes up --build -d`. Existing API-only setups may add `VW_HERMES_RESOURCE_ROOT` and `VW_HERMES_RESOURCE_ACCESS` after mounting the matching Hermes data directory into My Virtual World.
