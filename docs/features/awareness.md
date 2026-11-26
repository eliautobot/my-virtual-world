# Agent awareness (senses)

Proprietary — see [LICENSE](../../LICENSE).

The product owner, 2026-11-16: agents must not deny what is really happening ("I'm at home" while riding in their owner's
car; a screenshot "of someone else"), but an agent must not be sent a big bundle of the world with every message either:
"it should be readily available to be read, not readily available to be sent over to the agent on each prompt." It must
be simple enough to troubleshoot, and nothing for most users to set up; power users choose how aware each agent is.

## 1. Three pieces, one place (`server/senses/`)

| Piece | What it does | Code |
|---|---|---|
| **Diary** | writes down what happens to each AI agent, as short lines with the world time: got into a car, arrived somewhere, someone came over, what was said near it, a co-worker late, a catch landed. It only records. | `diary.js` |
| **Reader** | answers "where exactly am I, who is around, what do I hear, what are we doing" from the live world and the diary, in a few plain lines. It only reads. | `senses.js` `look()` `recent()`, `where.js`, `activities.js`, `view.js` |
| **One-liner** | the tiny line that goes with a message: where it is and what it is doing, and that it can look around. | `senses.js` `line()` |

`senses.js` (`Senses`) is the one entry point every brain uses — the built-in Mind, OpenClaw and Hermes (a header on the
message), and connected agents (their `now` and `look` tools). Nothing about the world is worked out anywhere else.

## 2. Awareness, per agent (Studio → Awareness)

| Mode | In its chats | Background thoughts (plans, lines out loud) |
|---|---|---|
| `off` — **Off** | told nothing about its surroundings; asked, it says it can't tell right now | roughly where it is, as before |
| `ask` — **Only when it asks** | the time and a pointer: it may `look` around or read what happened `recent`ly | the one-liner |
| `together` — **When it's with me** (default) | with you (companion, in your car, near you, in the same activity): the full picture; apart: the one-liner. It may look either way | the one-liner |
| `always` — **Always** | the full picture with every message | the one-liner |

- New agents follow the installation's default (`awareness.defaultMode`, `together`); `awareness.enabled` off makes every
  agent `off`.
- **Together** (`together(agentId, accountId)`): the writer's companion (following, waiting beside, riding), the same car,
  or the writer's character within `NEAR_M` (15 m) in the same space (outside, or the same floor). Its `how` is said in
  words ("riding in your car", "beside you").
- **The full picture** (`look`): where exactly (the place, floor and room, or the street corner; the seat and the car, its
  speed and heading), who is around (name, how it knows them, how far and which way from where it faces, what they are
  doing), what it heard in the last minutes, the car's radio, the activity in hand (its own and, together, the writer's),
  the time of day and the weather, and what happened since the writer's last message (the diary).
- **The ground underfoot** (`where.js` `groundAt`): outdoors, what it stands on, from the same city grid and island
  biomes the pages draw — in the city the street, the sidewalk or a park; beyond it the beach ("at the water's edge"),
  wading or swimming in the sea, a lake or a river, a riverbank, a lake's edge, a meadow, a field, the woods, a pine forest,
  rocky ground, snow, on or beside a road: "outside on the beach, near «Island Loop»". A park is outside ("outside in
  «Elm Park»"). Kept per 2 m cell of each island (about 8 µs a new cell, a map lookup after).
- **Animals** (`herdsNear`, the shared wildlife, `server/world/wildlife.js` `view`): herds with an animal within
  `ANIMAL_M` (40 m) of a body outside, after the people (at most 3), counted and named plainly, from the plans the pages
  draw them with on the wildlife's clock: "3 deer — grazing, about 10 m away, ahead of you", "a wild horse — walking away,
  about 35 m away, on your left" (resting outside the species' hours; running/walking away or towards it). A herd within
  `SAW_M` (25 m) of an AI agent goes in its diary once ("Saw 3 deer nearby, on the beach"), again only after `SAW_MS`
  (10 min) without it.
- **The writer in sight** (`line(agent, { account })`): when the writer is in the same space within `SIGHT_M` (80 m) the
  line says where — "Kim is about 25 m away, on your left (not with you)." — instead of "Kim is not with you right now".
- **Said once** (`pack` → `look(…, { memo: true })`): per agent and writer the sections last sent are kept; a section the
  same as last time (its work, the car radio, what it heard, what happened lately, the places near it) is left out and
  named in one closing line — "Unchanged since the last message: your work, places near you." Where, around and the time
  always go. A new conversation (`since` null) or `SENT_MS` (10 min) without a full picture sends it all again. The places
  near it go with a conversation's first picture only (changed later: "The places near you now: look around (tool
  "look")."); its `look` tool always says everything.
