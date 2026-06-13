# My Virtual World

[![Smoke Test](https://github.com/eliautobot/my-virtual-world/actions/workflows/smoke.yml/badge.svg)](https://github.com/eliautobot/my-virtual-world/actions/workflows/smoke.yml)

My Virtual World is a self-hosted 3D AI virtual world for agent harnesses like OpenClaw and Hermes. Agents can live, work, move between buildings, use objects, and show live activity from local agent systems.

Website: [myvirtualworld.ai](https://myvirtualworld.ai/)

This product is built for local machines, LANs, and private remote-access networks. It is not intended to be exposed directly to the public internet without authentication and network hardening.

![My Virtual World setup preview](docs/assets/setup-8090.png)

## Highlights

- 3D voxel-style world rendered with Three.js
- Roads, buildings, furnished interiors, outside spaces, agents, and object interactions
- Agent movement, seating, standing-use objects, service queues, and world actions
- Demo mode with license activation from the Settings and Setup screens
- Optional OpenClaw gateway integration for live agent presence and chat activity
- Optional Hermes integration for local Hermes profiles
- Optional Agent Browser and SMS/Twilio integrations when licensed and configured
- Persistent world data stored as JSON
- Docker-first deployment with local development support

## Quick Start

The easiest way to run My Virtual World is with Docker. You do not need to install Python or Node.js on your computer when using Docker.

```bash
git clone https://github.com/eliautobot/my-virtual-world.git
cd my-virtual-world
cp .env.example .env
docker compose up --build -d
```

Open the app:

```bash
http://localhost:8590
```

Then open the setup wizard at `http://localhost:8590/setup`.

New to Docker or agent connections? Start with the beginner guide:

[docs/INSTALLATION.md](docs/INSTALLATION.md)

## License Keys

My Virtual World starts in demo mode. Demo mode supports a small starter world and keeps advanced editing, Agent Browser, SMS/Twilio, and Agent Live Mode locked until activation.

Visit [myvirtualworld.ai](https://myvirtualworld.ai/) for product details and License Key information. You can activate from `Settings > License` or from the first-run setup wizard.

## Configuration

Most deployments only need the defaults in `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VW_PORT` | `8590` | HTTP server port |
| `VW_DATA_DIR` | `/data` | Persistent world data directory in Docker |
| `VW_OPENCLAW_PATH` | `/openclaw` | Mounted OpenClaw home path |
| `VW_GATEWAY_URL` | `ws://host.docker.internal:18789` | OpenClaw gateway WebSocket URL |
| `VW_HERMES_ENABLED` | `true` | Enable local Hermes profile support |
| `VW_HERMES_HOME` | `/home/vw/.hermes` | Hermes home path inside Docker |
| `VW_HERMES_BIN` | `/home/vw/.local/bin/hermes` | Hermes CLI path inside Docker |

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for more detail.

## Connecting OpenClaw and Hermes

My Virtual World can show live agent presence and activity when your agent tools are available on the same machine.

For the default Docker setup:

- OpenClaw home is mounted into the container at `/openclaw`.
- The OpenClaw gateway is reached from inside Docker at `ws://host.docker.internal:18789`.
- Hermes home is mounted at `/home/vw/.hermes`.
- The Hermes CLI is mounted at `/home/vw/.local/bin/hermes`.

After the app is running, open `Settings > Connections` or the setup wizard and use those values. See [docs/INSTALLATION.md](docs/INSTALLATION.md#connect-openclaw-and-hermes-agents) for the full beginner walkthrough.

## Remote Access

I recommend using Tailscale for remote access instead of opening ports on your router. Install Tailscale on the computer running My Virtual World and on the device you want to connect from, then open:

```text
http://<your-tailscale-device-name>:8590
```

or:

```text
http://<your-tailscale-ip>:8590
```

Keep `8590`, `18789`, `9222`, and browser/VNC ports off the public internet. See [docs/SECURITY.md](docs/SECURITY.md#remote-access-with-tailscale) for the recommended remote-access setup.

## Local Development

Local development requires Python 3.12+ and Node.js 22+.

```bash
npm ci
VW_PORT=8590 VW_DATA_DIR=.local-data python3 src/server/server.py
```

Open:

```bash
http://localhost:8590
```

## Security

My Virtual World is a control surface for local agent systems. Keep it on a trusted machine, LAN, VPN, or private network.

Do not port-forward `8590`, `18789`, `9222`, or browser/VNC ports to the public internet without authentication and network hardening.

See [docs/SECURITY.md](docs/SECURITY.md).

## Verification

Run the public smoke suite:

```bash
npm test
```

Build the production image:

```bash
docker build -t my-virtual-world:local .
```

## Repository Hygiene

The repository intentionally excludes local runtime data, backups, generated caches, installed dependencies, and private agent state. Keep secrets in `.env` or your local agent-system config, never in source control.
