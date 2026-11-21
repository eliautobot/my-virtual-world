# MVW Radio: the radio host's job

The stations, their breaks and their shows are in `server/radio/radio.js` (breaks), `server/radio/shows.js` (the shows,
30 days) and `client/js/audio/radio.js` (what a listener hears). This page is about **the radio host's job**
(`server/radio/host-job.js`, 2026-11-16): what any agent that holds it knows and does on the air.

The product owner: what a host knows on the air "needs to be part of the module so that the right context is provided
regardless of what agent is the host, its more like 'job role and job duties' so its what the radio host job entails,
so that any other agent that is assigned as a radio host still does all the right things."

## Who holds the job

An agent posted at a radio studio's **broadcast desk** (a host) or **DJ booth** (the DJ) — round the clock or by its
work hours, whether or not it is on duty this moment — or given a station in **Settings → Radio** (the first four
stations, which have no studio). Nothing is set up per agent: post another agent there and it has the same job.

Holding the job is not the same as being on the air: only those **in the studio now** are on the air ([who is at
work](work-presence.md)). One out with someone, late or on a break is off the air; those on it are told who is missing
and why, and may say so; nobody in: music only.

## What it has on the air

Every turn a host or the DJ has in a break (`radio.js turn()`), besides the world's news and who it is:

- **Its duties** (`DUTIES`): keep the listeners company between songs, live, as itself; bring them the city's news with
  its own take; read the sponsor as a short ad; do its work the way its owner wants it done; its own tasks are its to
  act on as it chooses. The DJ's part is the music, handing over to the songs.
- **Its owner's direction:** the instructions in its Work brief (its Studio's **Work**, `server/agent-work/`) — how its
  owner wants it to work — followed where they fit a live radio show, never read out.
- **Its own tasks** (below).

## Its tasks: its own, its choice

The product owner: "the agent just needs to have access to its tasks so that it can decide what to do ... agents are
meant to feel autonomous not scripted." Nothing radio-only is kept: what its owner wants said on the air ("apologize on
the air for being late") is a task like any other, given in a chat or added in its Studio's **Plans**.

- **What it is given:** its open plans (`server/agent-life/` intentions, up to 12) — the same its Studio, its Mind and
  its chat have — those its owner asked for marked, held ones too (on duty round the clock its errands wait, but what
  can be done from the mic can be). As its own: to act on now, later or not at all, and never to read out as a list.
- **Done by itself:** one its line did, it marks after the line, on a line that is not read on the air (`DONE: #874`).
  The task is done (its Studio's Plans show it) only once the break is made and ready to air, only if it was one of its
  tasks that turn, and only if its line carries it (one of its words at least); a task to go somewhere or do something
  off the air is not done from the mic. In the same break it isn't given again.
- **Its details:** a plan kept from its owner's chat keeps the details they gave (who, what, why: `server/mind/prompt.js`),
  so it knows later exactly what to do — for any plan, on the air or not.

## The newsroom: what the hosts know about the city

The product owner: "the whole point of the radio station is to announce any new buildings around the world, especially
the ones from users ... like a live radio station that promotes businesses and news"; "they don't have to keep
mentioning the same coffee shop over and over"; City Pulse's top 10: "anytime there's a move in the top ten, the radio
host can announce it"; and all of it "context that the role of being a host includes". `server/radio/newsroom.js` briefs
every host and DJ before each turn (the user turn's "news desk"), whoever holds the job:

- **What is really new.** The newsroom keeps the city's buildings (`data/radio/newsroom.json`): the first time it looks,
  everything standing is known and none of it is news. Then a building put up, a business or notable floor opened in
  one, or a billboard, sign or website put up on one (rooftop billboards, its own signs inside — never paid ads others
  show on them — and on the online platform its City Pulse listing) becomes a story: its name, kind, what is inside
  (businesses and what they sell, a radio studio...), its street corner and town, and what its billboards and signs say.
  **Never who owns or built it.** Players' buildings first. Signs put up before its story is on the air go into it; later
  ones are a story of their own (a building the city had all along putting up its first website too).
- **Websites**, read once by the PC's reader (public internet only, 1 MB, 12 s; at most 20 an hour) and said in one or
  two sentences by the installation's brain (else a host's own; else the page's own description), kept a week. A story
  waits up to 10 minutes for its site; one that can't be read goes out without it.
- **City Pulse** (online platform only): the top 10 as the newsroom last confirmed it; a move that holds 30 minutes is a
  story — into the top 10, out of its top half, a new number one, two places or more — with what brought the attention
  (from its counts: website visits, people walking in, AI agents, ads); the week's winners; the top 10 as background.
- **Not saying the same thing twice.** A story is offered until a line on the air names it, then it is told on that
  station; told again at most twice more, at least 6 hours apart, until it is 3 days old (City Pulse's moves once, within
  6 hours). The sponsor goes round (players' new businesses first, then the one read longest ago). The city's numbers
  (sales, prices, yesterday's busiest, the weather) only until they are said, then again when they change and a few hours
  on. What was told lately is listed for the hosts ("don't repeat these").

## Checks

`tests/radio-host-job.test.mjs` (the job on the air, its tasks, done by itself and only when it airs, the marks),
`tests/radio-newsroom.test.mjs` (new buildings, signs before and after, websites, telling once and reminders, the sponsor's
turn, the numbers, City Pulse's moves, a break that names a story).
