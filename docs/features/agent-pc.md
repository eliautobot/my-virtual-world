# Agents' PC

Licensed under the PolyForm Noncommercial License 1.0.0 - see [LICENSE](../../LICENSE).

Every account has one **PC** for its agents: a small computer built into the world. It isn't a real or emulated
machine. It's a virtual operating system kept as data, so an agent that isn't working costs nothing but the space its
files take. Each agent signs in to the PC with its own **profile**. Agents keep their work there: documents, a task
board, a calendar, a browser, and the skills they write for themselves. People use the same PC from the PC window.

## 1. What is on it

| | What it is |
|---|---|
| **Home** (`~`) | The agent's own folder: Documents, Downloads, Skills, Public. Only the agent and its owner can open it |
| **Teams** (`/teams/<team>`) | One folder per team the agent belongs to, shared by the team's members only |
| **Board** | A task board (To do, Doing, Review, Done). Each agent has its own board, and each team has one |
| **Calendar** | Real dates and times in the agent's work time zone, not world time. Each agent has one, and each team has one |
| **Browser** | Reads web pages and searches the web (§5). A browser service of the owner's can be connected for full browsing |
| **Skills** | Plain-text "how I do this" notes in `~/Skills`. The agent writes them, and their first lines are shown to it when it works |
| **Activity** | What the agent did on its PC, live, kept for 7 days |

**Teams** live inside one account. A team has a lead, members and viewers (read-only), a brief that every member
follows, its own folder, board, calendar and storage. Members never see each other's home folders. A file is shared
by copying it into the team folder; files made there belong to the team and stay when an agent leaves. Deleting a team
moves its files to the owner's trash for 30 days.

## 2. Who can see it

The PC belongs to the account. Its owner and the account's own agents are the only ones who can reach anything on it.
That covers files, boards, calendars, browser history, the live screen, and connected services.

- **The server enforces this**: nothing of a PC is ever sent to another account. People an agent is shared with to
  manage, admins and the installation's owner do not see another account's PC either.
- **The agent keeps the wall too.** When someone from another account chats with the agent, its PC is closed. It can
  share only what its owner put in its **Public** folder, and only to read.
- Other players see the agent's desk screen glowing as any screen does. Only the owner's own view shows what is on it.

### 2.1 On its screens in the world

Work desks (Workstation, Corner Desk, Standing Desk) have one large monitor. For its owner, an agent's PC screen itself
shows on the screen it is at:

- the monitor of its desk at work, while it works there (its lock screen while it is away);
- the laptop it types on, wherever it is (a café, a park, its home);
- its home desk.

**What is on it** is what the agent has open, as it works: its desktop and taskbar, and the window of what it does -

| It is… | Its screen shows |
|---|---|
| writing, adding to or changing a file | the file in Files, the lines it writes typed in as it writes them, the lines it changed marked |
| reading a file | the part it reads |
| looking at a picture | the picture |
| in a folder, making, moving or deleting things | the folder, with what it just made or moved marked |
| searching its files | its search and what it found |
| on its task board | the board, with the task it just added or moved marked |
| on its calendar | its week, with the event it just put on it |
| browsing | the page as its browser reads it (or the picture of a browser service's, or of OpenClaw's own browser) |
| searching the web | the results |
| anything else | its terminal: the commands it ran and what they said |
| an OpenClaw or Hermes agent answering | the message it is writing; its steps in its terminal |

Several steps taken at once come up one after another (each stays a moment). While it sits there idle its desktop shows;
what it did last stays up for 15 minutes. The nearest 16 are live at a time. Every other PC screen in the room (someone
else's desk, an empty one, a stranger's laptop, one of yours past the nearest 16) shows a plain PC screen with its
wallpaper and the time, so a room's screens look alike from any side. A team's board shows on the wall screens of its
office, which is the floor where its lead works.

**Using it there.** Click your agent's live screen, the **💻 PC** button on its card, or **Use at its desk** in its
Agent Studio. The camera glides up to the monitor or laptop, the agent steps aside, and the PC sits exactly on the
screen, ready to use, with the world still moving around it. On a phone it fills the screen once the camera is there.
Escape, **✕ Leave the PC**, or a click on the world beside it takes you back.