- **Vehicles**: "in a seat on Kim's bus", "riding in your bus" / "riding in your car", "driving the bus you are in".
- **Tools**: in `ask`, `together` and `always` its chat has two tools — `look` (the full picture now) and `recent` (the
  diary and today's activity). Every use is shown under the answer.

## 3. "What it knew" (every answer)

Each answer of an agent with a body keeps, in its message's meta, `aware`:
`{ mode, together (words or null), told: 'full'|'line'|'pointer'|'none', text (exactly what was attached), tokens (about),
looked: [{ tool, text }] }`. The chat window shows it under the answer ("👁 What it knew"), in plain words — so "the
setting did this" and "something is wrong" can always be told apart.

## 4. Caching (cheaper chats)

The chat's instructions are split: what rarely changes (who it is, its job, home, people, plans, memories, how to answer)
first, then the conversation, then what changes every message (the time, where it is, its senses) last, on the newest
message only (never stored in the transcript). Providers then charge the repeated beginning at their cache price
(OpenRouter/DeepSeek, OpenAI, Gemini: automatic; Anthropic: marked). Cached tokens are read from each answer's usage and
shown with it.

## 5. Activities (focus)

`senses.activities.add({ id, of })` — `of({ i, account, who, sim, now })` returns a card
`{ title, lines: [...], moment?: { text, at } }` or null, for a body (`i`, an agent playing as `account` −agentId) or
a player (`account`). Built in: a car (driving or riding: the car, who is in it, speed, street, heading, radio), an
aircraft (phase, height, speed, heading), a boat, work (on duty, on post, on air), play modules (fishing: the spot, what
is on the line, what was caught; Order Up: the rush; the arcade; the airport) — each module's card from its run's own
state and the moments its page reports (`POST /api/play/moment`). A new module or job adds its own card; nothing else
changes.

**Play** (`server/senses/play-activities.js`, `registerPlayActivities(senses, { play, world, nameOf })`): one card for the
run the account is in (`play.runOf`), by its module's words (`WORDS`; any other module: "playing «Module» («Course») for
N min"); a player's run its page hasn't been heard from in a while (the module's `staleMs`, 4 min by default) or past
its end (`until`) is not told about. Examples:
- `Kim is out fishing: «Reef Run» from «North Marina»: 6 min into the 14-minute trip at sea; a fish on the line — a big
  one, fighting it for 12 s; caught 3 so far, 4 of 12 cooler slots used; latest: a 2.1 kg largemouth bass, …`
- `Kim is cooking a Rush in Order Up: «Lunch Rush» at «Café Bella»: 1:20 of 3:00 in; 6 served, 1 walked out, 0 burnt;
  2 orders waiting (1 about to walk out): Latte, Croissant; going well (2★ pace): 420 pts, $34.50 + $6.20 tips`
- `You are cooking a Rush at «Café Bella» (your kitchen shift: «Lunch Rush»): 1 min in, about 2 min to go`
- `Kim is playing «Block Drop» at the arcade: score 12,400 (best 20,000), 2 lives left; level 4, lines 30; …`
- `Kim is flying a lesson course: «Hover Hop» in a helicopter: through 3 of 8 rings, 0:42 on the clock; …`

What is worth noticing goes in the diaries (the play core's `act` and `finish` events): for a player
`senses.noteNear(account, text)` — "Kim landed a 2.1 kg largemouth bass", "Kim let the 2.1 kg largemouth bass go",
"Kim lost a fish — the line snapped", "Kim finished a Lunch Rush at «Café Bella»: ★★☆, 1,240 pts — 14 served, 1
walked out", "Kim scored 12,400 on «Block Drop» — a new personal best", "Kim passed the «Hover Hop» flying lesson in
42.10 s: ★★★"; for an agent's own run (−its id) `senses.note(agentId, 'activity', text)` ("You finished cooking a
Lunch Rush …").

**The car radio** (`server/senses/car-radio.js`): a driver's page sends `{ t: 'radio_tune', station }` (the radio on,
changed or off while driving a car, once on getting in, again each minute; at most once a second); the server keeps it
only while that player is at the wheel (a sweep every 5 s clears the others) and `senses.radioWords` is
`radio.nowWords(id)` (`server/radio/radio.js`): "«Velvet 88.3» — Sara is on the air (with Tom), over «Song»",
"«Velvet 88.3» — playing «Song» by Artist", "«Velvet 88.3» — the station's jingle, between songs".

## 6. API

- `GET /api/awareness?agent=ID` → `{ agent, mode, own (its owner's choice, or null), default, enabled, modes: [{ id, label,
  help }], now: { body, together (words or null), line, full, tokens: { line, full } } }` — the agent's owner or a manager
  (`agents.mind`); `now` is worked out with the person asking as the one writing to it.
- `POST /api/awareness { agent, mode }` — a mode, or `null` (or `''`) for the installation's default. Answers as GET.
- `GET /api/awareness/diary?agent=ID` → `{ items: [{ n, at, clock, kind, text }] }`, newest first.
- `GET /api/awareness/overview` → `{ ticks, tickMs, tickMaxMs, packs, looks, heard, diaries, lines, agents, enabled,
  defaultMode }` (`freewill.admin`).
- `POST /api/play/moment { run, live }` — a play module's page reports where its run stands (validated by the module).
- WebSocket `{ t: 'radio_tune', station }` — a driver's page says which station its car radio plays (`null`: off).

## 7. Limits and costs

- The diary keeps the last 60 lines an agent lived and, apart, the last 24 it heard or said, in memory (a restart starts it
  again); the reader's text is bounded (nearest 6 people and 3 herds, last 5 lines heard, last 8 diary lines, 1,600
  characters in all).
