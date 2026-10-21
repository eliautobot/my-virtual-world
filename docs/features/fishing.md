# Fishing (play module `fishing`)

A boating and fishing game played from docks on the island's water. Take a boat out, find the fish, cast, hook and
fight them, fill the cooler, and sell the catch at the dock store for Virtual Coin. Then spend it on better gear and
boat upgrades, and go out again to harder waters. It plugs into the shared play system (levels, ranks, badges,
leaderboards: [play modules](play-modules.md)).

The product owner's brief (2026-10-14):
- A deep game that is fun, engaging and easy to play on a phone.
- Two kinds of dock: a beach marina on the sea, and a smaller lake dock with smaller boats.
- Each dock is detailed and placed like the airport, reaching out into the water. It parks 5 boats.
- Boats that feel good on the water and react to the waves.
- A sea boat has room for 4 anglers and a lake boat for 2. Multiplayer comes later; now one player per boat.
- The player's character is visible and walks round the deck to fish from different spots. Nobody jumps off the boat.
- New fishing grounds every trip (procedural).
- Many species, sizes and rarities.
- Good animations for the player and the fish, such as fish jumping, and water splashes.
- Gear upgrades.
- Navigation with waypoints and fishing spots.
- Performance first.

## What we took from the best fishing games

| Game | What it does well | What we use |
|---|---|---|
| **Dredge** | Port → sea → port loop; time pressure (night falls); a hold that limits the haul; gear that gates biomes; upgrades from sales | The trip loop: leave the dock, fish, come back before dark, sell. A cooler with slots (big fish take more). Gear gates the big fish, not the water. Upgrades to the boat. |
| **Final Fantasy XV** | Fish visible as shadows; lure choice per species; the fight: reel to drain the fish's HP, steer with the stick, let go when the line strains, line breaks and the lure is lost; jumps with a prompt | The fight: reel (hold) to tire the fish, steer the rod against its runs, ease off when the tension climbs, a quick reaction when it jumps. Lures matter and are lost when the line snaps. Shadows show where fish are and how big. |
| **Ace Fishing / Fishing Clash** (mobile) | One-thumb reel button, tension gauge round it, swipe prompts on jumps; a fight lasts 15–45 s; gear widens the safe zone | Phone controls: the big REEL button with the tension ring round it, the stick or a drag to steer, swipe on a jump. Fights last 15–60 s; better gear forgives more. |
| **Sea of Thieves, Webfishing, Animal Crossing** | Readable, chunky feedback; casting is fun on its own; a reveal moment for every catch | A splash, a ripple and a sound on every cast. The fish leaps on the hook. The character holds up every catch to the camera, with a card showing what it is, how big, and whether it's new or a record. |
| **Cast n Chill, Fishing: North Atlantic** | The sonar and the chart; boats that ride the swell; drifting; anchoring | A fish-finder screen, a chart with marks, auto-cruise to a waypoint. The boat rides the same waves you see. Wind drift, and the anchor. |
| **Arcade boat physics** (Wave Race, Hydro Thunder, tutorials) | Buoyancy probes on the hull, planing lift at speed, lateral grip, a low centre of mass that rights itself | `shared/boat-model.js`: 8 probes on the hull sample the same sea surface the ocean draws. Planing lift and bow trim, keel grip, outboard vector thrust, and self-righting that can't capsize. |

## The loop

1. **At the dock.** Walk to the dock store to buy or upgrade gear and to pick a trip. A sea trip is picked at a
   marina and a lake trip at a lake dock. Then walk the pier to a free boat and press **E** (🚤) to board it.
2. **Leaving starts the trip.** The fishing grounds of this trip are generated: their kinds, places, fish, a few
   bounties, and maybe a legend. A clock starts: the trip ends at dusk.
3. **On the water.** Drive to marks you can see (birds diving, surface boils, a fish jumping). Or find hidden ones with
   the fish finder, or chase a bounty. Stop and anchor, or drift. Walk round the deck to the best side. Then cast.
4. **The bite and the fight.** Fish come to a lure that suits them: the right kind, depth and colour, at the right
   time. Set the hook on the strike, then fight: reel, steer, ease, and react to jumps. Land it with the net, or gaff
   the big ones.
5. **The catch.** The fish is revealed: species, length, weight, size class, rarity, value, and whether it's new, a
   personal best or a world record. **Keep** it in the cooler, or **Release** it for experience and the
   conservation badge.
6. **Back at the dock** (before dusk, or the catch loses freshness), sell at the store. The trip's score is the
   catch's value plus the bounties won. It sets the stars, experience, levels and leaderboards (play core). The sale
   pays VC from the economy's **Fish market**.
7. **Spend.** Buy rods, reels, lines and lures, and boat upgrades: engine, cooler, fish finder, rod holders for
   trolling, lights, anchor and livewell. Skill points come with fishing levels.

