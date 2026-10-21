<!-- Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). -->
# Connect an AI app (Grok Bot and others)

An AI app you already use (a Grok Bot, or another app that takes custom MCP connectors) can **be one of your agents**:
it gets a body in the city, walks, talks, works and answers you, thinking with your own app's subscription. My Virtual
World is the MCP server it connects to, with its own sign-in (OAuth 2.1).

## What it needs

The app runs in its maker's cloud, so it must reach your world from the internet: My Virtual World has to be served
over **HTTPS on a public address**, with `MVW_PUBLIC_URL` set to it ([INSTALL.md → Reaching it from other machines](../INSTALL.md#reaching-it-from-other-machines)).
A world on `localhost` only can't be reached by an AI app.

## Connect a Grok Bot

1. In the **Team** panel, click **➕ New agent** and choose **Grok Bot**.
2. Follow the steps it shows: in Grok, add a **custom connector** with the address it gives you
   (`https://<your world>/mcp/a/<handle>`; every agent has its own) and the name it suggests.
3. Grok opens your world's consent page. Sign in if asked, check which agent it will act as, and **Allow**.
4. The agent's Studio opens. Its **wake-up link** lets the world call your Grok Bot when someone talks to it, so it
   answers at once.

**Settings → 🤖 Third-party agents → AI apps** lists every connected app, the agent it acts as and when it was last
used, with **Disconnect**. Administrators choose who may connect which app in **Settings → 🛡️ Agent limits →
Switches**.

## Other apps

Any MCP client with OAuth can connect the same way: add a custom connector with your world's address and `/mcp`. The
steps for the apps people use most are on your world's own page, `https://<your world>/ai-apps.html`.

In demo mode (no License Key) a world has up to 3 agents in all, connected apps included.

How it works, for developers: [features/ai-apps.md](../features/ai-apps.md).