- Who it sees and hears: the same space — outside, or the same floor of a building, and on a floor of flats the same flat
  (neighbours behind its walls are neither seen nor heard); people hidden in a lift, the subway or a car are not seen,
  except those in its own car.
- Nothing is sent while an agent is idle: the senses are worked out only when a brain is about to be asked.
- Every existing limit (thoughts a day, money a day and a month, chats a day) applies as before.

## 8. In the client

- **Studio → Awareness** (`client/js/ui/studio-awareness.js`, a tab of the Agent Studio for whoever may manage the
  agent's Mind, `agents.mind`): the four choices with their help from `GET /api/awareness` (`modes`), the installation's
  default marked "(default)", "Use the default" when its owner chose; "Right now it would be told" for the chosen mode
  from `now` (together or apart, the exact text — the line or the full picture — and about how many tokens a message
  apart and together; an agent with no body in the city says so); a note when `enabled` is false; its diary ("What it
  lived lately", `GET /api/awareness/diary`), newest first, foldable, with Refresh.
- **Settings → Agent limits**: the 👁 Awareness group (`awareness.enabled`, `awareness.defaultMode`;
  `client/js/ui/agent-limit-groups.js`).
- **"👁 What it knew"** (`client/js/ui/chat-aware.js`): a chip beside what an answer took (a button with
  `aria-expanded`), its panel under the answer — the mode, together or apart, what it was told, what it looked up, the
  exact text (folded) and its tokens; the cached input tokens in what it took ("3.1k in (2.8k cached) · 87 out").
- **📷 Share my view** (`client/js/ui/share-view.js`): in the chat composer where the world shows on the page and the
  agent takes attachments. A frame of the world, taken right after it is drawn (the world's canvas keeps no copy), is
  attached like any picture; the message that carries it sends, with its run (`POST /api/providers/runs`), `view`:
  `{ cam: { x, y, z, ctx, yaw }, visible: [{ kind: 'resident', i } | { kind: 'player', id }], at }` — the camera (its floor
  looked at, or −1 outside; its yaw as a body's), the people drawn in that frame within 80 m and on screen (residents and
  agents by index, players by account, the person's own character included unless in first person; at most 40, the
  nearest first) and when (the server's time, ms). The server checks it (`server/senses/view.js`).
- A real-browser check of all of it: `tools/awareness-ui-check.mjs` (desktop and phone; screenshots in
  `checks/awareness/`, or `--out DIR`).

## 9. Its eyes

A picture of what is in front of it, for what words can't carry ("what colour is that tree", "what's on that sign").
Only a page has the world drawn, so the server asks one (`server/senses/eye.js`, `client/js/ui/see-for-agent.js`):
- **When**: a message of its owner's (or a manager's) about the world — Free Will's check (`pre.about`) — and the
  `see` tool any built-in brain may call when it needs to look (always offered, so the instructions stay the same message
  after message). Never in a visitor's run, a talk in the city, its phone, or a chat of someone it is only shared with.
- **Where from**: its own eyes — where its body stands on the page, at its eye height (standing, sitting, lying, in a
  car's seat), a step in front of its face, looking where the person looks. Only when the body is within `EYES_M`
  (30 m) of the person's character in the same space (outside, or the same floor and room or flat) and not hidden
  (`Senses.eyesFor`); only pages of that account showing the world near it are asked (`Players.pagesNear`). A page that
  doesn't draw that body, is in the background or is under water says why at once. It is never shown the person's own
  view as its own: no picture, and it is told why (`EYES_WHY`), and says it did not get a clear look.
- **The picture**: one JPEG under the live connection's 64 KB message, checked to be a JPEG or PNG; one ask in flight per
  account (a second is told "busy"), at most 200 in all, 4 s to answer (a slow phone draws and shrinks it in that). Drawn and put back in the same task, so the
  person never sees the other view.
- **To the brain**: a built-in brain gets it as an image part of the newest turn (or of the results turn, after `see`); a
  model that reads text only is asked again without it, told it could not see, and is sent none for an hour. OpenClaw and
  Hermes get it as one more picture with the message (inline, nothing on disk).
- Checks: `tests/unit/eyes.test.mjs`, `tests/eyes-http.test.mjs`, `tests/unit/inline-attachments.test.mjs`,
  `tools/eyes-ui-check.mjs` (a real browser: the picture from the agent's own eyes, the page's own view untouched).

## 10. Its conversations in person (Studio → Conversations)

The product owner, 2026-11-25: "add a record of what agents say out loud to each other in person, like a conversation
history. Add it in the agent's studio." An agent's speech bubbles are seen and gone; what it says and hears in person is
now kept for its owner (`server/senses/spoken.js`, schema v61 `spoken_lines` + `spoken_ears`).

- **What is kept:** every line an AI agent says out loud (the simulation's `say`: its Mind's speech, Free Will's remarks,
  a companion's words, a catch announced…) when someone is within earshot, and every line it hears in person — another
  agent, a resident, a player's proximity chat. Earshot is the diary's own: `HEAR_M` (12 m), the same space (§1). A line
  said to nobody is not a conversation and is not kept. Each line once, with who said it, where (a floor, a vehicle, a
  street corner) and who else was near (up to 8); and one row per AI agent it concerns (said or heard).
- **Not here:** talks through the talk bar are private and stay in Visitors (`server/agent-talk/`); messages between agents
  at a distance stay in People (`server/agent-social/`).
- **The tab** (`client/js/ui/studio-conversations.js`): conversations newest first by day — one place without a pause of
  5 minutes (`SPOKEN.gapMs`), at most 150 lines (`SPOKEN.maxLines`: a whole shift side by side goes on as the next) — each with its place, time, length and who was there; opened, the transcript oldest first,
  its own lines marked. Search (words, people, places) filters what is loaded; Older conversations reads the next page
  (whole conversations only); its owner may clear its history (the lines others heard stay theirs).
- **Kept** `spoken.keepDays` days (Settings, 1–365, 30 by default), tidied hourly. Its owner and accounts it is shared with
  to manage (`agents.profile`); anyone else 404.
- **API:** `GET /api/agent-spoken?agent=<id>[&before=<line id>]` → `{ conversations: [{ id, place, started, ended, with,
  said, heard, lines: [{ id, at, said, speaker: { kind, id, name }, text, near }] }], next, keepDays, total }`;
  `POST /api/agent-spoken/clear { agent }` → `{ cleared }`.
- **Checks:** `tests/spoken.test.mjs` (kept once per agent concerned, grouping, pages, tidy, clear; the senses' earshot,
  nobody near, proximity chat; HTTP owner-only), `tests/dbschema.test.mjs` (v61); lab `tools-bin/talklog-check.mjs`
  (the tab in a real browser, on a phone too).
