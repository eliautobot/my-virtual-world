# Beginner Installation Guide

This guide walks through the recommended Docker setup for My Virtual World and explains how to connect OpenClaw and Hermes agents.

Product details and License Key information are available at [myvirtualworld.ai](https://myvirtualworld.ai/).

## What You Need

Required:

- A computer that can run Docker.
- Docker Desktop on Windows or macOS, or Docker Engine with Docker Compose on Linux.
- Git, or another way to download this repository.
- A web browser.

Recommended:

- At least 4 GB of free RAM for the app and browser.
- At least 2 GB of free disk space.
- OpenClaw installed if you want live OpenClaw agents in the world.
- Hermes installed if you want Hermes profile integration.
- Tailscale if you want to use the app remotely without exposing it to the public internet.

Optional:

- A License Key from [myvirtualworld.ai](https://myvirtualworld.ai/) to unlock paid features.
- Twilio credentials if you want SMS features.
- The optional Agent Browser service if you want browser-control features.

The app has My Virtual World's public Lemon Squeezy store and product IDs built in, and `.env.example` includes the same IDs for clarity. Do not change `VW_LICENSE_STORE_ID` or `VW_LICENSE_PRODUCT_IDS` unless you are running a private fork with a different product.

## Install With Docker

Docker is the easiest install method because it packages the server and dependencies together.

1. Clone the repository:

```bash
git clone https://github.com/eliautobot/my-virtual-world.git
cd my-virtual-world
```

2. Create your local environment file:

```bash
cp .env.example .env
```

3. Optional: change the outside browser port.

The default browser URL is `http://localhost:8590`. If that port is already in use, edit `.env` and change only `VW_HOST_PORT`:

```bash
VW_HOST_PORT=8586
```

Most users should leave `VW_PORT=8590`. `VW_HOST_PORT` is the port on your computer; `VW_PORT` is the port inside the Docker container.

4. Start the app:

```bash
docker compose up --build -d
```

5. Check that it is running:

```bash
docker compose ps
```

You should see both `virtual-world` and `virtual-world-realtime`.

6. Open the app in your browser:

```text
http://localhost:8590
```

If you changed `VW_HOST_PORT`, use that port instead, for example:

```text
http://localhost:8586
```

7. Open the setup wizard:

```text
http://localhost:8590/setup
```

With `VW_HOST_PORT=8586`, the setup URL is `http://localhost:8586/setup`.

If the page does not load, run:

```bash
docker compose logs -f virtual-world
```

## First Setup

The setup wizard helps you configure:

- License or demo mode.
- World name.
- OpenClaw connection paths.
- Hermes connection paths.
- Optional Agent Browser settings.
- Optional SMS settings.

You can also change these later in `Settings`.

## Demo Mode and License Keys

My Virtual World starts in demo mode. Demo mode lets you try the app with a small starter world. Some features stay locked until activation, including advanced editing, Agent Browser, SMS/Twilio, and Agent Live Mode.

To activate:

1. Get a License Key from [myvirtualworld.ai](https://myvirtualworld.ai/).
2. Open `Settings`.
3. Go to the `License` tab.
4. Paste the key into `Activation Key`.
5. Click `Activate`.

You can also activate during first setup from `http://localhost:8590/setup`.

## Connect OpenClaw and Hermes Agents

OpenClaw and Hermes are optional. My Virtual World still runs without them, but agent presence and live activity are much better when they are connected.

### How Docker Sees Your Host Machine

When the app runs in Docker, it is inside a container. The container cannot automatically see every file on your computer, so `docker-compose.yml` mounts the important folders into known paths:

| Host path | Container path | Purpose |
| --- | --- | --- |
| `~/.openclaw` | `/openclaw` | OpenClaw home and workspace files |
| `~/.openclaw/workspace/uploads` | `/openclaw/workspace/uploads` | Shared uploaded files |
| `~/.hermes` | `/home/vw/.hermes` | Hermes profiles and config |
| `~/.local/bin/hermes` | `/home/vw/.local/bin/hermes` | Hermes CLI |
| `~/.local/share/uv` | `/home/vw/.local/share/uv` | Hermes/uv runtime support |

### OpenClaw Settings

In `Settings > Connections`, use these default Docker values:

| Field | Docker value |
| --- | --- |
| OpenClaw Home | `/openclaw` |
| Gateway URL | `ws://host.docker.internal:18789` |
| Gateway Token | Leave blank unless your gateway requires one |

For local development without Docker, use:

| Field | Local value |
| --- | --- |
| OpenClaw Home | `~/.openclaw` |
| Gateway URL | Usually `ws://127.0.0.1:18789` or your gateway URL |

If OpenClaw agents do not appear:

- Make sure OpenClaw is running.
- Make sure the OpenClaw gateway is running.
- Confirm the gateway URL matches your host setup.
- Restart the container after changing `.env` or volume paths:

```bash
docker compose restart virtual-world
```

### Hermes Settings

In `Settings > Connections`, keep Hermes enabled and use these default Docker values:

| Field | Docker value |
| --- | --- |
| Hermes Home | `/home/vw/.hermes` |
| Hermes CLI | `/home/vw/.local/bin/hermes` |
| Hermes API URL | Leave blank for CLI mode |
| Hermes API Key | Leave blank unless your Hermes API requires one |

For local development without Docker, use:

| Field | Local value |
| --- | --- |
| Hermes Home | `~/.hermes` |
| Hermes CLI | `~/.local/bin/hermes` |

If Hermes does not work:

- Confirm Hermes is installed on the host machine.
- Confirm `~/.hermes` exists.
- Confirm the Hermes binary exists at `~/.local/bin/hermes`.
- If you do not use Hermes, set `VW_HERMES_ENABLED=false` in `.env` or turn it off in Settings.

## Optional Agent Browser Hosting

The optional Agent Browser service exposes browser viewer and CDP ports. Only enable it on trusted networks.

1. Set a VNC password in `.env`:

```bash
BROWSER_VNC_PASSWORD=change-this-password
```

2. Uncomment the `agent-browser` service in `docker-compose.yml`.

3. Restart Docker:

```bash
docker compose up --build -d
```

4. In `Settings > Browser`, use:

| Field | Value |
| --- | --- |
| CDP URL | `http://host.docker.internal:9222` |
| Viewer URL | `https://localhost:6901` |

Do not expose `9222` or `6901` directly to the public internet.

## Remote Access With Tailscale

I recommend Tailscale for remote access. It lets your own devices reach My Virtual World over a private Tailnet without opening router ports.

Basic setup:

1. Install Tailscale on the computer running My Virtual World.
2. Install Tailscale on your laptop, tablet, or phone.
3. Sign in to the same Tailnet on both devices.
4. Start My Virtual World with Docker.
5. From the remote device, open one of these:

```text
http://<your-tailscale-device-name>:8590
```

or:

```text
http://<your-tailscale-ip>:8590
```

If you changed `VW_HOST_PORT`, use that port in the Tailscale URL.

Example:

```text
http://my-office-pc:8590
```

or:

```text
http://100.x.y.z:8590
```

Recommended remote-access rules:

- Use Tailscale or another private VPN instead of router port forwarding.
- Do not expose `8590` or the realtime sidecar port `8591` directly to the public internet.
- Do not expose OpenClaw gateway ports, CDP port `9222`, or browser/VNC ports publicly.
- Only share the Tailnet or device with people you trust.
- Use Tailscale ACLs if you need to limit which users or devices can reach the app.

## Updating Later

From the repository folder:

```bash
git pull
docker compose up --build -d
```

If something looks wrong after an update:

```bash
docker compose logs -f virtual-world
```

For realtime sidecar logs:

```bash
docker compose logs -f virtual-world-realtime
```

Your world data is stored in the Docker volume `vw-data`, so rebuilding the image does not erase the saved world.
