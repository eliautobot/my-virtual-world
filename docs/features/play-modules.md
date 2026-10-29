# Play modules

Modules are the fun in the world. A module is a minigame or a game mechanic: a whole building (an airport, a race
track, a fishing port) or something inside one (a kitchen, an arcade cabinet). Every module plugs into one shared
system for **levels, ranks, badges and leaderboards**, shown on each player's **profile**. Adding a module needs no
changes to that system.

They are not the same as work modules (`shared/work.js`, [economy](economy.md)). Those are paid jobs at venues; play
modules are for fun and reputation.

## How it is built

| Part | File | What it does |
|---|---|---|
| Registry | `shared/play.js` | `registerPlay(def)`: courses (levels), score kind, `prepare`, `verify`, `xp`, badges. It also holds the level curves, ranks, badge tiers and platform badges. |
| Core | `server/play/play.js` | Runs (start → finish), experience, module and player levels, best results, places, badges, profiles. The same for every module. |
| Routes | `server/play/routes.js` | `GET /api/play`, `/api/play/leaderboard`, `/api/play/top`, `GET/POST /api/play/profile`, `POST /api/play/start`, `/act`, `/finish`, `/abandon` (capability `play.use`). |
| Profile | `client/js/ui/profile.js` | The player's page: rank, level, XP, pinned badges, bio, badges, modules, recent runs, leaderboards. Opened from the account menu, the online list and friends; `app.profile.open(id)` and `app.profile.board(module, course)` open it from anywhere. |
| Data | schema 47 | `play_progress`, `play_best`, `play_runs`, `play_badges`, `player_profiles` |

**Trust.** The browser never sends a score. It reports what happened (for the airport, the flight path), and the
module's `verify()` works the score out on the server: ring passes, order, speed limits, and the server's own clock.

**Progression.**
- A module's courses open in order: the next course needs at least 1★ on the one before.
- Experience is `10 × difficulty × stars`. A repeat without a new best earns a third of that; a 0★ finish earns a quarter.
- Module level comes from that module's experience: `1 + √(xp/60)`.
- Player level comes from all play experience together: `1 + √(xp/100)`.
- Ranks follow the player level: Rookie, Bronze 5, Silver 10, Gold 15, Platinum 25, Diamond 40, Legend 60.
- Badges have a tier (bronze, silver, gold or platinum) and a `when(stats, run)` rule. They are checked after every run.
- A player pins up to three earned badges to the profile.

## Placing modules: world modules and interior modules