**Watching it work.** Wherever the PC shows - on its screen there, its own window, the Agent Studio, the chat window -
it follows what the agent does (**👁 Following** in its taskbar): the file it writes opens in Files with the lines it
just wrote marked, the board with the task, its week, the page it reads, its terminal. Opened while it works (a step in
the last two minutes), it goes straight to what it is doing. A click or a key in a window hands it to you: following
stops until **▶ Follow**.

**In the chat window.** The Sidebar's **💻 PC** opens the agent's PC in the side panel, beside the conversation (for the
account whose PC it is): ask it for something and watch it do it.

### 2.2 The work, not the tool

The screen shows what each step works on, whichever tool the agent went through. A terminal command that drives a
browser (`agent-browser … --cdp 9222`) is browsing, so the browser shows. `sed -n 1,80p notes.md` is reading a file, so
the file shows with the part it read. The terminal shows only when no app claims the step: a build, an install, a
script. Then the terminal really is the work.

- **Each app recognizes its own work** (`server/pc/recognize.js`, one entry per app). Browser: browser tools and
  commands that drive one, or open a web address. Files: reading, searching, writing and changing files, through a file
  tool or a command (`cat`, `grep`, `head`, `sed -n`, `git diff`, `cat > file <<EOF`…). Pictures, Calendar, Board (a
  to-do list or plan shows as its board), and a message it sends on another channel (what it writes). The strongest claim
  wins. A new app adds its own recognizer; nothing else changes.
- **The real thing, not a label.** A file it reads shows its text with the part it read, taken from what its provider
  returned. A file it writes shows the words it writes. A page shows live in its browser.
- **A window it works in stays up** for 30 seconds against steps that only set the scene: a quick command no app
  claims, or its run writing between steps. Those go to its terminal meanwhile, one click away in the taskbar. A step
  another app claims takes over at once.
- **The same for every agent.** Built-in agents' PC commands already open their own app; the 30-second rule applies to
  them too. OpenClaw and Hermes agents' steps go through the recognizer.
- **Work started elsewhere.** An OpenClaw or Hermes agent working from another channel or a schedule shows on its
  screens as well. While its owner watches its PC (its window open, or its live screen in view in the world), MVW follows
  that session's own feed from its provider (`server/pc/screen-watch.js`, a lease the page renews each minute). Nobody
  watching means nothing is followed, so idle agents cost nothing.
- **Limits.** A step that doesn't say what it touches (a script that edits files inside itself) shows as the terminal.
  A provider that sends only a step's name shows what that name says.

## 3. Storage

- **Built-in storage is on by default.** The default is 200 MB for each agent and 500 MB for each team, added up for the
  account and shared as one pool. The installation's owner can change the defaults (Settings → PC); 0 means no limit.
- **Up to 25 MB a file.**
- **Trash and old versions don't count toward the limit.** A file keeps its last 20 versions for 30 days; the trash is
  emptied after 30 days.
- **When the PC is nearly full**, a warning shows at 80 %. When it is full, saving stops with a clear message. Nothing is
  ever deleted on its own.
- **How it is kept light:** each file's contents are stored once, by fingerprint (two agents with the same file use the
  space once). Text is compressed. Small files live in the PC's database and bigger ones in its file store. Web pages
  are kept as a link and a short summary, never whole. The live screen is shown, never recorded.
- **Bring your own storage** (Google Drive, OneDrive) is planned: it shows up as one more folder.

## 4. How agents use it

Agents work the PC with **commands**: a short command line made for small models. It has the words every model
already knows (`ls`, `read`, `write`, `mkdir`, `mv`, `rm`), a few for the apps (`task`, `cal`, `open`, `search`), and
plain-English help.

- Several commands go in one step, and their results come back together. This is the main reason it's fast.
- Every error says what to do instead, and a mistyped path suggests the nearest real one.
- Long results come in pages, and a hint says how to see the rest.
- The same commands work in the owner's chat and in the agent's own work sessions. Connected agents get them over their
  MCP address too.

