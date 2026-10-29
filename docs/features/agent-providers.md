<!-- Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). -->
# Agent Providers

**Agent Providers** (top bar, beside ⚙️ Settings) is where a person connects the agent platforms they already run -
OpenClaw first, then Hermes, Codex and Claude Code - and works with them from My Virtual World as fully as from each
platform's own app: its agents and sessions in the chat window, its models and thinking levels, its tools as they run,
its plans, its approvals and questions, and its own settings in a sub-menu per provider.

Two parts, one rule: **the chat window is universal** (one window, one event vocabulary, every provider) and **each
provider brings its own sub-menu** (its settings, drawn from what that provider reports about itself). Nothing about a
provider is hard-coded in the pages: what the chat shows comes from the provider's capability profile, which the server
works out when it connects.

## 1. What a person does (OpenClaw)

1. **Agent Providers → ➕ Add provider → OpenClaw.** The form offers the gateway on this machine
   (`ws://127.0.0.1:18789`, OpenClaw's default) or any address, and the gateway's token (or password).
2. **Connect.** My Virtual World signs in as a *device* of that gateway (OpenClaw's device pairing). On the same machine
   OpenClaw approves it silently (its `gateway.nodes.pairing.autoApproveLocal`, on by default); from another machine the
   form shows the request and the two ways to approve it: OpenClaw's Control UI → Devices, or
   `openclaw devices approve <request id>`. It waits and continues by itself once approved.
3. **Done.** The provider is listed with a live status dot; its agents appear in the chat window's agent picker; its
   sub-menu opens beside it. The connection is stored sealed and reconnects by itself.

## 2. How it works

```
browser ──(the world's socket and routes)──► server ──(IPC)──► provider helper process ──(WebSocket, protocol v4)──► OpenClaw gateway
                                              │                  └─ one GatewayClient per connection (@openclaw/gateway-client)
                                              └─ chat, sessions, approvals: who may see and do what
```

- **The adapter runs in the provider helper** (`server/providers/host.js`): a crash there never touches the world, the
  helper's environment holds no server secrets, and credentials arrive with each call. The OpenClaw adapter
  (`server/providers/openclaw/`) keeps one live gateway client per connection, rebuilt when the connection's credentials
  change and stopped when the connection is switched off or removed.
- **OpenClaw's own client.** The adapter uses OpenClaw's published client, `@openclaw/gateway-client` (MIT; the same
  library OpenClaw's apps use): the challenge-signed handshake, protocol negotiation, reconnects with backoff, pausing on
  errors that need a person (a wrong token, a pairing request), and the stored device token. Its version is pinned in
  `package.json`; it speaks gateway protocol v4.
- **Discovery, not assumptions.** The gateway's `hello-ok` lists every method and event it offers and its limits
  (`policy.attachments`, `policy.maxPayload`). The adapter turns that into the provider's **capability profile**
  (section 4): a control appears only when the connected gateway offers what it needs, so an older or newer gateway gets
  what it supports and nothing breaks when OpenClaw adds methods.
- **The device identity** is an Ed25519 key made for the connection the first time it connects (OpenClaw's own scheme:
  device id = SHA-256 of the raw public key). The private key and the device token the gateway issues are sealed like
  every credential (`connection_secrets`, fields `deviceKey` and `deviceToken`); the helper hands new values back to the
  server over IPC (`persist`) and never writes anything itself.
- **The gateway's own token is used once, to pair** (OpenClaw's guide: let pairing mint the client's token and use that).
  Once paired, the connection signs in with its device token and the server forgets the gateway's token (`handoff`
  fields); a device removed in OpenClaw, or whose token expired, says so (*pair again*) and the token is typed again.
  Removing the connection takes its device off the gateway where its access allows (`device.pair.remove`, covered by
  `operator.admin`); with *Chat only* access the page says to revoke it in OpenClaw.
- **Compatibility.** Requests carry only documented fields: a newer client's helpers may add fields an older gateway
  refuses (found 2026-10-15: the 2026.10 client's subscription coordinator sends `subscriptionId`, which a 2026.9 gateway
  refuses), so the adapter subscribes to sessions itself with `{ key, agentId, includeApprovals }`. Tested against
  OpenClaw 2026.9.6 with the 2026.10.4 client.
- **Scopes.** The connection asks for `operator.read`, `operator.write`, `operator.approvals` and `operator.questions`,
  plus `operator.admin` when its *Access* setting is **Full** (the default: the provider's settings can be changed from the
  sub-menu). **Chat only** leaves `operator.admin` out; OpenClaw then refuses every settings change itself.

## 3. Who may do what

- A provider connection is a **connection** (`server/connections.js`): a person's own (scope *account*) or the
  installation's (scope *installation*, by an administrator, shared with roles or accounts). An OpenClaw gateway is a
  powerful credential, so the rules are those of every connection, plus:
  - only the connection's **managers** (its owner; an administrator for an installation one) open its sub-menu, see all
    of its sessions (including those started from OpenClaw's other channels) and change its settings;
  - someone it is **shared** with chats with its agents in sessions of their own: they see only the sessions they started
    here, never anyone else's, and never the gateway's settings;
  - a member's own connection may name only a public address; a gateway on this machine or the local network is an
    administrator's, the installation's or their own (the server's network is the administrator's).
- **Its agents are agents** (`server/agents.js`): each agent the gateway lists has an agent record (`connection_id`, its
  OpenClaw id as `native_id`), owned like the connection, shared like any agent, and listed in the chat window - named
  and badged as OpenClaw shows them: `agents.list` carries only what OpenClaw's settings give, so each agent's
  `agent.identity.get` is asked too (its settings, or its workspace's `IDENTITY.md`); an emoji is kept whole (one
  character to a person, however many code points). In demo mode they count toward the 3 agents like every other.
- **Each lives in the city** like an agent made here (the same body hooks as a connected agent's,
  `AgentProviders.useBodies`): a body with a home, a desk at the HQ and a routine, its job *OpenClaw agent*, and Free
  Will switched on as for any new agent (it waits for a decision service). An agent the gateway no longer lists retires
  its body; listed again, the same body comes back; removing the connection retires them all. The body follows the
  agent's name and badge.
- **Live presence.** An agent at work is at work in the city - its body at its desk, *working*, what it does shown to
  those who may see tasks - whatever started the work: a chat here (its run's events), or OpenClaw's other channels,
  its scheduled jobs and heartbeats. For those, the adapter takes OpenClaw's own session feed (`sessions.subscribe`, on
  every connect: `sessions.changed` rows with `hasActiveRun`, as its Control UI shows them) - no session's events are
  followed for it. Per agent, working or not goes to the bus as `agent.activity` (settled 250 ms: a turn shorter than
  that isn't shown); the presence coordinator keeps it working while OpenClaw says so, then the usual finishing grace.
  A connection that drops ends it.
- **Changing the provider's settings** shows what will change and asks before it is sent; OpenClaw's own base-hash
  guard refuses a change made against settings someone else changed meanwhile. A change also needs the person's password
  entered within the last 10 minutes (asked again otherwise, as for every sensitive change here), and is recorded in the
  audit log (*Providers*: which provider, which call - never what it carried).
- Nothing the gateway sends reaches a page unfiltered: every event is rebuilt by the provider event bus
  (`server/providers/bus.js`) from its whitelist, and text is length-limited.

## 4. The universal chat

### Capability profile

What a connection can do now: the manifest's capabilities (the most its adapter can do) narrowed by what the connected
provider offers. The chat window reads it (`canChat → caps`) and shows only those controls.

| Capability | What the chat shows | OpenClaw: needs |
|---|---|---|
| `chat`, `stop` | the conversation, Stop | `chat.send`, `chat.abort` |
| `agents` | the agent picker lists every agent of the provider | `agents.list` |
| `sessions` | the provider's own sessions (new, switch, rename, delete) | `sessions.list`, `sessions.create`, `sessions.patch`, `sessions.delete` |
| `models` | the model picker (the provider's models) | `models.list`, `sessions.patch` |
| `effort` | the thinking picker, with the levels the chosen model has | `models.list` (`thinkingLevels`) |
| `context` | the context meter: tokens used of the model's window | session rows (`totalTokens`, `contextTokens`) |
| `attachments` | attach, drop, paste; the provider's size limits | `chat.send` attachments, `policy.attachments` |
| `tools` | each tool step as a card: title, kind, status, input, live output, exit code, time | `tool-events` (agent `item`, `tool`, `command_output` streams) |
| `approvals` | approve once / always / deny on a step that waits | `exec.approval.*`, `approval.resolve`, `session.approval` |
| `questions` | the agent's questions, with their options | `question.requested`, `question.resolve` |
| `plan` | the task progress card in the composer: notes, steps and their status; Refresh and Dismiss where offered | `progressCard.get`, `progressCard.changed`, `progressCard.refresh`, `progressCard.put` |
| `commands` | slash commands (`/`) with their descriptions | `commands.list` |
| `observe` | live activity in a session from the provider's other channels | `sessions.messages.subscribe` |
| `settings` | the provider's sub-menu | `config.get`, `config.schema.lookup`, … |
| `media` | the images, video and audio an answer carries: pictures (open large), players, files | `artifacts.download`, the gateway's `assistant-media` route |
| `files` | any file a person attaches - video and audio too (OpenClaw keeps it for the agent); without it, video and recordings are refused before sending | `chat.send` attachments (non-image: saved by the gateway, `[media attached: …]`) |
| `tasks` | the side panel's Tasks: the chat's background tasks (subagents, jobs), their prompt, output and transcript, Stop - for whoever manages the provider | `tasks.list`, `tasks.get`, `tasks.history`, `tasks.cancel`, `task` events |
| `browser` | the side panel's Browser: the agents' own browser, live - tabs, back, forward, reload, the address, clicks, scrolling, keys and typing - for whoever manages the provider, with Full access | `browser.request` (operator.admin), the gateway's screencast socket |
| `computer` | its agents' own computer in their owner's PC (docs/features/agent-pc.md §4.1): their files (and, for OpenClaw, their documents) through the provider's own interfaces, for whoever manages the provider; the manifest's `computer` lists the calls and which of them change something | OpenClaw `agents.workspace.list` / `.get`, `agents.files.*`; Hermes' managed files (`/api/files…`) |
| `screen` | Hermes: its agent's own screen (Hermes' Bot Desktop, where its browser opens), live - watched, taken over and handed back - in the side panel's Screen and the PC (docs/features/agent-pc.md §4.2), for whoever manages the provider, with Full access | `display.status`, `display.start` / `stop`, `display.thumbnail`, `display.observe` (a ticket for its `/api/display/ws` stream), `display.lease.acquire` / `release` |
| `queue` | messages sent while the agent works (Enter: now; Ctrl/Cmd+Enter: after this answer) | `chat.send` (the gateway's `messages.queue`, or `queueMode: followup`) |

### Event vocabulary

Every adapter reports the same events (`server/providers/bus.js`); the chat window renders them whatever the provider.
They follow the Agent Client Protocol's session updates (message and thought chunks, tool calls and their updates, plans,
permission requests), so ACP agents (Codex, Claude Code, Hermes) map onto them one to one.

| Event | Fields | Meaning |
|---|---|---|
| `run.start` / `run.end` | status, text, model, effort, tokens, cost, ms, media, steered | a run and how it ended (media: what the answer carries; steered: a message taken into the turn already running, answered there) |
| `run.status` | phase | what the run is doing before it writes (preparing context, starting the model, compacting…) |
| `run.delta` | text, thinking | a piece of the answer, or of the reasoning shown |
| `tool.start` / `tool.update` / `tool.end` | toolId, name, title, kind, input, text, status, exitCode, ms, cwd | one tool step and its output as it comes |
| `approval.requested` / `approval.resolved` | approvalId, approvalKind, title, command, cwd, summary, options, decision | a step waiting for the person |
| `question.requested` / `question.resolved` | questionId, questions (header, text, options, multiSelect, other, secret), answers | the agent asks the person (a secret's answer never travels back) |
| `plan.update` | title, steps (text, status), explanation, markdown, revision, updatedAt | the progress card changed during the run (empty: taken off) |
| `session.card` | sessionKey, steps, markdown, revision, updatedAt | the session's progress card changed with no run of this installation there (a refresh, another channel, a job) |
| `session.task` | sessionKey, change (upserted, deleted, restored), task, taskId | a background task of a session someone has open changed (a running one at most every 400 ms; its end at once) |
| `usage.update` | used, size | the context meter |
| `agent.activity` | agentKey, active, sessions, task | an agent of the provider at work or not, whatever started it (live presence) |

(A step's kind is `toolKind`, an approval's `approvalKind`: every event's own `kind` is its provider's.)

Live activity: a page with a provider session open watches it (a lease renewed every minute, for whoever manages the
provider); a run the provider does there from another channel is translated like this installation's own and sent to the
watchers marked `observed`: shown as it happens, never holding the composer, and in the history once it ends.

## 5. OpenClaw mapping

| Gateway | Universal |
|---|---|
| `chat` `status` (phase) | `run.status` |
| `chat` `delta` (`deltaText`; `replace` resets) | `run.delta` text |
| agent stream `thinking` | `run.delta` thinking |
| agent stream `item` (kind tool: title, status) + `tool` (args, partial result, result) | `tool.start` / `tool.update` / `tool.end` |
| agent stream `command_output` (output, exitCode, durationMs, cwd) | `tool.update` / `tool.end` output |
| `chat` `final` / `aborted` / `error` (`errorKind`, `errorDetail`) | `run.end` ok / stopped / error |
| `exec.approval.requested`, `plugin.approval.requested`, `session.approval` (OpenClaw's reviewer-safe form: no folder) | `approval.requested` (allow once, allow always, deny), answered with `approval.resolve` |
| `question.requested` / `question.resolved` (the `ask_user` tool, in an agent's main session) | `question.*`, answered with `question.resolve` |
| agent stream `plan`; `progressCard.changed` → `progressCard.get` | `plan.update` during a run of ours; otherwise `session.card`, to whoever has the session open |
| `ask_user`, `progress_card` (and a `tool_call` carrying them) | no step: their cards show them |
| a deferred-tool call (`tool_call`, tools offered by search) and the call OpenClaw reports for it (`parentToolCallId`, live; `custom` entries in the history) | the called tool is the step ("Browser", "Sessions spawn"); the wrapper only when nothing was reported for it |
| a browser tool's result with `details.browserTab` (or the tab it navigated) | `tool.end` / the step's `tab`: the chat's browser card |
| `commands.list` | the composer's / menu |
| agent stream `usage`, session row tokens | `usage.update` |
| `sessions.changed` (after `sessions.subscribe`): a session's `hasActiveRun` | `agent.activity` (live presence) |
| `chat.history` messages (`text`, `thinking`, `toolCall`, `toolResult`, images) | history messages with their steps |
| an agent's `MEDIA:<path or URL>` line; the media blocks OpenClaw keeps from them (`image`, `video`, `audio`, `file` with an `artifactId`) | `media` of the answer (the line leaves the text; a line inside a code block is text) |

### The answer as it is written

The live answer is drawn once as a frame of parts - the reasoning, the steps, the text, what waits for the
person - and each part is changed only when it changed: the text from its first changed paragraph on, a step only when
what it shows changed, at most about twelve times a second. Finished steps before the last three fold into one row
("✓ 57 steps"), their cards drawn only when it is opened; so do a finished answer's in the history. The indicators move
by opacity and transform (the GPU moves them without painting); the reasoning's label fades rather than sweeping a
gradient (painted again every frame before), and every indicator stands still for a person who asks for reduced motion.
(2026-10-16, a 200-step turn: main-thread work 145 → 65 ms a second, the live answer drawn whole 257 times → once,
2,822 → 78 elements, paints 20 → 11 a second.)

### The task progress card

As in OpenClaw's Control UI, the agent's progress card (its `progress_card` tool: notes and a checklist) is not in the
conversation but at the top of the composer, sliding up out of the message box. Folded it is one row - a marker
(under way, stopped where it was, all done), the step under way and how far along (2/3); open, "Task progress", N of M
and when it was written, then the notes and the steps. It is open on a wide screen until every step is done, opens again
when a turn starts or ends, is folded on a phone, and folds by itself when the person scrolls back through the
conversation (not once they have opened it again there twice); their own open or fold stands for that chat while the
page is open. A step under way spins only while a turn runs. **Refresh** (`progressCard.refresh`) asks the agent to bring
it up to date - a hidden turn OpenClaw steers into the session, no message in the chat: "Refreshing task progress…",
then "Task progress updated" when a newer version arrives, "Could not refresh. Previous update kept." on a failure, and
after two minutes without one "No new update yet. The request may still be running." (a retry is the same request, so the
gateway answers it once). **Dismiss** (`progressCard.put` with `expectedRevision`) takes off the version the person saw;
one the agent wrote since stays and is shown. A card changed with no run of this installation there (the refresh, another
channel, a scheduled job) reaches the pages that have the session open (`session.card`); the history carries the card
and which of the two actions the gateway offers (`planCan`).

### Which chats are working

The Sidebar marks each chat the agent is working in now with a small turning ring: an answer of this installation's
being written there, or - a provider session - the provider running a turn in it from anywhere (another channel, a job, a
background task's report). The provider's session feed says which (`agent.activity` carries the session keys of each
agent's running turns); the chats that start or stop are told to the pages of every account that has them
(`{ t: 'chat', agent, session, working }`), and the list itself carries `working` on each one that is.

### Video and audio

A person may attach video (mp4, mov, webm, mkv, m4v, avi, 3gp) and audio (mp3, m4a, wav, ogg, opus, flac, aac) as well
as pictures, PDFs, documents and text. They go only to an agent whose provider takes any file (capability `files`:
OpenClaw saves them for the agent - `[media attached: media://inbound/…]`); a built-in brain, which reads text and
pictures, refuses them with the reason before anything is sent. The composer checks the provider's own limit before
uploading (`GET /api/providers/limits`: OpenClaw announces about 19 MB by default, its `agents.defaults.mediaMaxMb`), and
says so; the installation's own limit (`chat.attachmentMaxMb`, 25 MB by default) applies to every file. A sent video or
recording plays in the person's own message, served in byte ranges so it seeks.

### The side panel: background tasks

As beside a chat in OpenClaw's Control UI, a panel on the right of the chat window - beside the conversation when the
window has room (the conversation keeps at least 440 px), sliding over it when it hasn't - shows what the agent started
from this chat in the background: subagents, scheduled jobs, CLI and ACP runs (OpenClaw's task ledger, `tasks.list` for
the chat's session: up to 200 running and the latest 100 finished). Each task says what it is, how long it has run, what
it is doing or waiting for (its current tool; waiting for approval, for its children, for an external result), how many
tools it used and its latest words; finished ones fold away under "Finished". A task opened shows its prompt, its output,
where its result went, and its own transcript (`tasks.history`, a page at a time); **Stop** cancels it (`tasks.cancel`).
Under the conversation, a row says how many tasks are running ("2 running tasks · Research the venues +1 more") and
opens the panel; the header's panel button carries the same count. A switch at the top shows **This chat**'s tasks
or **All of** the agent's (`scope=agent`: as OpenClaw's Tasks page lists them for one agent): its scheduled jobs and
command runs belong to no chat - on a real gateway (2026-10-16) 2,435 of 2,669 tasks were jobs with no session, so a
chat's own list is often empty and says where the rest are; tasks from other chats say so. The choice is kept in the
browser. Changes arrive as OpenClaw announces them (`task` events, for the agents with a chat open on a page; marked
`here` when the task is that chat's), so the panel doesn't poll - except all of an agent's tasks with no chat followed
yet (one just begun), read again every 15 s. Like the provider's own sessions and live activity,
the panel is for whoever manages the provider: its tasks run with the provider's tools and see its other channels' work.
A chat is followed from its first message on (the run's answer carries the session it made), so the tasks that first
answer starts show at once.

### What an answer shows, as OpenClaw's Control UI does

Compared side by side with OpenClaw's own Control UI on one session of the test gateway (2026-10-16): a tool the agent
reaches through `tool_call` shows as itself, not as the wrapper; a browser step leaves a card for its tab - the page itself
on the chat's latest card (one frame of the agents' browser, for whoever may see it), its title and address, **Open**
(the side panel's Browser on that tab), Copy URL and Open in new tab; a picture has Download and Copy on it, and opens in a
viewer with zoom (− and +, Ctrl+wheel, the + − 0 keys; the % fits it again), Download and Copy (Copy where the browser
allows it: a secure page); a video or recording says its size, with Download; the progress card counts as OpenClaw does
(the step under way, "2 of 3"), says "Updated 5m ago", and marks steps done, under way and paused or to do; its
buttons are the same size in one row - Refresh, the fold arrow (a button: it folds and opens the card), and Dismiss only
once every step is done, as OpenClaw shows it; a task's transcript gives each message's time.

### The side panel: the agents' browser

The panel's Browser tab is the provider's own browser - the one its agents browse with - as OpenClaw's Control UI shows
it beside a chat ("a shared browser for you and the agent"): its tabs (open, choose, close), back, forward, reload, the
address bar (Enter goes there; an address without its scheme is https), Open in your browser, and the page live. A click
on the picture goes to the page where it was clicked (as fractions of the picture, turned into the page's own pixels with
the size its latest frame carries); the wheel scrolls it; Enter, Backspace, Tab, the arrows and the like are sent as keys
and other letters typed as text (a paste too). When the browser isn't running, Start browser starts it. Everything goes
through the gateway's `browser.request` with the routes and actions the Control UI uses; scrolling and back/forward are
fixed functions with numbers in them, so nothing runs a script of anyone's choosing. The gateway's own rules decide which
addresses may open (a local one is refused, and the panel says so). The live picture is the gateway's screencast: the
helper opens it with a short-lived token minted on its own connection, keeps the latest frame of each watched tab (one
socket per tab, shared by every page watching it, closed 15 s after the last asked for a frame), and pages ask for the
next frame after the one they have (`GET /api/providers/browser/frame`: the JPEG with the page's address and size, or 204
after a few seconds without a change). The panel widens to 560 px while it shows the browser, and the picture's box takes
the page's shape. It is for whoever manages the provider, and only on a connection with Full access (the browser needs
operator.admin; on a Chat-only one the tab says so): the agents' browser may be signed in to their accounts.

### Messages while the agent works

As in OpenClaw's Control UI: while an answer is being written, the box stays free and the button stays **Stop**.
**Enter** sends the message at once and OpenClaw takes it as its `messages.queue` is set up - by default *steer*: into the
running turn, at its next tool or model boundary, which answers it; **Ctrl/Cmd+Enter** sends it to wait for this answer
(`queueMode: followup`), with an answer of its own. What was written before the message stays above it; what follows
comes below it. A message steered into the turn ends its own run empty (`steered`): nothing is said about it. Writing
again and editing still wait for the answer, and a provider without the `queue` capability answers one message at a time.

### Media

An agent attaches a file with a line of its own, `MEDIA:<path or URL>`. OpenClaw keeps most of them as attachments in
its history (media blocks with an artifact id, its type, size and dimensions); a line it leaves in the text (an absolute
path, a run through an outside CLI) its own UI fetches by the path. The live answer carries neither, so a run's end
reads the end of the session's history once and brings the run's media with it.

- **One medium, its own address.** The server sends a page each medium with an address it signed for that agent and
  session (`/api/providers/media`, HMAC with a key sealed in the installation's settings); the provider's reference - the
  artifact id, the path the agent wrote - never leaves the server. Only a person who may read that session is served it.
- **Fetched the way OpenClaw's UI does.** A kept one through `artifacts.download` (its bytes, or a short-lived link with its
  own ticket); a path through the gateway's `/__openclaw__/assistant-media` route, signed in with this installation's
  device token (OpenClaw accepts an operator device's token as a Bearer credential there). OpenClaw's own rules decide
  which files a session may show; one it refuses, too large (40 MB) or gone becomes a card with its name.
- **Kept once.** A fetched medium is cached on disk (`MVW_PROVIDER_MEDIA_CACHE_MB`, 1 GB by default, the least recently
  used dropped first) and streamed with byte ranges, so a video seeks.
- **Shown safely.** Pictures, video and audio of the usual types are shown as what they are; anything else is a download;
  every medium is served with a sandboxing content policy and never sniffed.

## 6. OpenClaw's sub-menu

Agent Providers → the provider → its tabs (`client/js/ui/providers/openclaw.js`; the gateway side is
`server/providers/openclaw/menu.js`). What OpenClaw's own Control UI offers, through its gateway:

| Page | What it shows | What it changes (gateway call) |
|---|---|---|
| Overview | the gateway (uptime, port, event loop, memory), its machine, updates | - (an update is run on the gateway's machine) |
| Agents | each agent, its model; Chat opens it | create, rename, change model, delete (`agents.*`) |
| Models | the models, their context and thinking levels; the accounts signed in | the default model (`config.patch`) |
| Tools | an agent's tools in effect in its main session - built in, from plugins, channels and MCP servers, with their risk (`tools.effective`; an older gateway: `tools.catalog`) - and the plugins installed | the tool profile, all agents' and one agent's own (`config.patch`); a plugin on or off (`plugins.setEnabled`) |
| Skills | every skill, ready or what it needs | on or off (`skills.update`) |
| Automations | scheduled jobs, next and last run | on or off, run now, remove (`cron.*`); OpenClaw's own jobs (heartbeat, memory) it keeps itself: shown as such once it says so |
| Approvals | commands waiting; the rules for commands; standing permissions | answer, the rules (`exec.approvals.set`, with its base hash), revoke |
| Sessions | every session of the gateway | open in the chat window, delete |
| Settings | every setting OpenClaw has, in its own sections, labels, help and order | any of them (`config.patch`) |

- **Drawn from what the gateway says about itself.** The Settings page reads OpenClaw's description of its settings
  (`config.schema` once per gateway version, for its sections and which settings are secret; `config.schema.lookup` per
  page: labels, help, choices, bounds, which change needs a restart), so a newer OpenClaw's settings show by themselves;
  the Tools page offers a tool profile only where the gateway's settings have one, with the gateway's own choices.
- **Every change shown first.** A change waits in a save bar (Settings) or a confirmation: each setting, from → to, and
  whether it takes effect at once or at the gateway's restart; nothing is sent before the person's OK. Settings changes
  carry the base hash read with them: changed elsewhere meanwhile, OpenClaw refuses and the page reads them again.
- **A plugin is switched on the way OpenClaw asks**: the page reads what it declares (`plugins.inspect`: its tools,
  providers, channels, hooks, MCP servers, the credentials it needs) and shows it; agreeing sends OpenClaw's review token
  of exactly that inspection, which the gateway checks against a fresh one. The token is the only thing of an inspection
  passed on that is named like a credential; its readme and where its credentials live are not.
- **No secret's value leaves the gateway for a page.** Every value OpenClaw marks sensitive (its `uiHints`), and every field
  named like a key, token or password, arrives as *set* or *not set*; a secret setting is a password field, typed new or
  left as it is.
- **A fixed list of calls.** The server takes only the sub-menu's listed calls (`MENU_READ`, `MENU_WRITE`); the changing
  ones are the manifest's `menuWrite` (a test keeps the two the same), each needing the recent password and recorded.
- **A busy gateway.** While OpenClaw applies a plugin or settings change it may answer *unavailable, retry shortly*: a
  page's reads are asked again a few times; a change is never repeated by itself.
- **Chat only** access (no `operator.admin`): the pages say so, and OpenClaw refuses changes itself.

## 7. Testing

- **An isolated test gateway**, never the person's own: its own OpenClaw profile, port and state
  (`openclaw --profile <name> gateway --port <port>`, at least 120 ports from any other gateway), token auth, and a
  stand-in model (`tools-bin/oc-stub-model.mjs` in the lab: an OpenAI-compatible server whose replies follow directives -
  streaming speed, reasoning, a named tool call, an error status, long answers) so every path runs without cost.
- **Recorded fixtures**: real gateway frames for a plain answer, an answer with reasoning, a tool run with its output, an
  approval, a question, an error and a stop, replayed through the adapter's translation in unit tests.
- **Stress**: many sessions and runs at once, long answers, gateway restarts mid-run, a revoked device, a wrong token,
  large attachments at the gateway's limits, model and thinking changes mid-session.
- **Browser checks** of every control in the chat window and the sub-menu, against the test gateway.

## 8. Status

| Phase | What | State |
|---|---|---|
| 1 | Groundwork: protocol, test gateway, capability profile, this document | done |
| 2 | Agent Providers button, ➕ Add provider → OpenClaw, pairing, live status | done |
| 3 | Chat core: agents, sessions, streaming, tool cards, models, thinking, context, attachments, stop, approvals | done |
| 4 | Chat, the rest: plan card, questions, slash commands, live sessions from other channels | done |
| 5 | OpenClaw's sub-menu: models, agents, tools and plugins, skills, automations, approvals, sessions, settings | done |
| 6 | OpenClaw agents move into the city as residents: bodies; live presence from every channel | done |
| 6b | As OpenClaw's Control UI: the task progress card in the composer (Refresh, Dismiss); a side panel with the agent's tasks and its browser | done |
| 7 | Full stress test; then Hermes, Codex and Claude Code on the same framework | Hermes: done (section 9); Codex, Claude Code next |

## 9. Hermes

[Hermes Agent](https://hermes-agent.nousresearch.com) (Nous Research) is a different framework from OpenClaw - its own
process model, its own words for things - so its adapter (`server/providers/hermes/`) translates what Hermes does into
the same universal chat (section 4). Nothing in the chat window knows which of the two it is talking to.

### Which of Hermes' interfaces

Hermes documents three ways for a program to drive it (its *Programmatic Integration* guide): ACP over stdio (for IDEs),
the OpenAI-compatible API server (for chat front ends: no slash commands, no questions, no session switching), and the
**gateway JSON-RPC** its own Desktop app and web dashboard speak - "a custom desktop / web host that wants every Hermes
feature". The adapter speaks that one, the way Hermes Desktop connects to a *Remote gateway*:

- **The address** of a running `hermes serve` (or `hermes dashboard`) backend - `http://127.0.0.1:9119` by default.
- **Its JSON-RPC** over WebSocket at `/api/ws`, newline-delimited JSON-RPC 2.0 both ways, as described by the contract
  Hermes generates (`apps/shared/src/gateway-contract.openrpc.json`, from `tui_gateway/contracts`): requests and their
  results, events (`{ method: 'event', params: { type, session_id, payload, seq } }`), and **requests from Hermes to the
  client** - its approvals, its `clarify` questions, its masked `secret` and `sudo` prompts - which the client answers
  with a JSON-RPC response of the same id. The adapter says it answers them (`client.capabilities { server_requests:
  true }`, once per connection, as Hermes requires) and answers every other such request with "not implemented", so the
  agent never waits for something nobody will answer.
- **Its REST** beside it (the dashboard's `/api/…`): a session's full stored messages (tool calls with their results),
  the session rows (where each session came from: Telegram, cron, Desktop…), the status page, and the settings pages.

### Signing in

What Hermes itself accepts, chosen in the form (Hermes' public `/api/status` says which applies, so the form can tell):

- **Session token**: a backend bound to this machine (`127.0.0.1`, Hermes' default) accepts only callers on the same
  machine, with the backend's session token (`X-Hermes-Session-Token`, `?token=` on the socket). Hermes mints a new one
  at every start unless the process that starts it sets `HERMES_DASHBOARD_SESSION_TOKEN` (what link-style integrations
  do): the person starts `hermes serve` with a token of their own choosing and enters it here.
- **Username and password**: a backend bound to any other address engages Hermes' sign-in (its username/password
  provider: `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` / `…_PASSWORD`). The adapter signs in the way Hermes' guide asks a
  native app to (RFC 8252: `/auth/native/authorize` with a PKCE challenge, the password form, `/auth/native/token`) and
  keeps the access and refresh tokens Hermes issues (sealed, as OpenClaw's device token is); the password is used once
  and forgotten (`handoff`). The access token is a Bearer credential on REST and `?token=` on the socket; it is renewed
  with `/auth/native/refresh`; when Hermes refuses the refresh, the connection says *sign in again*.
- Hermes' own guards stay as they are: a loopback backend refuses peers that are not on its machine (from a container,
  Hermes must listen on an address the container can reach, which engages sign-in), and it checks the `Host` it is called
  by (its DNS-rebinding guard).

### Agents are Hermes profiles

Each Hermes **profile** (its own SOUL, memory, skills and model; `profiles.list`) is an agent here, named as Hermes shows
it (its display name, else its name). Every call carries the profile it is for (`profile`), so one connection serves all of
them, as Hermes Desktop's roster does.

### Drawn as Hermes Desktop draws it

The chat window is the same for every agent - its frame, composer, model and thinking pickers, Sidebar, side panel and
voice. What happens *inside* a turn is the provider's own: a provider with a **view** of its own lays its turns out the way
its own app does (the window carries `pv-<kind>`; `client/js/ui/providers/<kind>-chat.js`; OpenClaw and the world's own
agents keep the window's drawing, which follows OpenClaw's Control UI). Hermes' view follows Hermes Desktop (MIT; its rules
adapted in `hermes-chat.js`, credited in THIRD-PARTY-NOTICES.md):

- **Flat, not boxed**: the person's turn a hairline box across the column (its actions inside it, on hover); the answer
  plain text, no avatar.
- **A turn is Hermes' sections in Hermes' order**: thinking ("Thinking…" while it streams; "Thought for 2s" / "Thought
  briefly" while the turn runs; "Thought", folded, once kept), words (commentary beside the tools included), tool calls.
- **A tool call is one quiet row** in Desktop's words - "Ran ls -la /tmp", "Read notes.md", "Searched “cats”" (present
  tense while it runs, with its time once done) - opening to `$ command` with an `exit 0` badge and the output, or the
  arguments and result. A **run** of calls with nothing between them folds into one line saying what they did, one clause
  per kind in Desktop's fixed order ("Explored 3 files, ran 5 commands"; the call under way ticks under it while it runs).
  File edits (`write_file`, `patch`, `edit_file`) are rows of their own with `+N −M` and the diff; Hermes' questions
  (`clarify`) are its widget - once answered, each question and its answer, no row; its todo list is not in the turn (it
  belongs to the composer). Red only for a call that failed (denied, an error), never a plain non-zero exit.
- **Built from Hermes' own stream** (the provider bus's `native` event: `server/providers/hermes/native.js`'s whitelist):
  where a thinking or text section begins (by offset in the run's text or reasoning, so the socket and the events route
  agree), each call with Hermes' own arguments and result, its status lines, its todo list - applied once each, by its
  sequence number. **Kept**, the same drawing comes from Hermes' stored messages (`meta.parts`: think, text, tool - in
  order - instead of the universal steps).
- **The composer while Hermes works** (Hermes Desktop's): Send with words - Enter redirects the turn -, Stop without
  (Enter on an empty composer stops), *Queue message* beside Send. Ctrl/Cmd+Enter, files, a slash command, or a turn
  waiting for the person (an approval, a question) go to the **queue** above the composer ("2 Queued"): each message
  deleted, edited back into the composer, steered into the running turn, or sent now (now when idle; else first in line,
  the running turn stopped to reach it); sent by itself, one by one, when a turn ends. Stop pauses it ("2 Queued -
  paused", Resume); an edit or Send now resumes it. Kept per chat while the page is open.
- **What waits for the person**, as Desktop's panels: an **approval** is one card under the turn - *Command* (*Command
  details* when Hermes gives a rule's label instead), what it would run, then *Reject* · *Always allow… ▾* (*Allow this
  session*, *Always allow…*, *Reject*) · *Run ↵* (Enter on the focused card); *Always allow* asks first ("Always allow this
  command?" - it goes into Hermes' permanent allowlist); several waiting: one at a time, "1 / 2"; answered, the card goes
  and the call's row says what happened. Hermes' **questions** (`clarify`) are its widget - "0 of 2 answered", each
  question, its choices lettered A, B… (Hermes' preferred one "(Recommended)" in a quieter tone), "Other (type your
  answer)", a box for a question without choices; *Skip* and *Confirm and continue* under it (Confirm once anything is
  answered; letters and 1–9 pick inside the card); answered, the turn keeps it as each question and its answer. A **sudo
  password** or a **secret** is Desktop's dialog over the window - "Administrator password" with the command it is for
  (or a warning when Hermes gave none), or the variable's name and Hermes' words - Cancel or Send (Enter); the value goes
  to Hermes only, never into an event or the page again. What each request says beyond its questions - the command, the
  variable - comes in Hermes' own stream (`native` `ask`).
- **The status stack above the composer** (Desktop's): Hermes' todo list - "Tasks 2/5", open while a turn runs, each
  item done (a check), under way (a spinner) or to do (a dashed ring); after the turn, "Previous tasks 2/5", folded -,
  then the chat's live **subagents**: "2 Subagents", folded with a spinner: each its goal, what it does now (its tool,
  else its spinner's words) and its time, opening to a box to steer it ("Instructions for this subagent" → Hermes'
  `subagent.steer`, taken into its next step) and Stop (`subagent.interrupt`); *Agents* opens the side panel's Tasks -,
  then the queue. Sections start folded except the todo list; the person's open or fold stays for the chat; a ridge on the
  top edge hides or shows the whole stack. (The window's progress card and its running-tasks chip are not shown: the
  stack says it.) The subagents are the chat's background tasks (`session.task`), read again when the chat starts being
  followed and when a delegation sends its children off - a child's first events can come before a new chat's lease.
- **A delegation** (`delegate_task`) is its card in the turn: one row per child - a breathing mark while it works, a
  check when done, a dot when sent to the background, red when it failed or was stopped - its goal (opens the side
  panel's Tasks), the model running it and, done, how long it took; its time while it works; one line of what it does.
  Live from the same subagents as the stack; kept, from the call's arguments and result.
- **A message's actions** (Desktop's): the person's message - *Edit message* (in place; Enter sends, Esc lets it be),
  *Restore checkpoint* (asked first: "Restore to this checkpoint?" - everything after it goes and it runs again), Copy;
  an answer - *Branch in new chat*, Copy, Read aloud, and on the last one *Refresh* (written again from the person's
  last message). Going back is Hermes' own rewind: `prompt.submit { confirm_truncate, truncate_before_row_id }`: Hermes
  drops that message and everything after it from its record and takes the new one from there (the run's `rewind`, the
  message's row in Hermes' record; the chat's first message replaces the whole chat, which Hermes asks to be told:
  `confirm_empty_truncate`). A branch is `session.branch { count }`: the chat up to that answer (its `upto`: how far the
  record goes there) copied into a new session Hermes names - made this person's chat here at once and opened
  (`POST /api/providers/branch`). Going back waits for the turn under way.
- **Titles** are Hermes' own: it names a session and renames it as it goes (`session.title`); the chat's name follows,
  live in the header and the Sidebar and kept when the turn ends; a rename here goes to Hermes. Its usage follows too
  (`session.usage`).
- **The Sidebar**, as Desktop's list (the window's own list - pinned first, by day, search, projects - with Hermes' own
  marks and menu): a chat at work has a blue dot, one waiting for the person (an approval, a question - `waiting` in
  Hermes' live list, or a run of ours waiting) an orange one, and each row its age (now, 3m, 2h, 4d). A chat Hermes'
  process runs says how it stands itself (`session.active_list`: idle is idle - at once, not after the activity window,
  which is kept for its other channels). The chat menu adds Hermes' own: *Branch* (the whole chat, `session.branch_whole`,
  opened), *Copy ID* (Hermes' session id) and *Archive* (`session.archive`: kept by Hermes, gone from the list here -
  `POST /api/providers/archive`), beside Rename, Pin, Move to a project, Export and Delete.
- **Slash commands** run as Desktop runs them - a message beginning with `/` is a command, never words to the model, and
  it runs at once even while a turn runs (with files it is a message; Ctrl/Cmd+Enter queues it, run when its turn comes):
  a few by the window (*/new* a new chat, */branch* the whole chat into a new one, */model* the model picker, */resume*
  the Sidebar or the chat named), the rest through the call Hermes has for them (*/status* `session.status`, */save*
  `session.save`, */compress* `session.compress`: the transcript read again, its context the meter's -, */title*
  `session.title`: the chat renamed here too; Hermes keeps titles unique and says so -, */reasoning* and */yolo*
  `config.get`/`config.set` (this chat's; `--global` for /reasoning), */stop* `session.interrupt` + `process.stop`,
  */help* the catalog, */btw* `prompt.btw`, */bg* `prompt.background`) or by Hermes itself (`slash.exec`; a skill, a
  quick command or a plugin's through `command.dispatch`: a skill's words go to the model as the person's message,
  which shows the command: `/airtable check the weather`; read again from Hermes' record, which keeps the words, it is
  the command again - Desktop's projection). What a command says is a quiet line in the conversation, as Desktop's -
  the command in mono, then its output (centred when one line) - kept with its chat for the page's life, where it was
  written. A side question's (*/btw*) and a background task's (*/bg*) answers come later, outside any turn (Hermes'
  `btw.complete`, `background.complete` → the bus's `session.native`), to whoever asked and whoever has the chat open:
  `[btw "question" (id)]` and the answer. A command Hermes marks as not for its Desktop (the terminal's, messaging
  platforms', settings' - `commands.catalog` `desktop`) says so; Desktop's own (its pets, wake word, skins, profiles) say
  they are Desktop's. A command typed into a new chat makes its Hermes session (with the chat's model and thinking
  level) and names the chat after it until Hermes names it.
- **Suggestions while typing** (Desktop's): `/` shows Hermes' catalog by category, then its skills (bundled ones only
  once used); a typed command Hermes' own completer (`complete.slash`) - Commands, Skills, and a command's Options
  (`/reasoning ` → its levels) - never aliases (unless typed in full), hidden commands or those not for here; `@`
  Hermes' references (`complete.path`: `@diff`, `@staged`, `@file:`, `@folder:`, `@url:`, `@git:`, its profiles),
  `@file:` the files of the chat's folder (under Files). Arrows move, Enter or Tab picks (Enter on a command typed out in
  full runs it), Esc closes; a pick that only starts one (`@file:`) suggests on.
- Commands, suggestions and side questions are Hermes' own calls for its view - `POST /api/providers/native` (capability
  `native`): only the calls Hermes Desktop's composer makes (server/providers/hermes/native.js), their arguments rebuilt
  field by field, the session always the chat's own (named by the server, never the page), their answers rebuilt too;
  **only for whoever manages the provider** (a command changes how the agent works, reads its machine's files, runs its
  tools) - anyone else is told so and can send the words without the `/`.
- **The turn's small things**, as Desktop's: the status row under a live turn (a pulse, Hermes' words for a wait -
  "⏳ waiting on provider - retrying in 5s (attempt 2/3)", from its `thinking.delta`, whose other words are only its
  spinner's and stay out - or "Summarizing thread" while compacting, and a clock) shows only when Hermes names such a
  wait or the turn has been quiet for 2 s, its clock counting from then - never while Hermes waits for the person or a
  call shows its own progress; **Esc** while a turn runs stops it (and pauses the queue), as the Stop button - not while
  it waits for the person. A file edit's row is the file's name with its +/−, its diff open (the changed lines tinted,
  no headers or signs); the latest answer, settled, closes with **"1 file changed"**: each file it edited and its +/−,
  *Review* (or a file) opening its edits in the turn. What a turn wrote before the person redirected it stays above
  their correction for the page's life (Hermes keeps it out of its record; Desktop keeps it for the window's). Markdown
  as Desktop's: a code block a tinted slab (no border, header or language; Copy on hover), tables full width with plain
  left-aligned heads, quotes italic in curly quotes; Hermes' own lines (a subagent's task completed) quiet, on the left.
  The / menu says each command in Desktop's own words (its `composer.commandDescs`).
- **The session's goal, loop and heartbeat** (Hermes' session control), first in the status stack as Desktop's: `/goal`
  (a standing goal Hermes works on turn after turn until its judge says it is done), `/loop` (a prompt run again on a
  cadence) and `/heartbeat` (a prompt that comes back when the chat is idle) each a folded section saying how it stands -
  "Goal active · Turn 3/20" (paused, waiting, blocked, done; the icon in the state's colour), "Loop active · Run 1/3 ·
  next ~30m" (deferred while a goal drives the session), "Heartbeat active · every 45m · next 00:44:59" (ticking) -;
  open, what it is (the goal's title, why it is paused or waiting, its criteria with a remove ×, *View details*: its
  objective, contract, quality gates; the loop's prompt, cadence and until; the heartbeat's prompt and how often it fired);
  its ⋯ menu Desktop's actions - Pause / Resume / Resume now, Add criterion (a dialog), Clear all criteria, Clear goal; Pause
  / Resume / Stop loop (Dismiss once done); Pause / Resume / Clear heartbeat - the destructive ones asked first. Read when
  the chat opens (`session.control.read`) and after a goal, loop or heartbeat command, followed live
  (`session.control.update` → the bus's `session.native`), changed through Hermes' own `session.control`; a resumed
  goal's continuation goes as the person's next message (queued while a turn runs). Checked:
  `tools-bin/hm-control-check.mjs`.
- **Acceptance**: `tools-bin/hm-sxs.mjs` runs the same 16 scenes in the real Hermes Desktop and in this window against
  the same test Hermes, compares what each shows (the conversation, a widget, a menu; numbers and times evened out) and
  joins their screenshots side by side (`checks/out/hermes-sxs/`: report.md, report.json).
- Checked against the real Desktop, side by side (the reference lab: an isolated Hermes Desktop against the test Hermes):
  `tools-bin/hm-slash-check.mjs` (slash commands, their lines, /btw and /bg, a skill, the / and @ suggestions),
  `tools-bin/hm-view-check.mjs` (the turn), `tools-bin/hm-side-check.mjs` (the Sidebar's marks, ages and menu), `tools-bin/hm-actions-check.mjs` (edit, restore, refresh, branch, titles), `tools-bin/hm-strip-check.mjs` (the status stack, a delegation, steer, stop), `tools-bin/hm-ask-check.mjs` (approvals and questions on the test Hermes;
  sudo and secret prompts on the stand-in backend - the lab machine's sudo asks for nothing), `tools-bin/hm-busy-check.mjs` (the composer while it works, the queue, and
  a connection cut mid-answer through a relay: the answer whole, no gap).

### The chat

| Hermes | Universal |
|---|---|
| `session.create { profile, source: 'myvirtualworld' }` (a new chat), `session.resume` (an existing one: the live session it gives back carries this connection's events) | the chat's session: the **stored** session id is the session key here; the live id is the adapter's |
| `prompt.submit` → `message.start` … `message.complete` (`status` complete, interrupted, error; `usage`) | `run.start` … `run.end` ok / stopped / error, tokens, context |
| `message.delta`; `message.interim` (commentary beside its tools, already streamed) | `run.delta` text |
| `reasoning.delta`; `reasoning.available` (a whole block: replaces it, ignored once the answer has text - as Hermes Desktop does) | `run.delta` thinking |
| `thinking.delta` (Hermes' spinner lines; a long provider wait named) | `run.status` (never text) |
| `status.update` (compacting, retrying, a goal…) | `run.status` |
| `tool.generating`, `tool.start` (`tool_id`, `name`, `context`, `args`), `tool.complete` (`result`: output, exit code, error, `status: 'blocked'` for a denied command; `duration_s`; `inline_diff`) | `tool.start` / `tool.update` / `tool.end` |
| a deferred tool (offered by search) called through `tool_call { calls: [{ name, arguments }] }`: Hermes reports the called tool itself live; its stored history keeps the wrapper | the called tool is the step, live and in the history |
| `clarify`, `todo_list` (its older name `todo`) | no step: their cards show them (as OpenClaw's `ask_user` and `progress_card`) |
| request `approval` (`command`, `description`, `choices` once / session / always / deny); `request.cancel`, `approval.cancelled` | `approval.requested` with those options; `approval.resolved` |
| request `clarify` (1–5 questions: `qid`, `choices`, `multi_select`); requests `secret`, `sudo` (masked) | `question.requested` (secret ones marked: their answers never travel back) |
| `todo.updated` (the todo tool's whole list) | `plan.update`: the composer's progress card (no Refresh or Dismiss: Hermes has neither) |
| `subagent.start` / `subagent.progress` / `subagent.complete`; `subagent.list`, `subagent.tail`, `subagent.interrupt` | the side panel's Tasks: each delegated child, its status, tools and output tail, Stop |
| `session.interrupt` | Stop |
| busy session, as Hermes Desktop: Enter with words → `session.redirect` (`redirected`: the turn stops at a safe point and goes on with them - no new turn, no end; `queued` while the turn is still being built; one Hermes can't redirect goes as `prompt.submit { queued: true }`) | Enter (`queue: 'redirect'`): the words recorded at once under what the turn wrote so far, the rest of the turn below them; their own run ends empty (`steered`). A turn waiting on Hermes' question (`clarify`): the words are the answer "none of these" - the question skipped, the words redirected into the turn, as Desktop's. Ctrl/Cmd+Enter, files, or a turn waiting for an approval, a password or a secret: the view's own queue (below). A slash command runs at once |
| `model.options` (providers, models, which reason; `can_disable_reasoning`); `config.set { session_id, key: 'model', value: '<model> --provider <p> --session' }`, `config.set { key: 'reasoning' }` | the model and thinking pickers, for that chat only (never the profile's default) |
| `commands.catalog` | the composer's `/` menu |
| `image.attach_bytes`, `file.attach { data_url }` (any file: Hermes stages it for the agent) | `attachments`, `files` |
| an answer's `MEDIA:/absolute/path` lines; a remote image `![](https://…)` | `media`, fetched through the dashboard's file route with the connection's credential |
| `sessions.changed`, `session.active_list` (`status` idle / working / streaming / waiting: the backend process's live sessions, every profile's - counted for a profile when its own store has the session; its status is the truth for them) and the stored session rows of the other channels (`last_activity_at`) | live presence, the Sidebar's marks (working, waiting for the person) |

**Where a chat comes from.** Sessions made here are tagged `source: 'myvirtualworld'`, so Hermes' own lists say where they
came from and Hermes' prompt for that channel applies: Hermes has no built-in hint for it, so its owner may add one in
Hermes' settings (`platform_hints.myvirtualworld`, e.g. "a graphical chat: Markdown renders; send files with
MEDIA:/absolute/path") - the sub-menu's Settings page offers it.

**History** comes from Hermes' stored messages (`GET /api/sessions/{id}/messages`): the person's turns, and each answer
with its reasoning and its steps - a tool call with its result. Rows Hermes keeps hidden (its own scaffolding prompts) are
not shown. A turn stopped or redirected part-way is a hidden, empty row in the store, while Hermes' live transcript
(`session.history`, what its Desktop reads) has what it wrote: when the store has such a row - or ends on the person's
message, a turn just stopped not stored yet - that text is taken from there, by row; exactly what Desktop then shows
(after a redirect, usually nothing: Hermes carries what was written into the turn after it). A compaction may continue the conversation under a new stored id (`session.info.stored_session_id`): it is
followed, and the chat's own id is used again if that one is gone.

**When the connection goes.** The socket lost: the adapter reconnects by itself (jittered backoff, as Hermes' own clients;
a heartbeat when Hermes offers one) and loses nothing, as Hermes' own client (`apps/shared` json-rpc-gateway): it keeps
the last event number seen per live session; reconnected, it attaches each session with a run of its own again
(`session.resume`: the same live session while Hermes runs it), holds that session's live events, fetches what it missed
(`session.events.since { last_seen }`), delivers it in order, then the held ones - each once, by number. Its open
questions are asked again (`open_requests`). Hermes restarted meanwhile (another `replay_epoch`): nothing can be fetched -
the turn finished meanwhile is what Hermes stored after this message, never an earlier one; nothing there ends it as
interrupted. The connection closed here
(Reconnect, switched off, changed, removed) ends every answer still being written, with why: none is left waiting.

**Live presence**: an agent at work in the city whatever started it: this installation's runs exactly; the backend
process's live sessions (Hermes Desktop, its dashboard); and its other channels - its messaging gateway (Telegram and the
rest) and its scheduled jobs run in another process, which records a turn's progress in the session store at most about
once a minute: a session not ended with activity in the last 75 s counts as at work there (it shows a little late and
lingers a little after). Read again when Hermes says its sessions changed, and every 20 s.

**Background tasks**: the side panel's Tasks are Hermes' delegated subagents (`delegate_task`): from the session's events
(`subagent.start` / `progress` / `complete`, read as Hermes Desktop reads them: a thinking event's words are its spinner, a
progress event's what it does, a finished child's summary its result) and `subagent.list`; one's live transcript
(`subagent.tail`, while it runs); Stop (`subagent.interrupt`). "All of the agent's" adds its scheduled jobs (Hermes' cron),
which belong to no chat.

### The sub-menu

Drawn from Hermes' own calls, as its dashboard and Desktop settings show them: Overview (`/api/status`: version, gateway,
platforms, memory and disk), Agents (profiles: create, describe), Models (`model.options`; the default model), Tools
(toolsets on or off), Skills (on or off), Automations (Hermes' cron: pause, resume, run now, remove), MCP servers,
Sessions (every stored session and where it came from), Settings (`/api/config/schema` and `/api/config`). Every change is
shown first and needs the recent password, as for OpenClaw; Hermes' secrets (`/api/env`) are never read, and a setting
named like a key, token or password arrives as *set* or *not set*. Hermes has no revision to send with a change: the
settings are read again first, and one changed elsewhere since the page read it refuses the whole change. Hermes has no
access levels for a client either: *Chat only* is kept by the adapter, which then takes none of the changing calls.

### Testing

- **The isolated test Hermes** (`hermes-test/` in the lab), never the person's own: its own `HERMES_HOME` *and* its own
  `HOME` (Hermes finds a machine's other sign-ins - a Claude Code login, GitHub Copilot's - through the home folder: with
  the person's, the test Hermes offered their subscriptions' models), started outside any git checkout (Hermes reads the
  project's `AGENTS.md` up to the repository root into its prompt), `hermes serve` on its own port with a fixed session
  token, and the stand-in model only (`tools-bin/oc-stub-model.mjs`, Hermes' `custom` provider; no other key in its `.env`).
- **Recorded frames** (`tests/fixtures/hermes/run-*.json`, from Hermes 0.21.5: reasoning, a command, an approval, questions,
  commentary beside a tool, a model failing) replayed through the translation (`tests/hermes-translate.test.mjs`); the lab
  probe that records them keeps only what the tests read and no folder of the machine (the repository's neutrality scan
  checks it).
- **A stand-in Hermes backend** (`tests/helpers/fake-hermes.mjs`) for the server's tests (`tests/hermes-http.test.mjs`):
  both ways of signing in, the chat end to end, queueing as Hermes merges, a socket lost mid-answer, Reconnect mid-answer,
  the sub-menu's rules.
- **Browser checks** against the test Hermes: `tools-bin/hm-ui-check.mjs` (Agent Providers and the sub-menu, 27 checks) and
  `tools-bin/hm-chat-ui-check.mjs` (the chat window, PART=1 and 2: 15 + 12).
- **Stress** (`tools-bin/hm-stress.mjs`, 17 checks, 2026-10-17): ten chats at once (6 s), a burst of five queued messages,
  a 150-paragraph answer, a 40-step turn (Hermes' own loop guard stops a sixth identical call: the stand-in varies them), an
  18 MB file, the model and thinking changed between turns, Reconnect mid-answer, Hermes restarted mid-answer (it drains
  the turn), Hermes restarted with another session token.
