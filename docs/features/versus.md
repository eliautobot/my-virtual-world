# Versus — an AI agent as its owner's opponent at the tables for two

The tables played by two — the pool table, air hockey, foosball, the ping-pong table, and any piece added later that the
catalog declares the same way — can be played against one of your own AI agents instead of the computer. Your companion
takes the other end, is seen there playing, plays the computer's side of the game with a hand of its own, and every game
counts for both of you (2026-11-17, the product owner: "Today the player plays the CPU … I want to play with my AI agents").

## Which tables (`shared/versus.js` `versusOf`)

- A machine whose game is two-sided (`shared/arcade/catalog.js` `cpu: true`; `you`: the way to the player's end in the
  piece's frame, where the game's camera is; `count`: what a side's tally counts, 'goals' or 'balls'): Pool Shark at the
  billiards table, Puck Rush at the air hockey table, Foos Frenzy at the foosball table.
- A piece with exactly two places for one pastime done together (its use: fun and company, not sitting or eating
  together), facing each other across it: the ping-pong table. It has no game of its own: they simply play.
- The other player's end: a game's far end (opposite `you`), else the end away from its player (`farSlot`).

## How a companion comes to play (`server/play/versus.js`)

- **Its owner steps up to a table** — their game opened there (the game's page: `POST /api/versus/table`), or at one of
  its ends in Player mode (`tick`: the player using a place of it). A companion with them is asked: one whose Free Will
  decides is offered the moment (`owner_game`, `server/free-will/moments.js`: its decision model chooses among what the
  interaction registry has for it there — "Play Puck Rush (air hockey) against Kim — from the other end of the Air
  Hockey" first); one without it simply joins in. The game waits while it decides and walks over, saying so, and can be
  played against the computer at once ("Play the computer"); a no is said ("Kai chose to … instead: you play the
  computer"). Once a table while its owner stays at it.
- **Its owner asks** — "let's play pool", "play air hockey with me", "fancy a game of foosball", "play with me", "let's
  play" (the reflex, `server/companions/intent.js` 'versus'; "let's play" with no table for two near is left to its brain),
  "stop playing" ('unversus'). At a table, or the nearest free one near them (the game asked for, by the catalog's own
  words): it goes to the far end and waits for them there.
- **Its chat brain / connected agents** — the registry's `versus` source (`versus:<b>.<f>.<id>`, `versus:stop`), as any
  other thing to do.

## At the other end

- Its body walks there and plays with the slot's own clip and gear (the cue, the striker, the paddle):
  `Brain.useWith(a, { …, k })` on its follow order — the outing goes on —, billed as any use there (an arcade's tokens,
  from its own money). While its owner's game holds the whole table (`server/play/arcade-hold.js`), it is the table's
  guest (`Brain.pieceGuest`: held for it, never sent away by the hold, nobody else takes that end).
- It stays while its owner plays there (their game open, a run against it in flight, or at an end), its place kept ahead;
  when they leave the table it is back at their side (a few seconds later).

## The game against it

- Its hand: `handFor(level, stars)` — its arcade level and its stars at that game, 50 (the computer's own hand, exactly)
  to 95. Never weaker than the computer: a game against an agent is never an easier score than one against the
  computer, so its owner's scores, the board and the prizes stay fair.
- The run is laid out with it: `POST /api/play/start { where: { b, f, id } }` → the arcade module's `prepare` gets
  `ctx.vs` from the match (`Versus.context`) → `data.vs = { agent, name, emoji, k, level, game }`. The page plays the sim
  with that hand (`sim.init(seed, data.vs)`: `shared/arcade/core.js` `handOf` — its speed and its aim, × the computer's);
  the server's check plays the very same game again (`replay(…, data.vs)`).
- On the page (`client/js/play/machine-play.js`, the machines' views): "vs 🦊 Kai" in the bar, its name for the computer's
  ("Kai scores!", "Kai's shot", "KAI WINS", the machine's LED panel), its side on the results card.

## The result, for both

- Its owner's run: as ever (score, stars, experience, the board, prizes).
- Its own: the play core's `finish` event (with the page's report) → a run of its own of the same course,
  `PlayCore.start(-agent, …, { auto: true, side: ownerRun })` — the owner's run's data with `side: −1`, its clock —
  finished with the owner's log: the module plays the game again and scores the other side (`verifyArcade` → the sim's
  `other()`: its score by the same rules, its counts). Recorded as its own: score, half the experience as any unattended
  run, its arcade level and badges by the platform's rules; no prize (an agent's play is never paid).
- Said: "Good game! 3–2 to you" in a bubble over it (`goodGame`), on its owner's results card with its points and
  experience, a line in its diary ("Lost to Kim at Puck Rush: 3–2, 540 pts for your side") and near its owner; after a
  win, a shutout or a best, now and then a word of its own (its Mind's `remark`, within its limits, after the bubble).
- When the match ends: "Played Puck Rush (air hockey) against Kim at the Air Hockey (3 games: 1 won, 2 lost)" in its
  diary; ping-pong: "Good game, Kim!" and how long they played.

## Not yet

- **Agent against agent** (two companions at a table while their owner watches): ping-pong falls out already (each uses
  an end beside its owner: the furniture source). For the games it needs a hand for the player's side of each sim (the
  arcade's look-ahead player), a match the server plays out (both runs recorded when it is over: the sims are
  deterministic, so the seed, both hands and that player's bot are the whole game) and a way for the owner's page to
  watch it (the machine's game played on the page from that same seed and hands, without input).
- The body at the other end plays its slot's own clip; on its owner's screen the game's own striker/cue for its side is
  the one that plays (its hand's gear is drawn too).

## Tests

`tests/unit/versus.test.mjs` (the tables from the catalog, the far end, the hand — 50 plays the computer's very game —,
the other side's score checked from the same log, the words, the reflex; in a living city with a real play core: the air
hockey table — the other end taken while the owner's game holds the table, drawn there playing, the game laid out with
its hand, the result recorded for both, back at its owner's side —; Free Will asked, an honest no; "let's play pool";
ping-pong), `tests/versus-http.test.mjs` (a real server: the routes, the companion at the other end, the run's
`data.vs`), `tools/versus-check.mjs` (a real browser: the owner plays air hockey against their agent).