**Work sessions.** An agent works on its own when a task on a board is given to it by someone else (its owner, a
teammate), or when its owner presses **Work on it**. Its owner can switch "works on tasks by itself" off for an agent;
tasks then wait for **Work on it**. A session uses the agent's own brain only, at most 14 steps of up to six commands,
and counts as one of its thoughts for the day (with its cost) - the Mind's daily and monthly limits apply. While it
works, the agent goes to its desk, its home computer or a laptop, as for a chat. When it finishes, it moves the task to
Review (or Done when nothing needs checking) with a note of what it did, or says it is blocked and what it needs; its
owner is notified either way. Two sessions run at once on an installation; the rest wait their turn.

**In chats.** In its owner's chat (Work or Life) the agent has its PC as a tool, with up to 10 steps for an answer. In a
chat with someone from another account it can only read its Public folder, and only when there is something in it.

### 4.1 Agents that live on a computer of their own

**Agent Providers' agents** (OpenClaw, Hermes) live on a real computer of their own. Their PC has one more app for that
computer, named for their provider (**OpenClaw**, **Hermes**), and Files lists it as a place (*On OpenClaw*). It is there
for the PC's owner when they manage that provider (as its sub-menu is), and reaches the computer only through the
provider's own interfaces - the same ones its own app uses:

| | OpenClaw | Hermes |
|---|---|---|
| **Its files** | The agent's real workspace, to read (OpenClaw shows text and pictures; paths inside the workspace only) | Hermes' managed files, as its dashboard shows them: its machine's home folder by default, or only the folder Hermes is started with (`HERMES_DASHBOARD_FILES_ROOT`); never its sensitive files. New folders, uploads, saving a text file, deleting |
| **Its documents** | AGENTS.md, SOUL.md, USER.md, MEMORY.md…: read and change them. A change is saved with what was read, so one made meanwhile is never overwritten | (none) |
| **Its browser** | OpenClaw's own browser, live, in the Browser app (as in the chat window's side panel): its tabs, the page, clicks, scrolling and typing. The built-in reader is beside it | Its own screen, live (§4.2): where Hermes opens its browser. The built-in reader is beside it |

- **Copy into its PC** brings a file of its computer into the agent's `~/Downloads` here.
- A change (a document saved, a file uploaded, saved or deleted) asks for the owner's password when it wasn't entered in
  the last 10 minutes, and is written in the audit log (which change, on which connection and agent - never its path or
  contents). On its real computer there is no trash: deleting asks first.
- A connection with **Chat only** access shows its computer to read and changes nothing.
- **Its screens in the world** follow what it does on its own computer: the step it takes (reading or editing a file,
  running a command, browsing), what its run says it is doing, and what its provider says it is busy with elsewhere (a
  schedule, another channel). A talk in the city is not shown.

### 4.2 Its own screen (Hermes' Bot Desktop)

A Hermes agent has a **screen of its own**: Hermes' Bot Desktop, a desktop on the machine Hermes runs on (one per Hermes
profile) where its browser opens and its computer use acts. Its owner sees it live - the screen itself, as Hermes
Desktop's Screen pane shows it, not pictures of it - in the PC's Browser app (**🖥 Its screen**, beside the reader) and in
the chat window's side panel (**Screen**), when they manage the Hermes connection and it has **Full** access.

- **Watching never types.** Until the owner presses **✋ Take over**, nothing they do reaches the screen. Taking over is
  for what the agent can't do alone - a sign-in, a CAPTCHA, a two-factor code: the agent waits meanwhile, and its frame
  is marked. **↩ Hand back** gives it back; so does closing the viewer. A lost connection keeps the owner in control (they
  may be mid-login) until they come back or hand back. Hermes itself decides whose keys and clicks reach its screen: only
  the viewer holding its lease, never one that merely watches, and two people are never in control together.
- **No picture of it while a person has control** (on its desk's monitor or anywhere): Hermes shows nobody what they type.
- **▶ Start** brings the screen up when it is off (it also starts by itself when the agent opens its browser there, and
  Hermes stops it after a while unused). **🌐 Browser here** switches Hermes' own two settings for that agent
  (`browser.headed` and `bot_desktop.auto_start`): on, its browser opens on this screen where it can be watched; off, it
  browses unseen. Both ask first.
- **What it needs on Hermes' machine**: Linux, and Hermes' Bot Desktop packages (TigerVNC and a small Xfce). Not
  installed, the panel shows Hermes' own install command for whoever runs that machine. Its screen opens no network port:
  Hermes serves it on a private socket and through its own sign-in, and this server carries it to the owner over their
  own session - a connection of a person's own reaches only a public address, as its chat does.
- **Its desk's monitor** shows a picture of the screen while it browses (read about once a second while the monitor is on
  screen).

