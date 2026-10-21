<!-- Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). -->
# Connect OpenClaw

Bring your [OpenClaw](https://openclaw.ai) agents into My Virtual World. Each one moves into the city with a body, a
home and a desk, and you work with it in My Virtual World's chat window as fully as in OpenClaw's own app: its sessions,
models and thinking levels, its tools as they run, its plans, approvals and questions, its background tasks and its
browser. OpenClaw keeps running your agents; My Virtual World connects to its gateway, the way OpenClaw's own apps do.

You need OpenClaw 2026.9.6 or newer with its gateway running, and an administrator account in My Virtual World.

## OpenClaw on the same computer (My Virtual World installed natively)

1. On the OpenClaw computer, read the gateway's token:
   ```sh
   openclaw config get gateway.auth.token
   ```
2. In My Virtual World, click **Agent Providers** in the top bar, then **➕ Add provider → OpenClaw**.
3. Fill in the form:
   - **Gateway address**: `ws://127.0.0.1:18789` (OpenClaw's default). **🔎 Find** looks for it on this machine.
   - **Sign in with**: *Gateway token*, and paste the token. (A gateway set up with a password: *Gateway password*.)
   - **Access**: *Full* lets you change OpenClaw's settings from here (each change is shown to you first); *Chat only*
     never touches them.
4. **Connect OpenClaw.** On the same computer OpenClaw approves the connection by itself.

Done: OpenClaw shows up with a green dot, its agents are in the chat window's agent picker, and each one is walking
around town. Its own sub-menu (beside it in Agent Providers) holds OpenClaw's settings: agents, models, skills, plugins,
schedules and approvals.

The gateway's token is used once, to pair. After that My Virtual World signs in with its own device key, so you can
change or rotate the token in OpenClaw without breaking the connection.

## My Virtual World in Docker, OpenClaw on the same computer

Inside its container, `127.0.0.1` is the container itself, so My Virtual World reaches the computer as
`host.docker.internal` (compose.yaml sets that up). OpenClaw's gateway listens only on `127.0.0.1` by default, so let it
listen on the local network too, then restart it:

```sh
openclaw config set gateway.bind lan
openclaw gateway restart
```

`lan` makes the gateway reachable from your local network as well; it still requires its token, so keep the token
private. Then add the provider as above with the address `ws://host.docker.internal:18789` (**🔎 Find** tries it). The container
counts as another machine, so OpenClaw asks you to approve it (see the next section).

## OpenClaw on another computer

1. Make the gateway reachable from My Virtual World's server: a private network such as Tailscale, or `wss://` through
   an HTTPS reverse proxy. Never put a gateway on the open internet without TLS.
2. Add the provider with that address and the gateway's token.
3. **Approve the device.** The form shows the pairing request and waits. Approve it in OpenClaw's Control UI →
   **Devices**, or on the OpenClaw computer:
   ```sh
   openclaw devices list
   openclaw devices approve <request id>
   ```
   My Virtual World continues by itself as soon as it is approved.

## Good to know

- **Agents count as agents.** In demo mode (no License Key) a world has up to 3 agents in all: built in, OpenClaw,
  Hermes or connected AI apps together.
- **Who sees what.** The connection belongs to the administrator who added it. Share it (Settings → 🔌 Connections →
  Share…) and other accounts can chat with its agents in sessions of their own; they never see anyone else's sessions or
  OpenClaw's settings.
- **The agents' computer.** Each OpenClaw agent's workspace appears in its owner's PC, and its desk monitor shows what it
  is working on.
- **Removing it.** Agent Providers → the provider → Remove. With *Full* access the device is also removed from the
  gateway; with *Chat only*, revoke it in OpenClaw (Control UI → Devices).

How it works, for developers: [features/agent-providers.md](../features/agent-providers.md).