## Venues: two world modules (administrators place them, like the airport)

| | Beach marina (`marina`, ⚓) | Lake dock (`lakedock`, 🛶) |
|---|---|---|
| Water | the sea (a public shore or growth coast; not protected waterfront) | a lake |
| Land part | ≈120 × 80 m: car park with trailer bays, the Dock Store (a real building you walk into), a promenade, a fish-cleaning station, lamps, benches, the name sign | ≈70 × 45 m: car park, the Bait Shack (a real building), a picnic spot |
| Ramp | two-lane concrete launch ramp (grooved, 12 % slope) into the water, with a courtesy dock | one-lane ramp |
| Over the water | a timber pier on piles, a gangway down to the floating dock, 5 slips between finger docks, a T-head with a fuel pump | a short timber pier with 5 small slips |
| Boats | 5 × Coastal Fisher 26 (8 m centre console, 4 anglers) | 5 × Lake Skiff 16 (5 m aluminium boat, 2 anglers) |
| Depth needed at the slips | 2.5 m | 1.2 m |

- **Placing.** The ghost turns its water side toward the deepest water nearby, so it lands square to the shore. The
  admin can still turn it.
  - Its land part must be dry and fairly flat; its water part over the right water, deep enough.
  - Same rules as the airport: clear of roads, buildings and other modules, a road within reach, and an access road
    built with it in one edit.
- **The land** is levelled for the car park and the store, and the ramp is graded down into the water (a sloped pad).
  Piers stand on piles on the bed. Their decks are walkable, and the ground under them stays water.

## Boats

Built in code like the aircraft, low-poly but detailed, one piece, instanced while parked.

**Coastal Fisher 26** (8.2 × 2.8 m):
- Hull: deep-V hull with spray strakes and a bow flare, in white with a coloured boot stripe.
- Twin outboards on the transom.
- Centre console:
  - windscreen and grab rails, wheel and throttle;
  - a chartplotter and fish-finder screen;
  - a T-top with rod holders.
- Leaning post with a tackle station, a cooler seat, a bow casting deck with cushions.
- Livewell, bow rail, cleats, navigation lights, anchor locker.
- 4 fishing spots: bow, port, starboard, stern.

**Lake Skiff 16** (5.0 × 1.9 m):
- Riveted aluminium hull with a modified V.
- Side console.
- Raised casting decks fore and aft with pedestal seats.
- A bow trolling motor and a 40 hp outboard; livewell.
- 2 fishing spots: bow and stern.

**Handling** (`shared/boat-model.js`, stepped in the player's browser like flight, with poses checked by the server):
- **Buoyancy:** 8 probes on the hull sample the water's surface. Spring and damping give heave, pitch and roll, so it
  rides swell and wakes.
- **Speed:** planing lift and a lower bow at speed; drag falls as it gets on the plane.
- **Steering:** the outboard's thrust is vectored, so the boat turns best under power. It grips with its keel
  sideways, and the bow lifts on a hard throttle.
- **Drift and anchor:** wind drift when idle; the anchor holds position with a slow swing.
- **Can't capsize:** a low centre of mass and self-righting.
- **Running aground:** shallow water or the shore stops it with a bump, and nothing breaks. Docks and piers are
  solid.
- **Range:** boats may go far out to sea, to the edge of the world's ocean. Walkers keep the swimming limit.
- **The sea surface the boat feels is the sea you see:**
  - On the sea, the largest waves of the ocean's own spectrum are worked out on the CPU (`render/ocean-fft.js`
    spectrum → the dominant swell components).
  - On a lake it's a light wind chop.
- **Controls:**
  - Desktop: W/S throttle, A/D steer, Space for the anchor.
  - Phone: a stick and a throttle lever.
  - **Auto-cruise** drives to the chosen waypoint and steers round land.

**On deck.** Press **F** (🧍) at the helm to walk the deck; the boat drifts or holds at anchor.
- You walk in the boat's own frame, so it stays steady under your feet as it rolls. The deck's outline keeps you on
  board, and there is no jump.
- The fishing spots are marked; standing at one puts you in casting stance facing out.
- Your character is drawn on the boat throughout: driving at the helm, walking, casting, fighting, holding up the
  catch.

## Fishing

**Finding fish.** Every trip generates grounds within reach of the dock: 6–14 on the sea, 5–9 on a lake.

| Ground | Where | Shows as | Holds |
|---|---|---|---|
| Bird flock | open sea | birds circling and diving (seen from far) | surface pelagics: mackerel, bonito, tuna |
| Surface boil | anywhere | the water churning, fish breaking | the fast feeders of that water |
| Reef / rocks | sea, 4–25 m | sonar marks; a darker sea | snapper, grouper, hogfish, triggerfish |
| Drop-off / edge | where the bed falls away | sonar; a colour line | predators: amberjack, kingfish; walleye on a lake |
| Wreck | deep sea (rare) | sonar only | big grouper, amberjack, the wreck's legend |
| Weed bed / lily pads | lake shallows | pads on the water | bass, pike, sunfish |
| Deep hole | lake | sonar only | catfish, lake trout, sturgeon |
| Open water | anywhere | (none) | a thin mix (casting anywhere can catch something) |