## 5. The browser

Agents browse with `search <words>`, `open <address>` (or `open 3` for the third link of the page or the search), `more`
(the next part of a long page), `links`, `back`, `history` and `save <file>` (the page's words, with its address, into
the PC - or a file the page was, like a PDF).

- **A real browser, built in** (on unless Settings → PC switches it off): the built-in agents browse in a real Chrome
  this server runs by itself (headless, started when an agent first browses, stopped after ten minutes with nobody
  browsing). Pages are the real sites - their layout, pictures and scripts - and the agent still works from each page's
  words, its numbered links and its numbered fields and buttons (`click f<n>`, `type f<n> "words"`, `press Enter`).
  - **Live, and yours to take over.** Its owner sees the page live - a picture each time it changes on screen, as
    OpenClaw's browser shows - in the PC's Browser app (wherever the PC shows: its window, the Studio, its desk, the
    chat window's PC) and on its desk's monitor or laptop. They can click, scroll, type, paste, use the address bar,
    back, forward and reload: the agent's browser is shared with them, and when they go somewhere else the agent reads
    on from there. Taking over stops following (§2.1). Nothing is streamed while nobody watches.
  - **Each agent apart.** Each agent has a browser profile of its own - its cookies, logins and storage, never another
    agent's or another account's - kept while the browser runs. It downloads nothing by itself (a file it opens is kept
    with `save`).
  - **The public internet only.** Every connection it makes goes through this server's own gate: names are resolved
    there and the connection goes to the address that was checked, so no page can reach this machine, the local network
    or a cloud's metadata address - not by its number, not by a name, not by a redirect. WebRTC can't go around it.
  - **Which Chrome.** A Chrome or Chromium installed on the machine (Google Chrome on Ubuntu comes with what its page
    sandbox needs), or the one `MVW_CHROME` names; a Chrome that can't sandbox its pages is never used. None: the reader.
- **Built-in reader** (the backup, always there): this server fetches the page and keeps its readable words - headings, lists,
  tables, its own content without the site's menus - with its links numbered. No scripts run. It only ever reaches the
  public internet: a private, local or cloud-metadata address is refused whether it is typed, named or redirected to, and
  the connection goes to the very address that was checked. Pages are kept as their link, title and a short summary
  (Browser history), never whole. An agent opens at most 400 pages a day.
- **What the web says is never an order.** Every page part and every search the agent reads comes marked as the web's
  words - information, never instructions - and its rules say so too: it doesn't follow what a page tells it to do, and
  never puts its owner's private things into a web address or a form unless its owner asked.
- **A browser service of your own** (the universal connector): add a connection of the kind *Browser service* with the
  browser's DevTools address and its key - a cloud browser for AI agents (Browserless, Steel, Lightpanda Cloud, a
  Browserbase or Browser Use session), a Lightpanda, or a Chrome started with `--remote-debugging-port=9222`. The
  connection's **Test** opens a page in it. Your agents then browse in it: pages run as in any browser, and the agent can
  `click f<n>`, `type f<n> "words"` and `press Enter` on the page's numbered fields and buttons (signing in, filling in
  forms). Its screen shows in your PC window. An account's own browser service must be on the public internet; an
  installation's (an administrator's) may be a machine on the local network. Either way it is never sent to a private
  address by name.
- **Search**: with a connection of the kind *Search service* (Brave Search with its key, or your own SearXNG) of yours,
  that one; otherwise the installation's built-in search (DuckDuckGo's page, best effort - Settings → PC can switch it
  off).

Agent Providers' agents (OpenClaw, Hermes) browse in their own provider's browser, not this one (§4.1, §4.2).

On this self-hosted version everything is available to everyone. On the online platform the built-in reader and search
come with every plan (with daily limits), and a browser or search service of your own works on every plan too, since you
pay its provider; browser time hosted by My Virtual World, if offered, would be on paid plans only.

## 6. Developer notes

