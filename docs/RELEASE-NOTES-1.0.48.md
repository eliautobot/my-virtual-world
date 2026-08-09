# v1.0.48 — Windows & Linux Docker Compatibility

Released: August 8, 2026

This release makes My Virtual World portable across Linux and Windows Docker hosts, fixes remote OpenClaw chat connectivity, and reports unavailable provider runtimes accurately.

## Secure remote OpenClaw chat

- Routed interactive OpenClaw chat through My Virtual World's same-origin port `8590` by default.
- Kept the OpenClaw Gateway URL and operator token on the server instead of sending them to the browser.
- Added a restricted chat/session RPC proxy and a server-owned event stream for the live chat UI.
- Removed the need for remote browsers to connect directly to Gateway port `18789`.
- Retained direct browser-to-Gateway transport as an explicit legacy opt-in for compatible local deployments.

## Cross-platform workspace paths

- Added Windows drive-letter and UNC path recognition without applying Linux path rules to Windows strings.
- Mapped Windows OpenClaw homes and workspaces into the `/openclaw` Docker mount.
- Applied the mapping consistently to discovery, Agent Desk resources, identity files, skills, uploads, media, and agent creation.
- Preserved normal POSIX path behavior for Linux installations.
- Rejected unmappable Windows paths instead of producing malformed paths such as `/app/C:\\...`.

## Windows Docker setup

- Added `scripts/configure-docker-windows.ps1` for repeatable Docker Desktop configuration.
- Automatically uses the current user's `%USERPROFILE%\.openclaw` directory rather than a machine-specific username or location.
- Writes Docker-compatible paths, enables the secure OpenClaw proxy, and validates `docker compose config` before startup.
- Prevents missing Windows bind sources from becoming directories at Linux executable paths.
- Supports a browser-reachable realtime URL for trusted remote devices.

## Hermes and provider availability

- Added support for a Windows-hosted Hermes HTTP API through `host.docker.internal` or a Linux Hermes runtime inside Docker.
- Rejects Windows launchers, directories, and non-executable files where a Linux container executable is required.
- Stops fabricating a live Hermes profile when CLI discovery fails.
- Keeps saved provider history readable while marking unavailable runtimes offline.
- Removes unavailable cached providers from live presence so the world and connection diagnostics agree.

## Verification

- Passed 26 Provider SDK backend checks, including Windows paths, provider resources, Hermes runtime validation, proxy credential protection, and RPC restrictions.
- Passed 64 chat event architecture checks and 36 chat-session recovery checks.
- Passed OpenClaw event, chat UI, public smoke, realtime, syntax, packaging, Docker Compose, Docker hygiene, secret scan, and production dependency audit suites.
- Verified remote-style browser access without a direct request to port `18789`.
- Verified desktop at 1600×900 and mobile at 390×844 for chat ordering, refresh, follow behavior, synchronized in-world bubbles, responsive sizing, overflow, and console/page errors.

## Upgrade notes

- No data migration is required.
- Linux installations can update normally; existing POSIX paths remain supported.
- Windows Docker Desktop installations should run:

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\configure-docker-windows.ps1
  ```

- If a trusted remote browser will use realtime features, pass `-RealtimeBrowserUrl` with the Windows PC's LAN or Tailnet address.
- If Hermes runs as an API on the Windows host, pass `-HermesApiUrl http://host.docker.internal:8642` or the appropriate port.
- Do not expose OpenClaw Gateway port `18789` as a browser-connectivity workaround.