- **Changes during a trip:**
  - Grounds wear out as you fish them; the fish move on.
  - A **frenzy** can flare at one for two minutes.
  - A **legend sighting** marks a ground for a while.
  - The weather and the light change the bite.
- **The fish finder** shows marks under the boat: arches at their depth, sized. Upgrades widen its range and detail,
  and the best one names likely species.

**Casting.**
- Hold CAST to aim: an arc and a landing ring on the water.
- Drag (or the mouse) to aim and the hold to set the power, then release.
- The rod sets the reach.
- The lure flies on a real arc and lands with a splash and rings.

**The bite.**
- Fish near the lure grow interested by how well it suits them: its kind (topwater, spinner, crankbait, soft
  plastic, jig, spoon, live bait, cut bait, trolling skirt) and its depth, at the right time of day.
- You see their shadows come in, then a nibble: the bobber dips and the rod tip twitches.
- Then the strike, and **HOOK!** Tap within the hook window (skills widen it). Too early spooks the fish; too late,
  it steals the bait.
- Twitch the lure (tap REEL) to draw interest; reel slowly for a steady swim.
- **Trolling** (with rod holders): lures out behind the boat at low speed, and a rod bends when a fish takes.

**The fight** (`shared/fishing-fight.js`, the same rules in the browser and the server's check):
- The fish has **stamina** and a **pull** from its species and size. It has a **temperament**: steady, runner,
  jumper, diver, thrasher or bulldog (stays deep). It moves through runs, rests, dives, head-shakes and jumps.
- **REEL** (hold) gains line and drains its stamina. Pulling **against** its run (the stick or a drag opposite its
  way) turns it and tires it faster, but raises the **tension**.
- **Tension** over the reel's **drag** pays out line (the fish gains ground); over the line's **strength**, it
  snaps and the lure is lost.
  - Ease off in the red; let it run on the long runs.
  - Slack for too long, or a fish jumping on a slack line, throws the hook.
- **Jumps:** the fish leaps clear with a splash. **Bow to it** (swipe or tap the prompt in time) for a big drop in
  its stamina; miss it and the tension spikes.
- **Landing:** when it's beaten and close, **LAND** to net it (or gaff it if it's over 15 kg). Then the reveal: you
  hold up the fish.
- **On screen:** the tension ring round the REEL button (green / yellow / red), the fish's stamina, the line out,
  and a "Big one!" hint from its size. Its name stays a secret until landed.
- **Phone:** right thumb on REEL; left thumb steers (stick or drag); swipe on jumps. **Desktop:** hold the mouse
  button or Space, steer with A/D or the mouse.

**Trust.**
- The browser never decides what was caught. Setting the hook asks the server (`POST /api/play/act`). It rolls the
  fish, with a secret it keeps, from that ground's population, the lure, the light and luck, and holds it as hooked.
- Landing asks again. The server checks the fight couldn't have been faster with that gear and that the fish was
  hooked, then puts it in the trip's catch.
- The trip's score and the sale come from the server's own list of the catch.
- Rate limits keep every request cheap (one per hook, one per landing; no per-frame work).

## Fish (`shared/fish-species.js`)

- **87 species:**
  - 47 sea fish: inshore, reef, flats, pelagic and big game, including sharks, a ray and a squid.
  - 34 lake fish: panfish, bass, pike and musky, trout, walleye, catfish, carp, gar, sturgeon.
  - 6 legends: one-of-a-kind giants with names, found only on hard trips at their ground and time.
  - Plus junk and treasure: a boot, a tyre, a bottle with a message (marks a hidden ground), a coin pouch, a golden
    lure.
- **Each species has:**
  - its water and habitat, depth and hours;
  - the lures it takes;
  - its length range and condition (weight = K·L³);
  - rarity, price per kg, fight (power, stamina, speed, temperament, jumps);
  - its body for the model: shape, fins and colours with a pattern.
- **A catch** has a length (cm) and weight (kg), and a size class from its place in the species' range:
  - Small ★ (below the 35th percentile)
  - Medium ★★
  - Large ★★★ (above the 75th)
  - Trophy 👑 (the top 5 %)
- **Rarity:** common, uncommon, rare, epic, legendary.
- **Value** = price per kg × weight × size class (1, 1.15, 1.35, 1.8) × freshness, with a floor per fish.
- **Fishdex:** every species with its silhouette until caught, your best, the world record and where to find it.

## Trips (courses) and score

Each trip type is a course of the module. Stars come from the trip's value; the next trip type opens with 1★ on the
one before, in each water's own line.

