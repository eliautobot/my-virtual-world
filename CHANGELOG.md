# Changelog

My Virtual World, the self-hosted release (release 2). Release 1 was My Virtual World 1.0.

## v2.0.0 — 2026-10-21

The self-hosted release of the new My Virtual World: the same city, agents, economy and games as the online world,
run on your own machine with your own AI keys.

- **License Key and demo mode, as release 1**: the same Lemon Squeezy store and product, so release 1 keys work, and a
  release 1 activation is imported without a new one (`node tools/admin.mjs licence-import`). Without a key: the world
  stays as it came (building, interiors, signs, layouts, promotional aircraft and restoring a world backup are locked)
  and at most 3 agents in all, built in or connected — a Grok Bot counts. Once activated it works offline; while online
  the server confirms the activation with Lemon Squeezy now and then, and a refunded, disabled or unknown key returns to
  demo mode.
- **Licensed as release 1**: source-available under the PolyForm Noncommercial License 1.0.0; creative assets under
  CC BY-NC-SA 4.0; the brand reserved.
- **The starting map**: a new world opens with a hand-built city — about 110 buildings (apartments, offices, shops,
  restaurants, cafés, gyms, parks), six metro stations, an airport, a marina and two lake docks (`MVW_STARTER_MAP=off`
  generates a city instead).
- **Your own administrator account**: the first visit creates it — your username and password — with a one-time setup
  code the server prints when it starts (also in `setup-code.txt` in the data folder). No more `owner` account with a
  temporary password.
- **Agent Providers: OpenClaw and Hermes**: connect the agent platforms you already run; their agents move into the
  city and work in the chat window as in their own apps. Step-by-step guides: docs/guides/.
- **Land and flats for Virtual Coin**: bought, sold and rented in the world's economy; Virtual Coin is never exchanged
  for money.
- **Outside AIs move in**: a Grok Bot and other AI apps connect as agents over MCP, with wake-up links.
- **Play**: the airport (flying, ring courses) and fishing (marina, boats, the dock store).
- **Agents' PC**: one PC per account with a profile for each agent — files, a task board, a calendar, a browser, its
  own skills, teams with their own folder, board and calendar. Agents work it with a short command line (in chats, in
  work sessions they start from their tasks, over MCP). Their desk monitors and laptops show the work live, for the
  owner only; click one to use the PC right on the screen. The built-in agents browse in a real Chrome (sandboxed, behind
  an egress guard, live and theirs to take over) or the built-in reader; OpenClaw and Hermes agents bring their own
  computer, browser and (Hermes) screen into it.
- **Chat windows, the top bar, laptops, outlines**: chat windows keep clear of the top bar and stack in order; the top
  bar scrolls sideways on a phone; laptops sit on every table's real top; picked and hovered things get an outline.
- **Sending in the chat window**: Enter sends — the phone keyboard's send key too; Shift+Enter is a new line. A message
  written while the agent answers is queued above the box and sent when the answer ends (edit or delete it there; Stop
  pauses the queue).
- **Sound controls**: a 🔊 / 🔇 button on the top bar turns all sound on or off on this device; Settings → Sound has a
  master volume and one for the world, aircraft and games, agents' voices, and videos and recordings — they follow the
  account.
- **Residents follow the homes**: how many live in the city is set by its homes, not a fixed number — the residents fill
  a share of the beds in its apartment buildings (Settings → Residents → Homes filled, 30 % by default); offices, shops
  and restaurants bring jobs. New homes fill up over a world day or two, and people move away the same way when homes go
  or the share is lowered (those without a home or work first, never an agent's resident). `MVW_HOUSING=off` keeps a
  fixed number.
- Not in this release (the online world's only): the shop and payments, plans and billing, free lots and gift codes,
  signing in with Google or X, account emails (an administrator resets a forgotten password), the People page.
