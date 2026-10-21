# Architecture

Proprietary - see [LICENSE](../LICENSE).

## One process, three parts

```
browser ── HTTPS / WebSocket ──▶ reverse proxy ──▶ Node.js server (server/index.mjs)
  client/  (ES modules, three.js, Rapier)            ├─ HTTP router: every route names a capability
  shared/  (the same code on both sides)             ├─ WebSocket: world stream, player moves, chat events
                                                      ├─ the simulation (server/sim): residents and agents
                                                      ├─ the world store (SQLite: data/next.db)
                                                      ├─ accounts, sessions, settings, audit
                                                      ├─ agents, the Mind, Free Will, chat, voice, economy
                                                      └─ provider helper process (server/providers/host.js):
                                                         every call to an AI or voice service, keys passed per call
```

- **No build step.** The client is plain ES modules served as they are, with three.js for rendering and Rapier for
  physics; `shared/` modules run unchanged in the browser and on the server.
- **The world store.** Buildings, floor layouts, residents and the world's documents are rows in `next.db`, next to
  the accounts, lots and titles, so an edit, its journal entry and any title change commit together.
  `world.json` and `people.json` are exports for backups and tools.
- **The simulation.** `server/sim` plans every resident's day as motion plans (travel plus activity) that clients play
  back; decisions are scheduled ahead of a plan's end, so nothing waits. Agents are residents whose choices may come
  from Free Will or their Mind; the sim never blocks on them.
- **Providers in a helper process.** Model, decision and voice services run in a supervised child process with a
  minimal environment; credentials are opened from the sealed store and sent per call, never kept in the server's
  environment. A crash ends the run cleanly.
- **Realtime.** One WebSocket per page carries the world's plans, people, presence, chat run events (only to the
  account they belong to) and player moves; the server checks each message's capability like a route.

## Main modules

| Area | Where |
|---|---|
| HTTP routes, router, capabilities | `server/routes.js`, `server/auth/permissions.js` |
| Accounts, sessions, two-factor, audit | `server/auth/` |
| Settings registry | `server/settings.js` |
| The world: editor, lots, rights, flats, doors | `server/world/`, `server/property.js`, `server/lot-rights.js` |
| Simulation | `server/sim/` |
| Agents registry and shares | `server/agents.js` |
| Agent lives (traits, plans, memories, people, activity) | `server/agent-life/` |
| Free Will | `server/free-will/` |
| The Mind (plans, reflections, problems, chats, speech) | `server/mind/` |
| Chat sessions, transcripts, runs, attachments | `server/chat/` |
| Work briefs, Visitors' choice | `server/agent-work/` |
| Talking with others' agents | `server/agent-talk/` |
| Agents on post | `server/agent-posts/` |
| Voice | `server/voice/` |
| Economy | `server/economy/` |
| Connected agents API | `server/agent-api.js`, `client/agent-api/` |
| Client entry and core | `client/js/main.js`, `client/js/core/` |
| Rendering | `client/js/render/` |
| Windows and panels | `client/js/ui/` |

## Data

`data/next.db` holds everything that changes: accounts and sessions, settings, the world and its residents, lots and
titles, agents and their lives, chats, the economy's ledger. Schema changes are
numbered, additive migrations (`server/db.js`); a database newer than the code is refused. Secrets are sealed with
AES-256-GCM under the installation key (see [SECRETS.md](SECRETS.md)).