| Water | Trip | Difficulty | Reach | Notes |
|---|---|---|---|---|
| Sea | Harbour Morning | 1 | 700 m | calm, inshore, commons |
| Sea | Reef Run | 3 | 1.2 km | reefs and rocks |
| Sea | Wreck & Ledge | 5 | 2 km | deeper, bigger bottom fish |
| Sea | Offshore Edge | 6 | 3 km | pelagics, bird flocks |
| Sea | Blue Water | 8 | 4.5 km | big game: tuna, wahoo, sailfish, marlin |
| Sea | Storm Run | 10 | 4.5 km | rough sea, legends |
| Lake | Lily Pads | 1 | the lake | sunfish, small bass |
| Lake | Weed Line | 3 | the lake | bass, pike, perch |
| Lake | Deep Basin | 5 | the lake | trout, walleye, catfish |
| Lake | Dusk Bite | 7 | the lake | bigger fish come up at dusk |
| Lake | Old Monster | 9 | the lake | trophies, the lake's legend |

- **A trip lasts until dusk:** 12 minutes on the easy trips and up to 22 on the hard ones. The clock runs while you
  are out; back late, the catch loses freshness by 3 % a minute.
- **Bounties:** 2–3 per trip, such as "a Red Snapper over 50 cm", "three fish from one ground" or "a fish on a
  topwater lure". Each adds to the score.
- **Score** = the catch's value plus the bounties, worked out by the server.

## Gear and upgrades (bought at the dock store with VC; yours on every boat)

| Gear | Tiers | Changes |
|---|---|---|
| Rod | Starter, Fibreglass, Graphite Pro, Carbon Elite, Legend | casting reach, hook window, fight power, the biggest fish it can land |
| Reel | Spincast, Spinning 3000, Baitcaster, Big Game 50W | reel speed, the most drag, line capacity |
| Line | Mono 8 lb, Mono 15 lb, Braid 30 lb, Braid 65 lb, Big Game 130 lb | strength; fluorocarbon leaders (an extra) make the line less visible: more bites |
| Lures | 14 kinds | which fish come; lost when the line snaps; bought singly or in packs |
| Boat | engine (top speed), cooler (slots), fish finder (range, detail, species), rod holders (trolling), lights (fish past dusk), anchor, livewell (keeps fish fresh) | tiers 1–3 each |

- **Skills:** one point per fishing level, five ranks each.
  - Casting: reach, accuracy.
  - Hookset: a wider window.
  - Fighting: more stamina drain, slower tension.
  - Seamanship: speed, handling.
  - Trader: up to +15 % at the store.
  - Luck: rarer fish.
  - A respec at the store costs VC.

## Levels, ranks, badges, leaderboards

- From the play core: module and player levels, ranks, and each trip type's leaderboard of best trip values.
- **World records:** the biggest of each species, with who caught it, are kept by the module and shown in the
  Fishdex and the store.
- **Badges:** First Catch, Fishdex 10 / 25 / 50 / all, Trophy Hunter, Big Game (over 100 kg), Legend Slayer, Catch &
  Release 25, Bounty Hunter, Storm Rider, Night Owl, Full Cooler, Record Breaker.

## Performance

- **Server:** start and finish, plus one tiny request per hook and per landing. Everything is held in memory with
  the run; no per-frame work. Records are an indexed table.
