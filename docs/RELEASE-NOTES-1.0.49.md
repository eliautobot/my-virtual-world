# v1.0.49 — Windows Docker Install Hotfix

Released: August 9, 2026

This hotfix corrects a Docker bind-mount error that could stop a fresh Windows installation after the images finished building.

## Fixed Windows installation

- Replaced the relative Claude Code container path `claude` with the absolute Linux path `/home/vw/.local/bin/claude`.
- Explicitly writes absolute container-side paths for Hermes, Codex, Claude Code, OpenCode, and Antigravity when the Windows setup helper prepares `.env`.
- Prevents host-native or stale `.env` values from becoming invalid Linux container mount destinations.
- Keeps the behavior generic across Windows usernames, drive letters, Docker Desktop installations, and Linux hosts.

## Stronger installer preflight

- Retains standard `docker compose config` validation.
- Also inspects the fully rendered Compose JSON because quiet validation alone accepts relative bind targets that the Docker daemon later rejects.
- Stops before container creation with a clear error if any bind target is not an absolute Linux path.
- Adds a generic regression check for every configurable provider bind target rather than checking only Claude Code.

## Verification

- Passed the public smoke, packaging, Docker hygiene, and secret scan suite.
- Rendered a fresh `.env.example` installation with all 12 provider bind targets absolute.
- Created and removed a disposable Docker container through the real daemon with all 12 mounts attached successfully.
- Passed 26 Provider SDK backend checks, 64 chat architecture checks, and 36 chat-session checks.
- Passed OpenClaw event, chat UI, realtime, syntax, Compose, whitespace, and production dependency audit checks with zero vulnerabilities.

## Clean Windows reinstall

From a new v1.0.49 checkout, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-docker-windows.ps1
docker compose up --build -d
```

If a trusted remote browser will use realtime features, supply its browser-reachable address to the helper with `-RealtimeBrowserUrl` before starting Compose.

No data migration is required. The hotfix changes installer configuration and validation only.
