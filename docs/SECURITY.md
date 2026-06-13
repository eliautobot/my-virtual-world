# Security

My Virtual World is a local control surface for agent systems. Treat it like an admin dashboard.

## Recommended Deployment

- Run it on a trusted local machine, LAN, VPN, or private network.
- Keep `8590`, OpenClaw gateway ports, browser CDP ports, and VNC ports closed to the public internet.
- Use a reverse proxy with authentication before any internet exposure.
- Keep secrets in `.env`, OpenClaw config, Hermes config, or your deployment secret store.
- Do not commit `.env`, runtime data, screenshots, backups, or local agent state.

## Optional Agent Browser

The optional browser service exposes CDP and VNC-style access. Enable it only on trusted networks and set a strong VNC password.

Do not expose CDP port `9222` or VNC/browser ports directly to the public internet.

## Sensitive Data

The public repository should not contain:

- API keys or tokens
- SSH keys
- private network addresses
- personal home paths
- local runtime data
- agent logs, memories, or transcripts