- **Browser:**
  - Boat physics: 8 probes and a few dozen swell terms a step.
  - Only the fish near the lure are simulated (at most 6).
  - Fish drawn instanced, one mesh per body shape, swimming in the vertex shader.
  - Splashes, sprays and rings from one pooled particle system; bird flocks instanced.
  - The water's marks (`render/water-marks.js`, 2026-10-15): wakes, splash rings, foam and churned water are drawn
    from above into one small map round the view each frame (512², 1024² at High), which the sea's and the lakes' own
    shaders read - so they ride the waves and are lit as water. A boat leaves its wash (foam breaking into lace and
    streaks over milky water that lingers), its wake's arms at the Kelvin angle, the waves between them, and a bow wave
    (`render/boat-fx.js`); spray is drops drawn as streaks, mist and a splash's crown (`render/spray.js`). The foam's
    pattern is a baked tiling texture (worked out per pixel it cost the phone a third of its frame rate at Medium).
    Dev page: `client/dev/wake.html`; phone timing: `tools-bin/phone-wake.mjs`.
  - In the water (2026-10-15, redone after the product owner's "it has to feel like a boat going through water, not an
    object going through potholes"; after J. Kerner's water model for Just Cause 3): the sea's surface at ~35 points
    of the hull's bottom (`shared/boat-model.js` hullOf: the hull `render/vessels.js` lofts): buoyancy where each is
    under, damping (against the water's rise at rest, its own at speed), the pressure of water run into (planing lift,
    a bow driven into a wave), slamming on a fast entry, summed on a hull with mass, the water it carries and inertia.
    At speed it skims chop shorter than its weight can feel (a big wave still gets through: it flies, lands with a
    slam); the bow climbs at the hump; on the plane it trims ~4° and rides higher; it floats level at its waterline.
    The surf the sea draws over the shallows (`render/sea-probe.js` surfAt, the shader's swSurf in JS) lifts it and
    its breakers shove it toward the shore. The chase camera eases its height. Simulated: at speed in moderate chop
    a third of the old model's jolting; storms at speed still fly and slam; on the phone it sees the sea the screen
    draws (2.7 cm).
  - In the marina (2026-10-15, the product owner: moored boats "go down when the wave comes up … almost like
    reversed", and a long straight white band off a boat's bow):
    - The boats read the water's depth from the sea's own depth maps (`render/water.js` depthAt), not the ground's.
      The marina's dredged basin is drawn as the beach it was, so the surf the boats felt ran out of step with the one
      on screen.
    - A marina's basin is a harbour (`render/water.js` setCalm, set by `render/docks.js` for the nearest four): no
      surf in it, and the open sea's swell comes in at 35% over all of it. The same in the shaders and the probe, faded
      out over 18 m with rounded corners. On the phone in a storm the moored boats rise and fall 16–26 cm, in step
      with the water (correlation 0.99, 0.1 s behind).
    - A boat against a dock stops drifting with the surf (the surf's shove had pinned it to the quay).
    - The wake keeps a point every stretch the boat moves, however slowly. Creeping in to the dock, its last stretch
      had reached back to where the boat was last fast: one long straight band. A new trip, or a boat moved at a jump,
      starts a wake of its own and leaves the old one to fade.

  - The water keeps out of the boats' hulls (2026-10-15: waves showed in the cockpit): the water's shaders skip what is
    inside the nearest four hulls (`render/water-marks.js` mkDry: the hull as `render/vessels.js` lofts it, in each
    boat's own frame). Every boat in the water - yours, other players', the moored ones - has a line of foam where it
    meets the water and rings spreading as it bobs (the marks' laps); a slow boat's bow dipping into a swell slaps up
    white water and drops. Boats register with `hullAt(key, HULL_FORM[type], { obj | m })` each frame.
  - Docks: one merged mesh per module; parked boats instanced.
  - No new lights or shadow casters.
- **Proof:** measured on the OnePlus at `?q=low` (frame time, long tasks, draw calls), against driving and flying.

## Build steps

1. **Done.** Design (this page); fish, gear, trips, fight and scoring as shared data and rules, with tests.
2. **Done.** The two docks (`shared/dock-layout.js`, `client/js/render/docks.js`):
   - **Layouts** in the dock's own frame (+s up the land, −s out over the water, s = 0 the quay):
     - The marina: a two-lane ramp, a 72 m pier on piles with a T-head (the fuel dock and its kiosk), and a gangway
       down to a floating dock with 6 fingers and 5 slips.
     - The lake dock: smaller, with a one-lane ramp and 5 small slips.
     - Both have a promenade, a weigh-in station, a lawn with picnic tables, a car park (long bays for trailers) and the
       store.
   - **Placing:** pointed at a shore, the ghost squares itself to the water with its quay at the water's edge
     (`fitToShore`). The rules (`dockWhy`):
     - dry land behind the quay, with the water within 16 m (10 on a lake);
     - the piers over the dock's own kind of water;
     - open water out from the basin that gets deep enough for the boats;
     - on the sea, never in the clear water kept in front of protected waterfront.
   - **The ground:**
     - The land is levelled 1.2–3.5 m above the water (0.8–2.5 on a lake).
     - The ramp is a sloped terrain pad (`P.k`, `shared/terrain.js padY`) down to 1.6 m under the water.
     - The slips' basin is dredged flat (a pad below the water).
   - **Decks are walkable** (`moduleDecks`, `deckUnder`): on the pier, the sloped root, the gangway and the floats,
     in the browser and on the server. A swimmer climbs out on to a floating dock or up a pier's ladder. Rails along
     the pier and the promenade are walls.
   - **The store** is a real building, made, moved and removed with the dock in one edit: a shop with
     `tackle: true`, its door facing the water. It has a porch, a sign board, an ice machine, a bait cooler, crates,
     buoys and a rod rack.
   - **Drawing:** one merged mesh per dock plus one mesh for all its lettering, so a marina costs 2 draw calls. On the
     maps it has its paving, ramp and decks, and a ⚓ / 🛶 place.
   - **Checks:** `tests/docks.test.mjs`, `tests/docks-http.test.mjs`, and `tools-bin/dock-check.mjs` (screenshots).
   - The store's own interior (tackle shelves, the sales counter) comes with step 6.
3. **Done.** Boats:
   - **Models** (`client/js/render/boat-models.js`), on lofted hulls from `render/vessels.js`:
     - The Coastal Fisher 26: a deep-V centre console with a T-top and a rocket launcher of rods, the console, a
       leaning post, a cooler seat, a bow casting deck, rails, nav lights and twin outboards that turn with the wheel.
     - The Lake Skiff 16: an aluminium boat with casting decks and pedestal seats, a side console, a trolling motor
       and a 40 hp outboard.
     - Five of them lie in each dock's slips: instanced, bobbing.
   - **Handling** (`shared/boat-model.js`, stepped in the skipper's browser at 60 Hz):
     - Heave, pitch and roll spring to the water's plane under the hull, each with its own period, so the boat rides
       the swell with weight. In a steep sea at speed it flies off crests and slams.
     - The outboard's vectored thrust; drag over the hull-speed hump; getting on the plane (bow drops, it rises).
     - The keel's grip with a little skid; leaning into turns.
     - A throttle lever with a notch at neutral and reverse.
     - Wind drift and the anchor; grounding in the shallows; the docks are solid; it can't capsize.
   - **The water it feels** (`client/js/render/sea-probe.js`):
     - On the sea, the ocean's own waves through the FFT's GPU probe (fixed slots per boat; damped in the shallows).
     - At low quality, the same Gerstner waves the low sea draws; on a lake, a light chop.
   - **Server** (`server/world/boats.js`, as the aircraft): taking a boat from beside it (`bboard`), poses checked
     against its speed (`bpose`), and the skipper kept at the helm so others see them standing there.
     - Stepping off when stopped alongside a dock or the shore (`bexit`); leaving Play mode brings the boat home.
     - A moored boat goes back to its slip after 5 minutes.
     - Nearby players get the boats that are out five times a second (`harbour`).
   - **Browser** (`client/js/player/boating.js`):
     - E takes a boat, your character standing at the helm.
     - A chase camera; the gauges (speed in knots, heading, depth, a throttle lever with F/N/R).
     - Phone controls: a wheel slider, a lever slider, Neutral, ⚓ and Off.
     - Everyone else's boats, instanced and smoothed.
     - The wake (Kelvin arms and prop wash) and spray (`render/boat-fx.js`).
   - **Checks:** `tests/boats.test.mjs` (handling), `tests/docks-http.test.mjs` (taking a boat over the websocket),
     and `tools-bin/dock-check.mjs` (taking a boat out in the browser, driving, turning, leaving).
   - The pier heads became Ls clear of the slips (a T blocked the first boats' way out:
     `tests/docks.test.mjs` checks every slip's way out).
   - Auto-cruise comes with the chart (step 6).
4. **Done.** On deck:
   - **The deck plan** (`shared/boat-model.js` deck, shared with the server): each boat's floors (the cockpit sole, the
     casting decks), the width you can stand at along it, its fixtures (console, leaning post, cooler, livewell, the
     T-top's posts), and its fishing spots - the coastal boat four (bow, port, starboard, stern), the skiff two (bow,
     stern). `walkDeck` moves you along it: round the fixtures, along the gunwale as the hull narrows, up a step on to
     a casting deck, never over the side.
   - **Walking** (`client/js/player/boating.js`): **F** (📱 🚶 Walk) leaves the wheel (the lever to neutral); WASD or the
     stick walks you in the boat's frame, the camera following you and swinging round with the boat. Rings mark the
     spots; **E** at one (📱 🎣 Fish) puts you in the fishing stance facing out, rod in hand; E again stands up; E by
     the wheel (or F) takes it again. The T-top's canopy hides while it is between the camera and you.
   - **The character** (`tools/chars/extra-clips.mjs`, baked for all 44 bodies): `helm` (hands on the wheel),
     `fish_idle` (rod ready), `fish_cast`, `fish_reel` (the left hand turning the handle), `fish_fight` (leaning back,
     pumping), `fish_net`, `fish_show` (the catch held up). The left hand slides along the rod for shorter arms so
     both hands stay on it. The rod (a spinning rod with its reel and guides) and the landing net are props of their
     own (`render/char-props.js`, a third set drawn only for someone fishing). The clip table in the skinning shader is
     packed two clips to a vec4 (36 uniform slots for 71 clips, not 142 - phones allow as few as 256).
   - **The server** takes where you stand and what you're doing with the boat's pose (`bpose` dk) - only a point one
     can stand on that boat, else the wheel - so everyone sees you walking, at the wheel or fishing.
   - **Fixed on the way:** the coastal skipper stood inside the console and the skiff's inside its aft deck; the
     consoles are raised to standing height, the bow cushions fit the bow's taper.
   - **Checks:** `tests/boats.test.mjs` (every spot walkable from the wheel, never over the side, the server's check),
     `tools-bin/dock-check.mjs` (leaving the wheel, walking to the bow, fishing, back), `tools-bin/props-shot.mjs
     fish1 "set=fish"` (the poses).
5. **Done.** Fishing:
   - **Trips** (`client/js/play/fishing-game.js`): 🎣 Trips (T) lists this water's trips (sea from a marina, lake from a
     lake dock), locked ones saying what opens them. Go: the server lays the trip out round the dock you're out from
     (`server/index.mjs` fishingContext: the dock, its water, the ground sites for the trip's reach - or the whole
     lake - kept per dock and reach, and the kit, the starter's until step 7). The trip panel: its clock (the trip's
     own day, dawn to dusk over its minutes: `shared/fishing.js` tripClock), its bounties ticking off, the cooler.
     Stepping off the boat (or 🏁 End) weighs the catch in: stars, the leaderboard, XP.
   - **Cast**: hold Space (the big button on a phone) - the power swings, a ring and an arc show where it lands on the
     water the way the camera looks (within 75° of the way you face out, never past land); let go: the rod comes over
     (`fish_cast` driven through its phases) and the lure flies its arc to a splash.
   - **Wait**: the bobber rides the drawn waves (the sea probe); hold to reel (a lure swims only while it moves), tap
     to twitch. The bite comes by `biteEvery` (the ground under the lure, the lure, the trip's hour); nibbles dip the
     bobber, then the strike - HOOK! within the rod's window (`L.win`). Too soon spooks it; too late steals the bait.
   - **Hook**: the server rolls the fish (act hook). **Fight**: `shared/fishing-fight.js` stepped here by real time -
     hold to reel, steer against its runs (A/D, the stick), bow to its jumps (S, BOW), LAND when it's beaten (E). On
     screen: the tension bar (the drag marked) and a ring round the button (green, amber, red), the fish's stamina,
     the line out, what it's doing ("It runs right - hold A"). Its shadow moves under the surface; it leaps clear with
     splashes going out and back in; the line hangs off the rod's real tip (`render/characters.js` gripPoint: the
     hand's bone from the baked frames on the CPU).
   - **Land and the catch**: the net (`fish_net`), the server's check (act land), then you hold it up (`fish_show`, the
     model between your hands) with its card - rarity, size class, cm/in, kg/lb, its worth - keep it or let it go.
     Finds (a boot, a bottle with a note…) are just reeled in.
   - **The fish** (`client/js/render/fish-models.js`): every species built from its body spec - a lofted body, its
     tail and fins, a bill, hammer, whiskers or snout, its own painted skin (back to belly, its pattern, the eye); the
     squid and the ray their own way; the finds. `client/dev/fish.html` shows them all (`tools-bin/fish-shot.mjs`).
   - **Splashes** (`client/js/render/fishing-fx.js`): rings spreading on the water and thrown drops; the line, the
     bobber and lures, the aim, the fish's shadow. One draw call each, pooled.
   - **Checks:** `tests/docks-http.test.mjs` (a trip from a marina: grounds on that sea within the reach, the kit, a
     lake trip refused there, a hook rolled, two hooks too quick refused, a landing at once refused);
     `tools-bin/dock-check.mjs` (a trip, a cast, a bite, the fight played by the shared bot, the catch, the result).
   - Not yet: other anglers' lines and fish aren't drawn (you see them cast and fight, rod in hand); trolling waits
     for rod holders (step 7).
6. **Done.** Finding the fish and selling them:
   - **The grounds on the water** (`client/js/render/fishing-grounds.js`): bird flocks wheel over theirs and dive into
     the water (seen from far off), surface boils break with bait fish (ripples and splashes near you), lily pads,
     weed beds and rocks off a point, and the water's own colour over the flats (sand), a reef (dark), a drop-off (a
     band) and the blue water. Flocks and boils wander (`shared/fishing-trip.js` groundPos - the same on the server).
     Hidden grounds show nothing; the legend's ground gets a golden ring while it is about.
   - **The chart** (C, 🗺️ in the trip panel; `client/js/play/fishing-nav.js`): the water round the dock, the trip's
     reach, the grounds you can see or have found, the legend, the dock and you - each listed with its distance and
     bearing. 📍 sets a course: an arrow at the top of the screen, a buoy and a beam on the water. ▶ Cruise drives
     there (`player/boating.js` autopilot): it steers round points and shallows, eases in, stops inside the ground or
     as close as the depth allows, and hands back the wheel if it grounds or you touch the wheel or the lever. The
     trip's marks show on the map (M) and the radar too (`ui/worldmap.js` app.mapMarks).
   - **The fish finder**: the bottom scrolling under the boat, fish marks over (and near) a ground at its kind of depth;
     a hidden ground within its range (the finder upgrade's metres) is found and goes on the chart.
   - **Fair play**: a bite's ground must be where the angler is - the server's own position for them (the boat's deck)
     within the ground's circle and the line's length (`PlayCore` whereIs → act's `pos`).
   - **Selling** (`server/play/fish-market.js`, `client/js/play/fish-store.js`): inside a dock store, E at its counter
     - the trips weighed in and not sold yet, each fish and its price, Sell it all - paid from the economy's **Fish
     market** faucet (policy `fishMarket`: on, pct, dailyCap; 1,500 VC a day by default), once per trip (the ledger's
     key), within a day of the trip. `GET /api/fishing/market`, `POST /api/fishing/sell`.
   - **The store's interior**: a tackle shop - rod racks, the lure wall, the live bait fridge and the fish market's
     counter with its scale (new docks; a store placed before this keeps its shelves until it's placed again).
   - **Checks:** `tests/docks-http.test.mjs` (a catch sold at the store once, refused out on the water);
     `tests/floor-generators.test.mjs` (the tackle shop); `tools-bin/dock-check.mjs` (the grounds, the chart, a cruise,
     fishing, the store's counter and the sale).
7. Gear and skills - in two parts:
   - **7a. Done. The gear shop, the boat, skills** (`server/play/angler.js`, `client/js/play/fish-store.js`; schema v51
     `fish_anglers`):
     - **Gear is in the inventory** (docs/features/INVENTORY.md): rods, reels, lines, the leader, bait and lures are
       things you hold - bought at the counter, given, traded. Everyone's welcome kit has the starter rod, reel and
       line and bait for a first trip.
     - **The counter** (E inside a dock store, or 🎣 Gear & skills in the trips panel): tabs **Sell**, **Tackle** (each
       rod, reel and line with what it does: Buy, Use it, or the fishing level it needs), **Bait** (by the pack, ×5),
       **Boat** (each upgrade's tier, now → next, Upgrade), **Skills** (a point a fishing level after the first, five
       ranks each, a fresh start for 250 VC). Buying needs a store; choosing your tackle and spending points work
       anywhere. What the store sells is paid into the economy's **Tackle** sink.
     - **A trip takes what you hold** (`fishingContext` → `angler.tripKit`): the rod, reel and line you chose (if you
       still hold them; else your best; else the starter's the dock lends), the leader if held and on, the bait and
       lures held, the boat's upgrades, the skills. **Bait is used up when a fish takes it; a lure is lost only to a
       snapped line** (`shared/fishing-gear.js` `bait`); what a trip used leaves the inventory when it ends
       (`detail.used`, once per trip). The boat you board takes your engine and anchor upgrades and seamanship.
     - Without the economy everyone fishes with the starter's kit, as before.
     - `GET /api/fishing/angler`, `POST /api/fishing/buy` `{ kind: gear|lure|boat, id, packs }`, `use`
       `{ rod|reel|line|leader }`, `skill` `{ id }`, `respec`.
     - The play core keeps a run's detail whole (up to 6,000 characters) - a cut-off string isn't JSON.
     - **Checks:** `tests/docks-http.test.mjs` (the gear shop end to end), `tests/fishing.test.mjs` (bait and lures used),
       `tools-bin/dock-check.mjs` (the counter's tabs, a pack of shrimp bought).
   - **7b. Done. The Fishdex, world records, badges** (`client/js/play/fishdex.js`, `server/play/angler.js`):
     - **The Fishdex** (📖 in the trips panel, the dock store's head and a trip's result): all 87 species, each drawn
       from the game's own fish model (side on, once, a few a frame; a dark shape until you've landed one), how many
       you've landed and your biggest, filters (sea, lake, legends; landed or not yet) and a species' card - your
       biggest, the **world record** and who holds it, and **where to find it** (its grounds, the hours it feeds best,
       its depth, the baits it takes, the trips that go there; a legend at its own ground in its hour).
     - **Every species landed counts, kept or let go**: a trip's detail lists them (`landed`: species, how many, the
       biggest's kg and cm), and when it's weighed in the angler's Fishdex (`fish_dex`) and the world's records
       (`fish_records`: the biggest of each species, who, when) are brought up to date - once per trip.
     - **The catch card** says *New to your Fishdex!* and *bigger than the world record* as the fish comes up; the
       trip's result lists the new species and the records set.
     - **Badges**: Night owl (a fish after dusk), Fishdex 10 / 25 / 50 / Complete, Record breaker (the biggest of a
       species anyone has landed - taken from someone else, or the first ever), Gentle hands (25 fish let go). The
       Fishdex and record badges are given by the angler's records (`PlayCore.grant`: a module's own badges only).
     - `GET /api/fishing/dex` → `{ mine, records, count, of }`.
     - **Checks:** `tests/fishing.test.mjs` (the Fishdex and records over two anglers, once per trip, the badges),
       `tests/docks-http.test.mjs` (a landed fish new to the Fishdex and a world record over HTTP),
       `tools-bin/store-check.mjs` (the Fishdex's pictures, a species' card, someone else's record, the phone).
8. Polish and the phone measurements. (Sound waits: the product owner asked for no sounds yet, 2026-10-14.)
