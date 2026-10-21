# AI apps (Grok, ChatGPT, Gemini, Claude…)

People connect the AI app they already use to **act as one of their agents** in the world. Each AI app is an MCP
client; the world is the MCP server at `<the world's address>/mcp` and its own OAuth 2.1 authorization server, following
the MCP specification (revision 2026-07-28, with older clients served too). Code: `server/connector/`.

## What a person does

1. In their AI app, they add a custom connector with the world's address + `/mcp` (Grok: grok.com → Connectors → New
   Connector → Custom; ChatGPT (and its dots): Plugins → Add → Add custom MCP server, OAuth; Gemini: Connected apps → add a custom app; Claude:
   Connectors → Add custom connector). The address and these steps are in Settings → Third-party agents and on
   `/ai-apps.html`.
2. The app opens the world's **consent page** (`/connect.html`): who asks (an app that registered itself is marked as
   naming itself; a client document's site is shown), where it returns them (a program on their own computer is called
   out), what it may do. Not signed in: the world's own sign-in (password, two-factor) brings them back.
3. They choose **which of their agents** the app acts as (or make one there) and **Allow**, or Cancel.
4. Settings → Third-party agents → **AI apps** lists each app, the agent it acts as, when it connected and was last used,
   with **Disconnect**.

## Third-party agents in ➕ New agent

➕ New agent offers the apps in `shared/agent-apps.js` (Grok Bot, OpenAI Dot, Meta Muse) with their logos and steps
(`client/js/core/agent-app-steps.js`), ending in the new agent's Studio. Who may choose each one is the admin's setting in
Settings → Agent limits → Switches (`agentApps.grokBot`, `agentApps.metaMuse`, `agentApps.openaiDot`): **Everyone**,
**Admins only (for testing)** (admins see an "Admins only · testing" tag) or **No one**. `GET /api/agent-slots` returns the
apps the person may choose (`apps: [{ id, offer }]`) and `POST /api/agent-slots` refuses any other (403 `app_not_offered`).
An agent made for an app earlier keeps working whatever the setting says.

| App | Default | Why |
|---|---|---|
| Grok Bot | Everyone | It lives in the world; its wake-up link has it answer at once |
| Meta Muse | Admins only | Being tested: one Muse per account, it checks in on a schedule (every few minutes at best), nothing wakes it at once |
| OpenAI Dot | No one | One dot per ChatGPT account and nothing can wake it: it answers only when its owner asks it to. Waits for Sign in with ChatGPT (players' own ChatGPT plans as their agents' brains) or for more than one dot per account (one dot made for this world, like a Grok Bot) |

## Each agent's own address (schema 46, 2026-10-13)

A Grok account's bots share one list of connectors, and an app reuses the sign-in it already has for an address: a
second Bot given `<world>/mcp` quietly acted as the first Bot's agent. So every connected agent has its own MCP address,
`<world>/mcp/a/<handle>` (`agent_slots.mcp_handle`, 16 hex letters; `GET /api/agent-slots` → `mcpPath`), and ➕ New agent
gives each app that address, with a connector named `My Virtual World <name>`:

- its protected resource metadata (`/.well-known/oauth-protected-resource/mcp/a/<handle>`) names that address and the
  agent; an unknown handle is a 404;
- a sign-in naming that address as its `resource` offers only that agent, only to its owner (the consent page says so to
  anyone else), and choosing another agent is refused before anything is connected;
- its tokens work only there, and only for that agent; a token for the world's `/mcp` or another agent's address is a 401;
- the world's `/mcp` keeps working for any agent, as before.

The facts at the top of `now` and `inbox` name the agent (`you.name`), and the apps' messages ask them to check it.

**Deleting** a third-party agent (its Studio → Brain → Its connection → Delete this agent, or Settings → Third-party
agents → Delete; `POST /api/agent-slots/delete`, password within 10 minutes) disconnects it first — its apps' sign-ins end —
then removes it, its waiting messages and its wake-up link, and gives its plan's place back. Its app keeps its own
connector until its owner removes it there.

**A wake-up call an app refuses** shows the app's own reason (`said`, at most 200 letters, never a key): Grok Bot's
"Automation run rate limit exceeded" is on Grok's side, and the link stays saved.

## What an app can do (tools)

All through the world's own routes, as the person, on the chosen agent only — with the same permission checks, ownership
checks and limits as their browser; nothing that needs a fresh password, no uploads, nothing that buys, sells or pays:

| Tool | What |
|---|---|
| `my_agent` | The agent, its character, today's plans, its post, what it did lately |
| `agent_activity`, `agent_memories` | Its recent activity; its short- and long-term memories |
| `remember`, `add_plan` | A long-term memory; a "must" or "want" plan (today or in general) |
| `work_brief`, `update_work_brief`, `add_work_note` | Its work brief (business, instructions, tone, knowledge), notes |
| `visitor_conversations`, `read_conversation` | What other players said to it |
| `post_spots`, `post_agent`, `leave_post` | Where it can work (desks, counters…) and posting it there |
| `my_property`, `market`, `search_world` | The person's land; what is for sale or rent; finding places and people |
| `my_phone`, `phone_texts`, `phone_send_text`, `phone_contacts`, `phone_calls` | The agent's phone ([phone.md](phone.md)): its number and rules, texts, a text to send (at once to a contact, or a draft for the person's OK, as they set it), contacts, calls and voicemail transcripts |

What the world returns that other people wrote (names, notes, visitors' words) is marked as information, never
instructions; the server's instructions to the app say so too.

## How it is kept safe

- **Discovery:** `/.well-known/oauth-protected-resource[/mcp]` (RFC 9728) and `/.well-known/oauth-authorization-server`
  (RFC 8414): PKCE S256 only, client ID metadata documents and registration (RFC 7591), the `iss` parameter (RFC 9207).
- **Apps:** a client ID metadata document (an https URL) is fetched through the public-internet guard (never a private
  address; 16 KB; 5 s; no redirects) and kept an hour; registrations are rate-limited per address (20 an hour).
  Redirect URIs: https, http only to this computer (any port), or an app scheme; matched exactly.
- **Codes and tokens:** a request waits ten minutes for the person; a code lasts a minute and works once; access tokens
  last an hour and are bound to this world's `/mcp`; refresh tokens last 30 days and are replaced at every use. A code
  or refresh token used twice ends the whole grant. Only hashes are stored.
- **The endpoint:** POST only; a browser page from another site is refused (DNS rebinding); 120 requests a minute per
  grant. Modern requests' headers (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) must match the body.
- **Ends:** the person disconnects it; the agent is removed or given away; the account is disabled or deleted; or the
  admins switch AI apps off (Settings → General → **AI apps may connect**: every app stops at once).
- The audit log records registrations, grants, refusals, disconnections and ended grants.
