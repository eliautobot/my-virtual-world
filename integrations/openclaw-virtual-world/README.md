# My Virtual World OpenClaw tools

This OpenClaw tool plugin connects the fully bootstrapped OpenClaw agent to its
My Virtual World resident body. It does not implement movement, planning,
memory storage, or action execution itself. Every tool call is activation-bound
and delegates to the existing My Virtual World HTTP API, which remains
authoritative for Live/Default ownership, memory, routing, reservations,
physics, verification, and event history.

Build and validate:

```bash
npm install
npm run plugin:validate
```

Install for local My Virtual World deployments:

```bash
openclaw plugins install .
openclaw config set plugins.entries.my-virtual-world.enabled true
```

By default the plugin resolves each agent's current world and port from My
Virtual World's existing shared Live ownership registry. A fixed `baseUrl` is
available only as an explicit single-world override. Restart or reload the
OpenClaw Gateway after first installation. The tools fail closed unless the
calling agent, current disposable Live turn session, current world claim, and
Live Mode activation all match.
