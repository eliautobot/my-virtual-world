# Security

My Virtual World is a local control surface for agent systems. Treat it like an admin dashboard.

## Recommended Deployment

- Run it on a trusted local machine, LAN, VPN, or private network.
- Keep `8590`, the realtime sidecar port `8591`, OpenClaw gateway ports, browser CDP ports, and VNC ports closed to the public internet.
- Treat the realtime sidecar as part of the admin surface: connected clients can read and update live runtime state.
- Use a reverse proxy with authentication before any internet exposure.
- Prefer Tailscale for private remote access instead of router port forwarding.
- Keep secrets in `.env`, OpenClaw config, Hermes config, or your deployment secret store.
- Do not commit `.env`, runtime data, screenshots, backups, or local agent state.

## Remote Access With Tailscale

Tailscale is the recommended way to use My Virtual World remotely because it keeps access inside your private Tailnet.

Recommended setup:

1. Install Tailscale on the computer running My Virtual World.
2. Install Tailscale on each device that needs remote access.
3. Sign in to the same Tailnet.
4. Keep the Docker app bound to its local host port, normally `8590`.
5. Connect remotely with `http://<tailscale-device-name>:8590` or `http://<tailscale-ip>:8590`.

If you changed `VW_HOST_PORT`, use that port in the Tailscale URL. For example, `VW_HOST_PORT=8586` means `http://<tailscale-device-name>:8586`.

This avoids opening public router ports. Keep OpenClaw gateway ports, browser CDP ports, and VNC/browser viewer ports private as well.

Use Tailscale ACLs if you need to restrict which users or devices can access the app.

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

The Lemon Squeezy store/product IDs in `.env.example` and Docker config are public validation identifiers. They are not customer secrets or API credentials.
