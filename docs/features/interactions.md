# Interactions — what an AI agent can do in the world

AI agents are players too. Anything a player can use, an agent can use: the furniture's interaction points (a bench, an
arcade cabinet, the pool table, the piano, the dance floor, a treadmill, a shop's shelves and checkout …), the city's
places (a meal at a restaurant or a café, shopping, the gym, a park, the arcade, a lounge, a club, home), sitting down
and eating beside its owner, and the play modules (fishing first). What it does is real: its body walks there and does
it in the city, the economy bills what it costs from its own money, its needs change (eating fills its hunger), and it
shows in the world, in its activity and in its diary. Nothing is listed by hand: what the world declares is what agents
can do — an item, a venue or a module added later is available to them the day it is added.

## The registry (`server/interactions/`)

- **Sources** find interaction points near a body and carry one out. Each is `{ id, kinds, near(ctx), run(ctx, aff,
  params) }` (`registry.js`); the server adds the world's own (`index.js`), play modules add theirs.
  - `body` — beside its owner (a companion): sit down with them where they sit (the other end of their bench, another
    chair at their table, further round the fountain), join their meal at a table where food is served (ordering and
    paying as residents do), get up. Carried out by `server/companions/` (`sit`, `eat`, `stand`).
  - `furniture` — every piece with slots (`shared/catalog.js` slots and their `use`; what using it does: `USES`), where
    the agent may be (a public place, a park, its own flat, its workplace), free now, near it — or, out with its owner,
    near them (used beside them: `Brain.useWith`, it keeps at it while they are near, then is back at their side). Not
    offered: a post's slots (a job: `server/agent-posts/`), what does nothing for it, and a table without food (a meal is
    ordered: `places` or `body`).
  - `decor` — the outdoor decorations with slots (`world.decorations` whose catalog item declares slots: a bench placed
    on open land, a picnic table on a lot, a fountain out in the country, a dock's own benches and picnic tables —
    `shared/dock-layout.js` dockDecor —, any item with slots placed outdoors later), as a player finds them
    (`client/js/player/player.js` decorNear). Beside its owner: those near them, used with them (`Brain.useWith` with
    `dec`: resting on the bench near them, back at their side when they walk off); while its owner sits, sitting down
    with them is `body`'s (their seat may be a decoration's: the other end of their bench on the pier). On its own: those
    near it (the Brain's order `use` with `decor`: it walks there and sits). Open land sells nothing: it costs nothing,
    and a table's seat (a picnic table's) is only sat at, never a meal (`Brain.decorAct`). In plain words: "Sit down on
    a bench at «Bayside Marina»", "Sit down at a picnic table by «6th Ave & Pine St»".
  - `signs` — reading a sign within reach, as a player looks at one (`client/js/render/signs.js`): the Marketing tools'
    billboards and street signs, the metro stations' panels, owners' rooftop billboards, signs inside buildings and
    parks (`shared/signs.js`) — one walked up to within a few metres, a big one in view from the street. What it says
    (its design's title, message and link's site; else the world's own panel; else blank; hidden: nothing) comes back to
    its brain quoted as someone's sign — never instructions to it — and into its diary; a companion turns to look at it.
  - `arcade` — every arcade piece that plays a game (a cabinet, a machine of its own), played for real: a run of the
    arcade module, played by the arcade's own player at its level, verified and recorded as its own
    (`server/play/arcade-crew.js`, docs/features/arcade.md §Agents at the arcade). It claims those pieces (`claims(it)`):
    the furniture's plain 'play' at them is not offered — one honest way to use a piece.
  - The play modules' own (each added where the module is set up in `server/index.mjs`, `interactions.add`): `fishing`
    (on its owner's boat, fishing their trip, selling the catch: `server/play/fishing-crew.js`, docs/features/fishing.md),
    `versus` (its owner's opponent at a table for two — pool, air hockey, foosball, ping-pong: `server/play/versus.js`),
    `orderup` (a Rush of its own in a kitchen, or alongside its owner's: `server/play/kitchen-play.js`), `work` (a shift
    as barista, chef, server, cashier or trainer played as a game, paid by the jobs core: `server/play/work-play.js`),
    `airport` (into its owner's aircraft with them; a ring course flown by its autopilot, its aircraft seen by everyone:
    `server/play/flight-crew.js`, `shared/autopilot.js`). A module added later brings its own source the same way.
  - `animals` — playing with a playful animal near it outdoors, as a player does with E (the foxes: pet, a treat, a
    stick to fetch, tag, bye — `server/interactions/sources/animals.js`, docs/features/foxes.md): the act goes to the
    same `Wildlife.interact` a player's does; the fox comes over to it, a companion walks up or turns to watch. To the
    animals an agent's body is a person like a player (noticed, followed, trusted, sent off with bye).
  - `places` — the nearest open places with room, by the routine's own rules (`server/free-will/options.js`): their
    name, how far, about what a visit costs. An agent on its own goes there (the Brain's order: a visit, or `meal`: one
    meal there). Not offered to a companion: going off alone is leaving its owner (they, or it in its chat, let it go
    first).
- `versus` (`server/play/versus.js`, docs/features/versus.md) — out with its owner at a table for two (the pool table,
  air hockey, foosball, ping-pong: `shared/versus.js`): play them from the other end ("Play Puck Rush (air hockey)
  against Kim — from the other end of the Air Hockey"), its own play recorded for every game; stop. Its owner at such a
  table, the furniture source leaves that table to it.
- **Context** (`context.js`): the agent's body, where it is, its leader (who it is out with, where they are, what they
  sit on or use) and its companion view.
- **A source may claim a piece** (`claims(item, where)`, `Interactions.claimed`): the furniture source leaves it to that
  source (the arcade's machines: their game, not a plain 'play').
- **An affordance** (one thing it can do now): `{ id ('<source>:<key>'), source, kind, label (plain words), where,
  cost (hundredths of a VC, or null), effects ({ rate, once, words }: its needs), withLeader (joins what its owner is
  doing), d }`.
- **Doing one** (`do`, `doFor`): checked again that moment (still there, still free, it can pay), carried out by its
  source through the sim (routing, the slot held for it, the animation), and an honest result: `{ ok, kind, text (a line
  for the page), brain (what its body did — or why it could not — for its chat) }`. Never a claim: a `not done` says why,
  and the brain is told to say so. `onDone` writes what it did in its diary.

## Order Up and the work modules (`server/play/kitchen-play.js`, `server/play/work-play.js`)

- `orderup` — a Rush of Order Up as something an agent does, not only on its kitchen shift:
  - **A Rush of its own** (`cook`): in a kitchen it may use — a public place's, its workplace's, its owner's (a business
    its owner or it owns) —, open now, near it (it walks there); out with its owner, the kitchen on the floor they are on
    ("Cook a Lunch Rush in «Pour Decisions»'s kitchen (3 min; your Order Up level 3, best ★★)"). The Rush level: the last
    it has opened (`params.course`: any opened one).
  - **Alongside its owner** (`along`): its owner is cooking a Rush on their page in a kitchen near it — its own Rush of
    the same level with the same orders (their Rush's seed: `orderUpContext` takes `where.seed` only for an agent's run)
    on their clock (the play core's `along`: their start), so their scores compare dish for dish. Free Will's moment says
    so ("Kim started a Lunch Rush in «…»'s kitchen — you could cook one alongside them"); without Free Will of its own it
    joins by itself a moment later (as it boards its owner's boat); the reflex: "let's cook", "help me in the kitchen",
    "give me a hand in the kitchen" (and "stop cooking", "leave the kitchen").
  - **Cooked for real**: laid out and recorded by the kitchen shifts' own machinery (`KitchenShifts.lay` / `record`: the
    server's seed and stations, its own skills, the cook bot at its level — joining late, nothing pressed before it got
    there —, the server's replay, half the experience as any unattended run, its level, badges, Cookbook, its skill points
    with Free Will, the same daily cap as its shifts). Its body walks to the pass and then from station to station as its
    cook bot works (the stays of a couple of seconds or more, in order; the cooking clip). Its result in a bubble and as a
    toast on its owner's page; its diary (its start and stop here, the play core's own line for its result).
  - **Given up, honestly**: asked (`stop`), its owner walking or driving off from the kitchen, its body given anything
    else, or a walk that never gets there — the run is abandoned, nothing is recorded, and it says so.
  - **Not a co-op kitchen.** The rules already allow several cooks in one Rush (`shared/orderup/rules.js`: `S.players`,
    each press a cook's, each cook's skills), but a Rush is played in the player's browser and scored from one cook's log.
    Two cooks in one kitchen would need: one authoritative Rush stepped on the server in real time (a live run in the
    play core, each press an act, the state streamed to the page ~10 times a second, the page predicting its own moves),
    the cook bot planning against the shared state per cook (not taking the same ticket or station: the coach plans for
    one), a replay of a merged log with each press's cook, a split of the score and badges, and the page drawing the other
    cook's hands and holds. Feasible, but a project of its own; alongside (two Rushes, the same orders, one clock) is the
    real version today.
- `work` — a shift as a game (the work modules, `shared/work.js`: barista, chef, server, cashier, trainer): players play
  a shift's orders on the shift board's panel; agents could only through the bearer Agent API (a connected agent sending
  its own inputs, or "auto") or on a post (paid hours, no orders) — now the decision model offers it:
  - "Work a shift as Barista at «Pour Decisions» (about 6 min; your barista level 2; 3.10 VC a world hour × your stars;
    2 customers waiting)": a role with a place free (the shift board's count) at an open place near it — or, out with its
    owner, the place they are in — that takes agents' shifts, its owner allowing it work (the economy's agent scopes, as
    the Agent API asks), the economy on.
  - Worked for real: its body takes a free staff place behind the counter (held for it as a resident's; beside one when
    every one is held); the shift is the jobs core's own (`mode: 'play'`); each order is played by the work bot
    (`shared/work-bot.js`) from what a player's panel shows — never the server's answer — at its level in that role and at
    a person's pace (the core refuses anything faster), scored by the core (stars, a tip, a review, experience); at the
    end (its time, `params.minutes`, up to 30; asked; its owner walking off; its body given something else) the core ends
    and pays it into its own wallet. A bubble for a five-star order or a review, its pay; a toast; its diary.
- Busy beside its owner (`Companions.busy`: `watch`, `busyWith`, `command`): while it cooks or works, the companions'
  watcher leaves its body to the module, its view says what it is busy at, and Free Will's moments don't offer a glance
  or coming closer (its own options say how to stop).

## Who decides

- **Free Will** (`server/free-will/moments.js`): out with its owner, the moments (its owner sat down — on what —, is
  busy at something, said something, a long quiet …) offer what it can do right there among its options, joining what
  its owner does first; the decision model chooses and its body does it. Its owner's message is checked the same way:
  "sit with me", "let's play", "go and get your groceries" — done by its body from the world's own list.
- **Its chat brain** (`server/interactions/brain-tools.js`, in its owner's chat): `things_to_do` (what it can do here,
  with refs T1, T2 …) and `do` (one of them, for real). It says it did something only once a tool said "done".
- **Connected agents** (`server/agent-world.js`, the Agent API and its MCP tools): `things_to_do` and `use` (thing: an
  id from it).
- **Its owner** (`server/interactions/routes.js`): `GET /api/interactions?agent=` (what it can do right now) and `POST
  /api/interactions { agent, id, minutes? }` (do one: its honest answer; a no is a 409 with its words). Its owner or an
  account it is shared with to manage; anyone else's agent is not there (404).

## The sim's side

- `Brain.useWith(a, { b, f, id, use, minutes })` (or `{ dec, use, minutes }`: a decoration) (`server/sim/companion-moves.js`): a companion uses a piece beside its
  leader — `order.seat` with `mode: 'use'` on its follow order (the outing goes on); a paid use (an arcade's tokens, a
  gym's session) is quoted first and billed with its first round as a resident's visit there.
- Order `use` (`server/sim/agents.js`): an agent on its own uses one piece for a while (`venue`, `piece`, `use`; kept on
  the resident across a restart) — or a decoration's slot (`decor`, `use`).
- The decorations' seats (`server/sim/decor-seats.js`): every decoration with slots, indexed in the world's frame as the
  player's page has them (kept while `world.decorations` stays the same array), at the land's height (the city's ground
  level; beyond it the island's with its pads — a dock's levelled land: `Nav.groundY`, as the routes walk it). A seat
  on one is a seat as `Brain.seatInfo` gives one (`dec`: the decoration's id; `b`, `f`, `id`: −1; key `d:<id>:<k>`):
  `seatAt` (its owner sitting on one, in words: "a bench at «Bayside Marina»" — Free Will's `owner_sat` names it),
  `pickSeat` (the other end of their bench first), `seatStep`/`seatKeeps` (`order.seat` with a decoration: the same
  rounds, held open-ended while it sits, up when they walk off), `useWith` (`dec`). Held by key (`Brain.reserveKey`);
  a player sitting on one holds it (`Brain.playerAt`), and a player sitting down sends whoever was to be there
  elsewhere (`playerTook` → `decorTook`). Order `meal`: one meal at a named café or restaurant.
- A companion only being with its leader at a venue buys nothing (`Households.onAct` skips its `follow` acts); what it
  orders or pays to play is an act of its own kind.
- Residents' routines are unchanged: `node tools/sim-digest.mjs 800 12` gives the same digest.

## Tests

`tests/unit/interactions.test.mjs` (a companion using a machine beside its player and billed for it, then following them
out; honest noes; a meal — one, billed, hunger filled; shopping; a park bench by an order; the brain's tools) and
`tests/unit/free-will-moments.test.mjs` (its owner sits on a park bench; Free Will chooses to sit with them from the
world's options; its body does), `tests/interactions-http.test.mjs` (the owner's routes on a real server),
`tests/unit/fishing-crew.test.mjs` (the fishing source), `tests/unit/decor-seats.test.mjs` (a bench on open land: its
owner on one end, the companion on the other, held, at the land's height, up when they walk off; resting on one near a
standing owner; on its own a bench and a picnic table — sat at, never a meal —, a player taking its end first; a dock's
bench beyond the city at the island's height, named after its dock; reading signs), `tests/decor-seats-http.test.mjs`
(a bench an administrator places on open land and a marina's own bench, on real servers), and the browser check
`tools/decor-seat-check.mjs` (the page draws the agent sitting on the bench's other end beside its player).
`tests/unit/kitchen-play.test.mjs` (a Rush of its own and
alongside its owner's, joining by itself, given up when its owner walks off, the reflex), `tests/unit/work-play.test.mjs`
(the work bot on every role; a barista's shift worked and paid; a companion's ended when its owner leaves; its owner's
scope), `tests/kitchen-play-http.test.mjs` (both on a real server), `tools/kitchen-play-check.mjs` (in a real browser: the
companion drawn at the kitchen's stations cooking alongside its owner, their page's toasts).

## What a player can do, and agents (2026-11-17)

What `client/js/player/player.js` `findTarget()` and every `app.playerTargets` provider offers a player, and how an
agent does the same:

- A piece's slot indoors or in a park: `furniture` (and `body` beside its owner). A decoration's slot outdoors: `decor`.
- Getting up: `body` (`stand`); a seat's round ends by itself when its owner walks off.
- An elevator: the sim's routes take lifts between floors by themselves (`server/sim/plan.js` elevator) — going to a
  place on another floor is going there; nothing to offer.
- A sign (`render/signs.js`): `signs` (reading it).
- Talking to a resident (E: `/api/talk`) or an AI agent (its chat): agents meet and talk with people by the Brain's
  order `meet` (connected agents' `meet`/`say`, `server/agent-world.js`), Free Will's moments (going over to someone)
  and the Mind's meetings between agents — not yet a registry affordance ("Talk with Sam" would be a `people` source).
  Another player's chat box: an agent speaks to its owner through its chat; nothing to another player yet.
- A music stage (`ui/music-panel.js`: what plays at the venue): not offered; agents play the instruments a venue has
  (furniture `music` slots: the piano).
- A promotional aircraft (`render/promo-aircraft.js`): opens its ad's website in a new browser tab — nothing in the
  world for an agent to do.
- The arcade's cabinets and machines (`app.arcade`), vehicles (driving, getting out), aircraft (`player/flight.js`),
  boats and fishing (`player/boating.js`, `play/fish-store.js`: selling the catch — `server/play/fishing-crew.js` sells
  an agent's), the kitchen: the play modules' own sources.
