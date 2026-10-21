<!-- Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). -->
# Connect Hermes

Bring your [Hermes Agent](https://hermes-agent.nousresearch.com) (Nous Research) profiles into My Virtual World. Each
Hermes profile becomes an agent with a body in the city, and the chat window works as Hermes Desktop does: sessions,
models and effort, tools as they run, approvals, questions and secret prompts, slash commands, rewinding and branching a
chat, and its Bot Desktop (the screen where its browser opens) live in its owner's PC, to watch or take over.

My Virtual World connects to the Hermes backend (`hermes serve`) the way Hermes Desktop connects to a remote gateway.
You need a current Hermes and an administrator account in My Virtual World.

## Hermes on the same computer (My Virtual World installed natively)

1. Choose a session token (any long random text) and start the Hermes backend with it, so it stays the same across
   restarts:
   ```sh
   HERMES_DASHBOARD_SESSION_TOKEN=<your token> hermes serve
   ```
   (Without it, Hermes makes a new token every time it starts and you would have to enter it again.)
2. In My Virtual World, click **Agent Providers** in the top bar, then **➕ Add provider → Hermes**.
3. Fill in the form:
   - **Hermes address**: `http://127.0.0.1:9119` (Hermes' default). **🔎 Find** looks for it on this machine.
   - **Sign in with**: *Session token*, and paste the same token.
   - **Access**: *Full* lets you change Hermes' settings from here (each change is shown to you first); *Chat only* never
     changes them.
4. **Connect Hermes.**

Done: Hermes shows up with a green dot, each of its profiles is an agent in the chat window's agent picker and in town,
and its sub-menu (beside it in Agent Providers) holds Hermes' settings: profiles, models, toolsets, skills, MCP servers
and scheduled jobs.

## My Virtual World in Docker, or Hermes on another computer

A Hermes backend that listens beyond its own machine always asks for a username and password (Hermes' rule since its
June 2026 hardening), so:

1. Start Hermes listening on the network, with its sign-in:
   ```sh
   HERMES_DASHBOARD_BASIC_AUTH_USERNAME=<name> HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=<password> hermes serve --host 0.0.0.0
   ```
   Keep it on a private network (your LAN, Tailscale) or behind an HTTPS reverse proxy, never on the open internet
   without TLS.
2. Add the provider with:
   - **Hermes address**: from Docker on the same computer `http://host.docker.internal:9119` (**🔎 Find** tries it);
     from another computer its address (`https://` through a proxy).
   - **Sign in with**: *Username and password*, and the two you chose.
3. **Connect Hermes.** The password is used once: My Virtual World keeps the sign-in Hermes issues, renews it, and
   forgets the password. If Hermes ever refuses it, the provider says *sign in again*.

## Good to know

- **Profiles are agents.** A new Hermes profile appears by itself; one you delete leaves town.
- **Agents count as agents.** In demo mode (no License Key) a world has up to 3 agents in all: built in, OpenClaw,
  Hermes or connected AI apps together.
- **Who sees what.** The connection belongs to the administrator who added it. Shared with other accounts (Settings →
  🔌 Connections → Share…), they chat with its agents in sessions of their own and never see Hermes' settings.
- **Its computer.** The files Hermes manages on its machine appear in its owner's PC, and its Bot Desktop shows live on
  its desk monitor.

How it works, for developers: [features/agent-providers.md §9](../features/agent-providers.md#9-hermes).