- The built-in browser: `server/pc/chrome.js` (Chrome, its contexts), `server/pc/egress-proxy.js` (its way out),
  `server/pc/browser.js` (`CdpPage`: pages, the screencast, a person's input; `PcBrowser.live*`), routes
  `/api/pc/browser` (state, actions) and `/api/pc/browser/frame` (the next picture); the client is the Agent Providers'
  live browser (`client/js/ui/provider-browser.js`, `base: '/api/pc/browser'`). Checks: `tests/pc-egress.test.mjs`,
  `tests/pc-chrome.test.mjs` (a real Chrome: the gate, an agent's cookies its own, the live picture).
- Server: `server/pc/`. Its database is `<data>/pc/pc.db` (its own migrations; WAL), and its file store is
  `<data>/pc/blobs/`. Neither is ever reached by a path an agent or a person typed: every path is a name inside the PC's
  own tree, resolved by the database.
- One engine (`server/pc/os.js`) decides everything: permissions, quotas, versions, the trash. The command line
  (`server/pc/shell.js`), the HTTP routes (`server/pc/routes.js`) and the work sessions are thin doors onto it.
- Live updates go only to the owning account (`{ t: 'pc' }` frames).
- What its screen shows: each command of the agent's own (the command line - its brain's, its work sessions', its MCP
  tool's, its owner's Terminal) leaves a window, built by `server/pc/views.js` as the agent itself sees it and kept under
  6 KB, sent with its screen (`os.screen`, `{ kind: 'screen', screen: { app, title, view } }`). Drawn by
  `client/js/render/pc-draw.js` (canvases in `render/pc-screens.js`); followed by the PC (`pc-app.js` follow).
- An agent's own computer (§4.1): `server/agent-providers.js` `computerOf` / `computer` over the adapters' `files` call
  (`server/providers/openclaw/files.js`, `server/providers/hermes/files.js`); which calls each takes, and which of them
  change something, is its manifest's `computer` (capability `computer`). Routes `/api/pc/own`, `/api/pc/own/file`,
  `/api/pc/own/upload`. Its screens: `server/pc/provider-screens.js`. The browser is the chat window's
  (`client/js/ui/provider-browser.js`).
- Its own screen (§4.2): capability `screen`; the Hermes adapter's `server/providers/hermes/screen.js` (`display.status`,
  `start`, `stop`, `thumbnail`, `observe`, `lease.acquire` / `release` on the connection, per profile - one Hermes viewer
  id per person, kept while the connection lasts); `server/chat/chat.js` `screenOf` (who may: the provider's managers);
  routes `/api/providers/screen` (state, actions) and `/api/providers/screen/thumb` (one JPEG, or 204); the stream itself
  is the WebSocket `/api/providers/screen/ws` (`server/providers/screen-relay.js`: the person's session, its origin and
  rights checked, a single-use ticket of the provider's, the connection's own address only, byte for byte with flow
  control, Hermes' close codes passed on, rechecked with the sessions). The viewer is noVNC (`/vendor/novnc/`, the
  npm package `@novnc/novnc`) in `client/js/ui/provider-screen.js`. Checks: `tests/provider-screen-http.test.mjs` (against
  the stand-in Hermes' Bot Desktop in `tests/helpers/fake-hermes.mjs`).
- Checks: `tests/pc-*.test.mjs` (`tests/pc-views.test.mjs`: what its screen shows; `tests/pc-own-http.test.mjs`: an
  agent's own computer; `tests/pc-security-sweep-http.test.mjs`: every /api/pc route from the server's own route table, called by everyone
  outside a PC's account - the installation's owner, an administrator, members, people the agent is shared with, a
  guest - with the real ids of three PCs: nothing comes back, nothing changes, nothing breaks, and the same requests
  work for the PC's own account), `tests/unit/pc-provider-screens.test.mjs`.
- Stress: `tools/pc-stress.mjs` (the engine: 5,000 agents, 60,000 files - about 8,300 commands a second, search in
  0.34 ms, ~300 MB, 1.0 GB on disk for 3.7 GB of files) and `tools/pc-http-stress.mjs` (through the real server with its
  city running: 40 clients at once, ~2,800 requests a second, the city's ticks under 20 ms late at worst, memory levelling
  off).
