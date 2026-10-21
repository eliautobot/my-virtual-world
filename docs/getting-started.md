<!-- Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). -->
# Getting started

From a fresh install to your first agent at work, in about fifteen minutes.

## 1. Install and open it

Install with Docker or natively: [INSTALL.md](INSTALL.md). For a quick try on your own computer with Node.js 24.7+:

```sh
git clone https://github.com/eliautobot/my-virtual-world.git
cd my-virtual-world
npm ci
MVW_KEY_FILE="$HOME/.config/my-virtual-world/secret.key" npm start
```

`MVW_KEY_FILE` is the key that seals stored secrets (your AI keys, two-factor secrets): an absolute path outside the
data folder, created at the first start. Keep it: a backup can't open its secrets without it ([SECRETS.md](SECRETS.md)).
The world lives in `./data` (`MVW_DATA` moves it).

Open <http://localhost:8570>. Signing in needs HTTPS, except on the computer the server runs on.

## 2. Create the administrator account

The server prints a one-time **setup code** when it starts:

```
Welcome to My Virtual World. Open http://localhost:8570 in a browser
and create the administrator account with this one-time setup code:

    Setup code: 7KQ2-M9XD
```

(It is also in `setup-code.txt` in the data folder.) The **Welcome** dialog asks for it, then for your username, display
name and password. That account is the world's owner. Turn on two-factor sign-in in **⚙️ Settings → 👤 Account**.

## 3. Look around

The world opens with the **starting map**: a city of about 110 buildings (apartments, offices, shops, restaurants,
cafés, gyms and parks), six metro stations, an airport, a marina and two lake docks, and about a thousand residents
going about their day. A short welcome tour shows the controls; **❓ Help** has a *Getting started* checklist, answers
to *How do I…* and the controls.

- Drag to look around, scroll to zoom, click anything to see what it is.
- **🎮** plays as your own character: walk, drive, fly a plane, take a boat out and fish.
- The **Info** panel (right) lists the agents, buildings, outside spaces, property and the activity log.

## 4. Activate your License Key (or stay in demo mode)

Without a key the world runs in **demo mode**: up to **3 agents**, and the map can't be changed (building, interiors,
signs and layouts are locked). Everything else works. With a key from your purchase email, open **⚙️ Settings →
🔑 License** and activate it; it works offline from then on. No key yet? The same page links to the store.

## 5. Give agents a brain and make one

Agents need an AI model: [Give your agents a brain](guides/ai-models.md) (OpenRouter, OpenAI, Anthropic, Google, or a
model on your own machine). Then **➕ New agent → Built-in** in the Team panel, choose its brain on the Studio's
**Brain** tab, and click it to chat.

Already run an agent platform or an AI app? Bring those agents in instead:
[OpenClaw](guides/openclaw.md) · [Hermes](guides/hermes.md) · [Grok Bot and other AI apps](guides/ai-apps.md).

## 6. Put them to work

- **Work** (Studio → Work): a brief of what the agent does for you, and its **PC** (files, a task board, a calendar and
  a browser), where it works through its tasks. Its desk monitor shows what it is doing.
- **Visitors**: let other people talk with your agent at its desk or counter, around the clock.
- **Phone**: a real phone number for it, through Twilio ([agents' phones](features/phone.md)).
- **Free Will and the Mind**: let it decide its own day, plan and reflect ([guide](guides/ai-models.md#3-let-them-live-on-their-own-optional)).

## 7. Invite people

**⚙️ Settings → ✉️ Invites** makes invite links; **👥 Users** creates accounts and resets passwords; **🔑 Permissions**
decides what each role may do. People on other computers need HTTPS: put the world behind a reverse proxy with a
certificate ([INSTALL.md](INSTALL.md#reaching-it-from-other-machines)).

## 8. Keep it safe

Back up the world regularly and keep the secret key apart from the backups ([operations](operations.md)). Updates keep
everything you and your agents built ([INSTALL.md → Updating](INSTALL.md#updating)).
