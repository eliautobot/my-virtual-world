# Foxes — the playful wildlife

The product owner (2026-11-24): "most animals in MVW run away from a very far distance if a player/character gets near.
I want the fox to be playful, interactable, and have its own unique playful behaviour … lots of unique animations and
behaviours that make the fox feel alive."

Red foxes live in the island's forests, meadows and fields, alone or in pairs (`shared/world-config/species/fox.json`,
behaviour `play`). Like the deer and horses they are the **shared tier**: the server runs them, so everyone nearby sees
the same fox doing the same thing.

## What a fox does

**On its own** — wanders its patch round its den, sniffs and digs, *mouses* (creeps up, cocks its head, the high pounce,
digs where it landed) mostly at dusk and by night, sits and looks about, curls up nose-to-brush for a nap in the middle
of the day (getting up with a stretch and a shake), now and then tears round in a circle of zoomies or chases its own
tail. Two foxes play-chase each other.

**With people about** — a person on foot within ~30 m is noticed (a friend from further off). A stranger is watched
from a distance and approached in short, wary stages; a friend is greeted at a run with hops and a wagging brush. When
the person stands still it plays: a play bow, an excited hop, zoomies round them, chasing its tail, a pounce at their
feet, a happy roll on its back (friends only). When they walk off it trots after them for a while (about 40 s) — never
into town: at the edge, or when it has had enough, it sits and watches them go, then goes home, and won't trail after
that person again for 5 minutes (it may still come to play if they stand still). Someone sprinting at it starts **tag**: it darts away, turns, bows and waits
to be chased again (four times and it does zoomies round the chaser). Only **moving cars** frighten it.

**Playing with it (Play mode)** — walk up to a fox: **E — 🦊 Play with the fox** opens a small card (keys 1–5):

| | What the fox does |
|---|---|
| 🤚 Pet | comes to your feet; wags — or, once it trusts you, rolls over for a belly rub |
| 🍖 Give a treat | sits and begs, takes it, hops for joy |
| 🪵 Throw a stick | watches the throw (12 m the way you face), races after it, pounces on it, carries it back crosswise in its mouth, drops it at your feet and bows for another |
| 🏃 Chase me! | bows and darts off — tag |
| 👋 Bye | a last look at you, then it trots off home and leaves you be for 10 minutes (no greeting, no following, it keeps its distance) — playing with it again ends that |

**Trust** (♥ out of 5, shown on the card and the E prompt): pets, treats, fetches and games of tag build it; it fades
slowly over days. It changes how far away the fox notices you, how close it comes, how lively it plays, whether it runs
to greet you and rolls over. Kept in the server's memory: foxes forget everyone when the server restarts.

**AI agents play with it the same way** (2026-11-24, the product owner: "All agents should also be able to interact
with animals the same way ... make sure AI Agent can also interact with it the same way the player can"):

- To a fox an agent's body on foot outdoors is a person like a player (`server/index.mjs` wildlifeTick adds them to
  `people` as `agent:<id>`): it is noticed, approached, followed (with the same limit), played with, and trusted.
- The agent's acts are the interaction registry's `animals` source (`server/interactions/sources/animals.js`, kinds
  `pet_animal`, `feed_animal`, `fetch_animal`, `chase_animal`, `bye_animal`): offered in its things to do when a fox is
  within 22 m outdoors ("Pet the red fox — it trusts you 2 of 5"), done through the same `Wildlife.interact` as a
  player's message — the fox comes over to it (an agent's reach is 22 m: the fox trots up), a companion's body walks up
  to pet or feed it (`Brain.goSee`) or turns to watch the stick (`Brain.attendTo`). Its brain is told what happened
  ("you threw a stick for the red fox — it is racing after it …"), and its diary notes it. Free Will, the chat brain's
  `do`, the owner's commands and connected agents all reach it the same way.

## How it is built

- **The mind** — `server/world/fox.js` (`Foxes`), called by `server/world/wildlife.js` for `play` species instead of
  the herds' graze-and-flee. Each fox has a small plan (go to / go near a person / act / circle) worked through segment
  by segment, re-aimed as the person moves. Inputs each 0.5 s tick: players and agents on foot (`people`, with
  velocities), moving cars (`threats`), the hour, where a fox may stand (`dry`, not `town`). Per person it keeps a
  trust, a bye (`BYE_S`, it keeps `SHUN` m away) and a let-go after following (`FOLLOW_S`, `LET_GO_S`).
- **On the wire** — the herds' segment `[x, z, x1, z1, t0, t1, mode, yaw, col]` plus `act` (index + 1 in
  `shared/fauna-acts.js`), `arg` (an orbit's turn rate; mode 3 = going round a circle: x, z its middle, x1 its radius,
  z1 its start angle) and `carry`; a group's stick `k: [state, x0, z0, x, z, t0, t1, carrier]`. A fox that changes its
  mind is sent at once to the pages near it (`faunaUp`), not with the next 2 s round. A player's act is the WebSocket
  message `{ t: 'fox', id, k, act, x?, z? }` (`play.use`; act `pet`, `treat`, `fetch`, `chase`, `bye`), answered
  `{ t: 'foxr', act, ok, why, trust }`; the server checks the player is on foot and within reach (4.5 m to pet or feed,
  14 m to throw or chase, 30 m for bye; a throw lands ≤ 20 m away, on dry land outside town).
- **The model** — a Tripo model from the owner's picture, rigged and skinned with the quadruped tools
  (`tools/animals/quad_prep.py`, `quad_rig.py`, `rig_symmetrise.py`, `quad_skin.py` with `skincfg.json`
  `{"tail_r": 0.3, "skull_r": 1.4, "skull_t": -0.5, "face_z": 0, "head_blend": {...}}` for the fluffy brush, the big
  cheeks and a head that turns as one piece — its joint sits at the eyes, so the muzzle, ears, crown and cheek ruff are
  given to the head bone outright and blended into the neck behind), baked by `tools/animals/fox_bake.py` against the
  game's own `fox.json` (its size sets the strides; it refuses to bake without it): walk (1.2 m/s), trot (2.6 m/s) and
  gallop (8 m/s, stride 1.9 m, the brush held out) from motion v2 (`build/motion.json`), rest, plus the 13 play clips
  hand-keyed in `tools/animals/fox_play.py` (contact sheets with `fox_preview.py`).
- **The gaits on the page** — `render/wildlife.js gaitFor`: the clip whose own speed (stride × beat) is nearest the
  fox's real speed (walk, trot or gallop), played at the pace that carries it one stride a beat (kept within 0.55–1.6×
  the clip's beat), cross-faded on a change. These tools live with the other animal tools in
  the character-module workspace, not in this repository.
- **The clips** — `render/fauna-skinned.js` has slots 7.. for an animal's own acts (sit, bow, pounce, hop, roll,
  stretch, dig, liedown, sleep, getup, wag, shake, tilt); a one-shot starts at its segment's start so a pounce lands
  when the server's segment ends; a change is cross-faded. `render/wildlife.js` draws the circles, turns a fox smoothly
  to face where it goes; `render/fox-play.js` is the E target, the card and the stick.
- **Checks** — `tests/fox-play.test.mjs` (the mind: comes instead of fleeing, pet/treat/trust, the whole fetch, tag,
  cars, following to the edge of town, following has an end, bye, its day alone, the wire form; the baked gaits stay on
  the ground; an AI agent's pet, stick and bye through the `animals` source); `tools-bin/fox-check.mjs` in the lab folder (a
  real browser on a throwaway island).