| | World modules | Interior modules |
|---|---|---|
| What | Big modules that take up world space: an airport, the fishing docks (a marina, a lake dock: [fishing](fishing.md)), a race track later | Things inside a building: a kitchen, an arcade, a bar |
| Who places them | Administrators only | Per kind: owners on their own floors (a kitchen) or administrators (a radio studio) |
| Where | Edit dock → 🌍 World modules | Buildings section (furnishing) |
| Cost | None (the world's own) | Per kind: free (the radio studio; kitchens for now) or Virtual Coin later (owning modules is progression of its own, next to ranks, levels and prizes) |
| Registry | `registerPlay({ placement: 'world' })` plus a kind in `shared/world-modules.js` | a kind in `shared/interior-modules.js` (`registerInteriorKind`, imported by `shared/interior-kinds.js`), pointing at its play module when it has a game |

**A world module** is `{ id, kind, name, x, z, rot, y }` in `world.worldModules`, edited with the `wmod.add`, `wmod.set`
and `wmod.del` ops.
- **Rights and undo:** administrators only (lot rights refuse any op they don't name), and every edit can be undone.
- **Live updates:** every change goes to all browsers as a `{k:'wmods'}` patch.
- **Where it may go:**
  - beyond the city, on dry and fairly flat land;
  - clear of roads, buildings, stations, decorations, other modules and lots;
  - with a road within 1.5 km.
- **Access road:** the tool builds one from the module's car park to the nearest road. The module and its road go in
  together or not at all (`atomic`).
- **Its land stays its own:**
  - Its pad levels the ground under it (`buildingPads`).
  - No road crosses it; only its access road meets its edge, at the car park.
  - Nothing else is built on it.
- **Solid parts:** its buildings are walls for walkers (browser and server) and solid for cars.
- **Roofs:** `shared/roofs.js` builds a box for every building's roof and every module structure. Helicopters land on
  these, and the airport's rings stay clear of them.
- **Airport layout** (`shared/airport-layout.js`):
  - a 720 × 30 m runway, a taxiway with three links, and the apron;
  - stands for 3 propeller planes, 3 small jets and 4 helicopters on helipads;
  - the terminal (the "station", joined to the road through the car park), the control tower and a hangar.
- **A run** starts at the airport the player is at (within 2.5 km).

**An interior module** (2026-10-27; the product owner: "the 'modules' system should work the same for all type of
inside spaces that will have unique playable or unique functions") is a room with a purpose laid on a floor as one
unit: a record `{ id, kind, name, x0, z0, x1, z1, face, data }` in its floor's layout (`L.mods`, the building's own
frame; `face` is the side its door is on: 0 +z, 1 +x, 2 −z, 3 −x), edited with the `imod.add`, `imod.set` (move,
resize, turn, rename) and `imod.del` ops (`server/world/edit.js imodOp`).
- **What it lays:** its own walls (the sides not along the building's outer walls, a doorway on its face side) and its
  pieces, laid by its kind's `fill`; each tagged with its id (an item's `it.mod`, a wall's sixth element), so a move,
  a resize or a removal takes exactly its own away and lays them again. Furniture that isn't its own is never
  swallowed: it has to be moved first.
- **Rights and undo:** the edit route's lot rights name the ops as furnishing; a kind with `who: 'admin'` is for
  administrators only; a priced kind is bought first (the buy-and-place flow comes with the first priced kind). The
  floor's whole layout is kept for undo (`lv:<lv>`), so one undo brings a module back whole.
- **Where it may go** (`checkModule`, the same in the browser's ghost and on the server): where its kind allows
  (`allowed(B, f, L)`), inside the floor, at its kind's sizes (free within min..max on a step, or snapped to a list),
  at most `perFloor` of its kind, not over another module, the entrance, the elevator, a wall or furniture; and the
  floor must stay walkable (`levelConnected`).
- **A kind** (`registerInteriorKind`): `kind, label, icon, blurb, who, price, play (a play module id or null), size,
  perFloor, wall, allowed(B, f, L), fill(B, f, L, rec)`, and optionally `check(B, f, L, rec)` (its own rule for a
  record), `locked` (its pieces change only with it) and `joins(t)` (a piece of type t placed or moved inside it
  becomes its own); `size.start` is the ghost's first size. A client asks a floor's records what runs there
  (`modsAt`), never a marker piece.
- **Arranged by hand:** moving or removing a module's own pieces, or a piece joining it, marks its record `custom`.
  A module's pieces stay inside it. Moving a custom module carries its pieces, walls and floor along as they are
  (`shiftModule`); a rename never lays it out again; a resize or a turn of a custom module is refused with code
  `custom` unless the op says `reset: true` (the Furniture panel's tool asks first: "your arrangement is lost"), and
  the tool's ↺ Lay out again does the same at its size. Sending its own size with a move never snaps it.
- **Kinds:** the Radio Studio (`shared/radio-studio.js`; administrators, free, 3.5 × 3 to 12 × 9 m, six a floor, only in
  a Radio Station's studio building): each one is a station of MVW Radio (`server/radio/radio.js syncStudios` puts it
  on the air, and takes its station off when it goes).
- **The Kitchen** (`shared/kitchen-module.js`; owners on their own floors, administrators anywhere, free for now, one a
  floor): where Order Up is played. Only where food or drink is served (`shared/edit.js kitchenFloor`: cafés, restaurants, lounges, night clubs, arcades; not offices,
  flats, shops, gyms, parks or the airport). Any size from 4.4 × 4 to 16 × 12 m on half-metre steps, the room plus a
  0.4 m strip in front for the pass (named: Small 4.5 × 4, Medium 6.5 × 4, Large 8.5 × 5, Extra large 12 × 8); a
  bigger kitchen fits more stations, so a longer menu (the café's: Small espresso and latte, Medium a croissant too,
  Large all five), then more of them for more cooks at once (the template's `more`, round after round; islands 1.9 m
  apart in a deep one: an Extra large café kitchen has 35 stations). Its stations move as you like and an appliance
  placed inside joins it (`joins`: Order Up's pieces); the chef starts just inside the hatch. It lays its own walls (`wall: false`): the front, on its face side, has the
  door at the inner end and the hatch the pass stands in. Its stations are its template's (`shared/orderup/kitchens.js`,
  `rec.data.kitchen`: the café's coffee kitchen for now), each in the first row of its liking with room. A Café floor
  gets one laid with it (`server/world/layouts.js cafeKitchen`), a record like a placed one. The page plays the
  floor's kitchen record's pieces (`client/js/play/order-up.js kitchenHere`); a floor laid before kitchens were
  modules still plays its own Order Up pieces.

The arcade ([arcade](arcade.md)) came first, before this layer: its cabinets are furniture, and each of its games is a
course with verified scores.

## Prizes in Virtual Coin

Modules are a fun way for players to earn VC. Every finished run pays a prize, and harder courses (more waves, a
higher level) pay more. Prizes are paid from the economy's **Game prizes** faucet; the ledger entry kind is `prize`,
and the wallet filters it under "Prizes".

| Part of the prize | Amount (defaults; one unit = `play.base` 3 VC × the course's difficulty) |
|---|---|
| The run | 0★ 0.3 · 1★ 1 · 2★ 1.6 · 3★ 2.5 units. A repeat without a new best pays 40% of that. |
| First-time stars | 1 unit for each star won on that course for the first time |
| New record | 1.5 units for taking first place with 2★ or better |
| Daily cap | 400 VC a player per 24 hours. Past the cap the run still counts but pays nothing. |

- On the airport, a first three-star record pays 21 VC on First Flight and 210 VC on Ace Gauntlet. Repeats pay 3 to
  30 VC.
- A module may weigh its own courses with `prizeWeight(course)`; the default is the course's difficulty.
- Admins set every number in Settings → Economy → 🎮 Game prizes (policy `play`). A base of 0 turns prizes off.
- No economy, a paused economy, or a refused payment: the run still counts and nothing is paid.
- Each run pays at most once (`idem play:<run id>`). What it paid is stored with the run (`play_runs.vc`).
- The profile shows total winnings, the most each course pays, and the VC from recent runs.
- `GET /api/play/winnings` returns today's winnings and the daily cap.

## Performance (online: many players at once)

Modules must not slow the world for anyone, including people who aren't playing.
- **Server:** no per-frame work. A run costs two requests, start and finish. Every query is an index lookup; there are no
  scans per request. Top players is cached.
- **Flight:** aircraft fly in the player's own browser, like cars do (decision A20). The server only checks the poses it
  receives and the finished path. Other players' aircraft come over the existing vehicle stream, which only sends
  what is nearby.
- **Drawing:**
  - Models are low-poly, built in code, and share geometry and materials.
  - The 10 parked aircraft are static, drawn as instanced meshes until someone boards one.
  - A course's rings are a single instanced mesh, shown only to the player flying it.
  - Distant detail is reduced (LOD); there are no new lights or shadow casters.
- **Roof colliders:** one box per building, built when the building changes and kept in the existing spatial hash. They
  add no per-frame cost.
- **Proof:** every step is measured on the low-quality setting (`?q=low`) and checked for frame rate and draw calls,
  with flight compared against driving.

## Adding a module

1. Call `registerPlay({ id, version, label, icon, blurb, venue, score, courses, prepare?, verify, xp?, badges })` in a
   shared file, and import that file from `server/play/play.js`.
2. If the run depends on where it is played, add the module's context to `playContext()` in `server/index.mjs`.
3. Build the browser game. It calls `POST /api/play/start`, plays, then `POST /api/play/finish` with the raw report,
   and shows the result: stars, new best, place, XP, level-ups and new badges.
4. A module that plays out over a while and must decide things itself while it runs (the fishing module: what bites)
   gives `init(course, data, ctx)` → its state, kept with the run on the server and never sent, and `act(name, body,
   { course, data, state, secret, serverMs })` for its moves (`POST /api/play/act { run, act, body }`; answer
   `{ error, status }` to refuse). `secret` seeds its own dice. `verify()` gets the state too.

## The airport (first module)

`shared/airport.js` and `shared/aircraft-specs.js` hold 10 ring courses, each for one aircraft class:
- First Flight, Coastline Cruise, Island Loop and Ace Gauntlet: propeller plane.
- Hover Hop, City Hop and Rooftop Rally: helicopter.
- Jet Familiarisation, Mountain Pass and Speed Circuit: jet.

Difficulty runs from 1 to 10. Courses are laid out in the airport's own frame (its runway heading) and lifted clear of
the ground and roofs. The clock starts at the first ring (the gate) and stops at the last. Star times are fixed per
course, so leaderboards are fair. Badges: Airborne, Barnstormer, Chopper pilot, Jet setter, Ring master, Speed demon,
Frequent flyer, Top Gun, Record holder.

### Build steps
1. **Done.** Module system, profile, badges, leaderboards, airport courses and run check (schema 47), VC prizes.
2. **Done.** The airport as a world module: the admin tool, its layout and drawing, level ground, access road, solid
   buildings and roof boxes. Measured cost: 4 draw calls for an airport with its 10 aircraft.
3. **Done.** Flying.
   - **Flight model** (`shared/flight-model.js`, flown by script in its tests):
     - Planes: lift with airspeed and angle of attack, stall, drag, engine spool, auto-trim, coordinated turns, and
       taildragger or tricycle ground handling.
     - Helicopter: rotor spin-up, collective with a landing flare, cyclic and pedals, hover, and roofs.
   - **Server** (`server/world/aircraft.js`):
     - Boarding next to a free aircraft.
     - Poses checked against the aircraft's top speed; a jump is refused and the pilot corrected.
     - Getting out when landed and stopped.
     - A parked aircraft waits, then goes home; a crash sends it home.
     - A reload resumes the cockpit.
     - Nearby players get poses five times a second.
   - **Browser** (`client/js/player/flight.js`):
     - E to fly, a chase camera, instruments and a crash flash.
     - Everyone else's aircraft are instanced and smoothed.
4. **Done.** The ring game (`client/js/play/airport-game.js`).
   - While flying, G (or 🏁) lists the courses for that aircraft.
   - In the sky:
     - The rings are one instanced mesh; the next ring is gold, with a beam.
     - An arrow points to it, with its distance.
   - The clock starts at the gate, against the course's limit.
   - At the end, the path goes to `/api/play/finish`. The result shows stars, time, best, place, XP, VC, badges and
     level-ups, with Retry, Next and Leaderboard.
   - A crash, getting out, leaving the window or running out of time ends the run.
5. **Done.** The terminal is a real building (type `terminal`, `shared/world-modules.js terminalSpec`).
   - It is made, moved and removed with its airport in the same edit (one undo). Airports placed before this change
     get one at start.
   - **Ground floor:** entrance hall and information desk, check-in desks with conveyors and departures boards,
     security scanners, arrivals with baggage belts, restrooms.
   - **Upper floor:** the departures lounge. Gate desks and boards, gate seating facing the apron, a café (a venue:
     residents come for coffee), duty-free, an arcade corner and a lounge.
   - **New furniture:** `flight_board`, `security_arch`, `baggage_belt`.
6. Next: sounds (engine, wind, ring chime), a minimap of the course, the race against a friend's best (a ghost), and
   the next modules.

## Fishing (second module)

See [fishing](fishing.md): a marina on the sea and a lake dock (world modules), boats, and trips whose fishing grounds
are generated from the run's seed; the server rolls every bite and keeps the catch (`init` / `act`).
