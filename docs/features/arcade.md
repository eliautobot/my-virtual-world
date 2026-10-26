# Arcade

The arcade cabinets in the world play real games. Walk up to one (or click it while looking inside a floor), press
Play, and the camera glides to its screen: the game runs on the cabinet's own glass. Scores are verified by the server,
so every leaderboard is real.

The games are our own: each one plays like a classic genre, with its own look, characters and name. The library starts
with ten games and grows toward twenty (see [The library](#the-library)). The platform is built so that later on,
players' own games and (on self-hosted Local only) emulators can run on the same cabinets.

A whole floor can be made an arcade in one step: 🎨 Floor Themes → Arcade in the Furnish panel lays out cabinets,
games and furniture of its own to fit the floor: billiards, mini bowling, a mechanical bull, air hockey, claw machines,
skee-ball and more, a prize corner, a snack bar, neon booths and neon signs ([floor themes](floor-themes.md#the-arcade)).

## Playing

| Where | How |
|---|---|
| Looking inside a floor | Click a cabinet, then **▶ Play now** |
| Player mode | Walk up to a cabinet, press **E** (🕹️ Play). Leaving the cabinet steps back from it |
| On a computer | The camera glides until the screen fills most of the view; the menu and the game sit exactly on the glass. The world keeps going round it at a lower frame rate |
| On a phone or a narrow window | Once the camera is there, the cabinet fills the screen with the on-screen controller, and the world stops drawing behind it (battery and heat) |

Inside the cabinet: the library (every game with its attract screen and your best), then the game, then the results
(score, stars, new best, your place, experience, Virtual Coin prizes, new badges, the top 10). **Esc** or the pause
button pauses (Resume, Restart, Games, Leave). Leaving mid-game records nothing.

Without an account that may play, a game is a **practice** game: played the same, nothing kept.

### Controls

Every game reads the same standard controller: ▲ ▼ ◀ ▶, **A**, **B** and **Start** (pause).

| Input | Mapping |
|---|---|
| Keyboard | Arrows or WASD; A = Z, J or Space; B = X or K; Start = Enter or P; Esc pauses or leaves |
| Game controller (Xbox, PlayStation, 8BitDo…) | D-pad or left stick; A = bottom face button (or top); B = right face button (or left); Start pauses; Select goes back |
| Phone or tablet | The on-screen pad the game asks for: `dpad` (a cross with A and B), `lr` (◀ ▶ with A and B) or `tap` (no pad: the game's own screen is the controller, so the screen gets the room; only the pause button). A or B shows only when the game names it. The pad hides when a controller is connected |
| Touches on the game's screen | A game's own gestures (Block Drop: tap to turn, swipe across to move, flick down to drop, hold down to drop faster; Neon Snake and Road Hopper: swipe to steer or hop, and in Road Hopper a tap hops forward) |
| Pointer (games that read it) | Brick Blitz: drag a finger anywhere on the screen, or move the mouse over it, and the paddle follows; a tap or a click launches. City Shield: a touch or a click fires at that spot at once (`pointer: { down: 'A' }`) |
| A press on the screen | Flap Dash: a touch or a click flaps the moment it goes down (`gestures: { press: 'A' }`) |

A press always lasts at least 50 ms, however quick the tap or key, so the game (60 steps a second) never misses one.
Several fingers work at once, and each pad button reacts a little beyond its drawn edge.

Sound effects are synthesised (no sound files) and follow Settings → Sound → **Aircraft and games** and the top bar's
mute. Android phones buzz on presses, drops and hits.

## How it is built

| Part | File | What it does |
|---|---|---|
| Core | `shared/arcade/core.js` | The 60 Hz step, the seeded dice, a deterministic sine table, the input log (what was held at every step) and the replay |
| Games (rules) | `shared/arcade/games/<id>.js` | Each game's sim: `init(seed)`, `step(state, input)`, `over`, `score`, `detail` |
| Library | `shared/arcade/catalog.js` | Each game's title, controls, gestures, stars and difficulty; its kind (`builtin`; later `package`, `emulator`) |
| Play module | `shared/arcade.js` | The `arcade` play module: each built-in game is a course; `prepare` gives a seed, `verify` replays the run |
| Game box | `client/arcade/box.html`, `client/arcade/kit.js` | The sealed frame a game runs in, and the kit that steps the sim, records the input and talks to the cabinet |
| Drawing | `client/arcade/fx.js`, `client/arcade/games/<id>.js` | Our pixel font, glows, particles, shake, starfield, CRT layer; each game's screen and its attract screen (`cover`). A 3D game (Turbo Rush) draws with three.js (`/vendor/three/build/`, served to the box like the arcade's own scripts) and its words on a 2D layer over it |
| Cabinet | `client/js/play/arcade.js` | Attract screens and marquees on the cabinets, ▶ Play, the camera glide, the library, pause, results and leaderboards |
| Controller | `client/js/play/arcade-pad.js` | Keyboard, game controllers, the on-screen pad, gestures |
| Sound | `client/js/play/arcade-sound.js` | The synthesised effects and the phone buzz |
| Model | `client/js/render/furniture.js` `D.arcade`, `ARCADE_SCREEN` | The upright cabinet (side panels with T-molding and a lit strip, control panel, recessed screen, lit marquee, coin door) |

Each game is a course of the play module, so the platform's levels, ranks, badges, profiles, leaderboards and Game
prizes all apply (see [play modules](play-modules.md)).

## Verified scores

The browser never sends a score the server believes. A run goes like this:

1. `POST /api/play/start` `{ module: 'arcade', course: <game> }` returns the run's **seed**.
2. The game box steps the game 60 times a second from that seed and records the buttons held at every step: runs of
   `[value, steps]`, varint-coded, base64 (a few kilobytes for a long game).
3. `POST /api/play/finish` `{ run, report: { log, score, ticks } }`: the server plays the same game again from the seed
   with the same buttons and records **its own** score.

A run is refused when the log can't be read, the game had not ended, or it claims more game time than really passed
(plus 5 s for the network). The browser's claimed score is kept with the run only when it differs (to catch bugs).

For this to work a game's rules must step to exactly the same state in every browser and on the server:

- `+ − × ÷` and `Math.sqrt/floor/round/abs/min/max/imul` only (every engine rounds these the same, whole numbers or not);
- never `Math.sin/cos/atan2/pow/exp/random` (their last bits differ between engines): angles come from the core's
  `SIN`/`COS` tables (1024 to a turn, in 1/4096ths), dice from `roll(state, n)`;
- no clocks, no DOM, no async; the state is plain data;
- effects for the screen and the speaker go in `state.ev` and never change the game.

`tests/arcade.test.mjs` checks this with bots and random hands: the same seed and buttons give the same score, the
same number of steps and the same dice, every time.

## The sealed game box

A game runs in `client/arcade/box.html`, in an `<iframe sandbox="allow-scripts">`: it has an origin of its own, so it
can't reach the page, the account, cookies or storage. The server sends the box this Content Security Policy:

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
connect-src 'none'; font-src 'self'; media-src 'none'; worker-src 'none'; frame-src 'none';
form-action 'none'; base-uri 'none'; frame-ancestors 'self'
```

So a game can't make a network request either. The scripts under `/arcade/` and `/shared/arcade/` are served with
`access-control-allow-origin: *` (a sandboxed frame's requests come from an opaque origin). The box never takes the
keyboard focus: the cabinet reads every input and sends it on.

### The box protocol (kit v1)

Messages are `{ mvwArcade: 1, t, … }` through `postMessage`; each side checks the other's window.

| Direction | Message | Meaning |
|---|---|---|
| cabinet → box | `init { seed, best, practice }` | Start a game |
| cabinet → box | `in { v }` | The buttons held now (bits 0–5: U D L R A B) and, for a game with `pointer` in the library, where the pointer is (bits 8–15 across, 16–23 down, 0 to 255) and whether it aims (bit 24: a finger down, or the mouse over the screen) |
| cabinet → box | `pause`, `resume` | |
| box → cabinet | `ready { id }` | The game is loaded |
| box → cabinet | `sfx { l: [[name, param], …] }` | Sound effects to play this frame |
| box → cabinet | `buzz { ms }` | A phone buzz |
| box → cabinet | `engine { v }` | A racing game's engine: 0 to 1 sets its note (ten times a second at most), below 0 stops it |
| box → cabinet | `over { score, ticks, log, detail }` | The game ended: the run's report |
| box → cabinet | `error { msg }` | The game could not start |

The same protocol is meant for the later kinds of game: a player's own game would use a small kit with these
messages, and an emulator adapter (Local only) would map the same buttons onto the emulated pad.

## Adding a built-in game

1. Write its rules in `shared/arcade/games/<id>.js` (`init`, `step`, `over`, `score`, `detail`), keeping to the
   determinism rules above, and add it to `shared/arcade/sims.js`.
2. Add it to `shared/arcade/catalog.js`: title, controls layout and button names, gestures, keys hint, difficulty and
   three star thresholds.
3. Write its screen in `client/arcade/games/<id>.js`: `createView(canvas)` with `reset`, `event`, `sfx`, `buzz`, `draw`,
   `pause`, `resize`, and `cover(ctx, w, h, t, { top })` for the attract screen. Draw in the 360 × 480 logical screen
   with `client/arcade/fx.js`.
4. Add a bot to `tests/arcade.test.mjs` (it must clear something, end, and replay to the same game) and run
   `tools-bin/arcade-check.mjs` in the lab.

## Performance

- A game draws only while someone plays it, in its own frame. Its screen is a 2D canvas at the device's pixels;
  text, glows, tiles and sprites are drawn once into small canvases and stamped on whole device pixels.
- On a phone the world stops drawing while the cabinet fills the screen; on a computer the world round the screen
  draws at the covered pace (20 frames a second).
- Attract screens: one small canvas per game (240 × 320) shared by every cabinet showing it, redrawn 8 times a second
  (4 on a phone) only while a cabinet is within 8 m of the camera and in view, at most two a frame, and not at all
  while a machine's game is played (they are its background); the marquee is drawn once. Their canvases are kept in
  memory, not on the GPU, and copied without mipmaps: on a phone a copy from a GPU canvas, a dozen at once every
  eighth of a second, made the long frames that halved a busy arcade's frame rate (2026-10-24, the OnePlus: a game
  played among ~90 visitors went from ~30 to ~60 frames a second). Only the floor being looked into has them.
- A machine's game counts as moving for the frame pacing (core/framepace.js): on a phone it draws up to 60 a second
  with the finger resting (it fell to 30 after four seconds still); its LED panel's canvas is kept in memory like the
  attract screens'.
- Lab on the phone: tools-bin/arcade-perf-phone.mjs (the app's own frames, their spacing, its JavaScript a frame,
  A/B with the characters, the screens or the shadows off, a CPU profile); tools-bin/perf-material-churn.mjs (materials
  that make three.js look its program up again each frame); tools-bin/perf-census.mjs (a view's triangles by place and
  material).
- The server does no work per frame: a run is two requests, and the replay of a long game takes milliseconds.

## The library

| # | Game | Plays like | Controls | State |
|---|---|---|---|---|
| 1 | Block Drop | falling blocks (pieces of 3, 4 and 5 blocks in an 11-wide well; our own pieces, board and look). Speed: the classic arcade curve, a level every 8 lines | cross, A/B, gestures | ✅ |
| 2 | Star Siege | a fixed shooter (our own drones, shield pods and saucer) | ◀ ▶, A | ✅ |
| 3 | Neon Snake | snake (a level every 5 orbs, faster; pillars from level 3; the gold orb) | cross, swipes | ✅ |
| 4 | Brick Blitz | a brick breaker (6 walls of our own, 2- and 3-hit bricks, steel, 5 capsules) | ◀ ▶ or drag / mouse, A | ✅ |
| 5 | Rock Drift | space rocks (a wrapping field, splitting rocks, the raider saucer, warp) | cross (turn, thrust), A fire, B warp | ✅ |
| 6 | Road Hopper | a road and river crossing (traffic, logs, sinking glow-rafts, 5 portals, the firefly) | cross, swipes, tap | ✅ |
| 7 | Turbo Rush | a 3D racer (three.js in the box) in a red Italian-style supercar: five daytime stages of 2 km (coastal highway, green valley, desert canyon, metro city, alpine pass; then round again at sunset), each with its own scenery, traffic and a checkpoint that adds time; three rivals start beside you and wait further on, as quick as you: they boost on a clear road, weave through the traffic (the first oncoming lane too), catch up when you pass them, and alongside you may slam you off your line (a horn and a red ! first); reach the checkpoint ahead of them for a 1st or 2nd place bonus (time and points, POS on screen); near misses (close calls pay double), slipstreams and the oncoming lanes fill the boost and grow the multiplier (up to x10); boosting into a rival, or a hard side-swipe, is a takedown that refills the boost; a whole boost bar without a crash is a boost chain. The car holds its line through the bends and changes lanes in about 0.4 s, eased in and out, its nose turned only a few degrees; its sound: an engine through six gears (revs climb, drop at each shift), wind and road noise that grow with the speed, a turbo whistle and a rush of air on boost, tyres squealing in a hard swerve or a slam, a whoosh past each near miss and a horn from a car you scrape past (Settings → Sound → Aircraft and games); marker posts, poles, lamps and road joints along the way, a wider view and a road buzz at speed | ◀ ▶ steer, A boost, B brake | ✅ |
| 8 | Flap Dash | a one-button flyer (Pip the bird-bot, crystal pylons, swaying ones from 15, star orbs) | tap / A | ✅ |
| 9 | Maze Dash | a maze chase (our maze; Zip and four drones that hunt each their own way; power cores, a bonus chip) | cross, swipes | ✅ |
| 10 | City Shield | sky defence (tap to burst interceptors, chains, splitting missiles, bombers, six domed cities) | tap / click, or cross + A | ✅ |
| 11–20 | Swarm, Paddle Duel, Bug Blaster, Scaffold Scramble, Dig Deep, Moon Lander, Gem Drop, Skyline Raider, Tank Arena, Neon Pinball, Cube Hop | | | planned |

Game ideas are free to use; the look, characters and names of the famous games are not. Every game here has its own.

## The machines

Every arcade piece people play at is a game of its own, played for real on the machine itself (2026-10-24, the
product owner: "every single machine or game that isn't decorative has to be a real mini game players can play", then
"No I meant like actually playing not a second gaming version. Like with the 3D asset you created it becomes its own mini
game"). Play at the machine (a click on it looking inside, or **E** beside it in player mode) brings the camera down to
where its player's eyes are (stepped back on a phone held upright until the whole machine is in view), and the game
happens on the machine in the world: the skee-ball rolls up its own lane, leaps its hump and drops into its cups, the
moles come up out of its own holes under a foam mallet, the basketball flies to its own rim and through its net. The
machine's own LED panel shows the score. Over the world only a slim bar (the game, its score, its line, pause, leave),
the power meter while charging, a few words, points rising from the machine and the pause and results cards; the
world's own panels step aside meanwhile. The racing cabinet has a screen of its own: Turbo Rush plays on it, as a cabinet
plays its library.

| Machine | Game | How it plays | Controls | State |
|---|---|---|---|---|
| Whack-a-Mole | Mole Mayhem | sixty seconds, the machine's five holes: whack the moles as they pop up (10, more the sooner), gold ones 50, the ones in a hard hat with a bomb cost 25 and stun; five in a row raises the multiplier (×5 at most); the last ten seconds a frenzy | the pointer (a finger, the mouse) on a hole, a tap whacks; or ◀ ▶ along a row, ▲ ▼ between the rows, and A | ✅ |
| Skee-Ball | Skee Roll | nine balls up the lane (they slow as they climb), over the hump onto the ring board: cups 10 to 50, the corner pockets 100; three 50s or 100s in a row, a 100 bonus | aim (◀ ▶ or the pointer), hold to charge, let go | ✅ |
| Basketball Hoops | Hoop Fever | forty-five seconds; real arcs off the rim, the backboard and the side nets: a basket 2, a swish 3; three in a row ON FIRE (double till a miss); the last fifteen seconds the rim slides along its track and every basket is worth 1 more | aim, hold to charge, let go | ✅ |
| Racing Cabinet | Turbo Rush | the cabinets' 3D racer, on the racing cabinet's own screen | ◀ ▶, A, B | ✅ |
| Punching Machine | Power Punch | three punches at the machine's own ball: it folds down on its arm, a light runs back and forth along the timing strip over it; wind up (the power climbs, then fades if held too long) and let go: the strength (up to 999) is the power times how near the middle the light was, a full wind-up dead centre a PERFECT (100 more); the ball knocked back, the screen counts it up and calls it (lightweight … champion); the score is the three together | hold A (a finger, the mouse button), let go | ✅ |
| Claw Machine | Claw Catch | five tries inside the machine's own glass: steer the claw (a faint beam and a lit spot under it show where it is), drop it: right over a prize it holds, to one side it may slip on the way up; what it holds goes to the chute: bears 100, bunnies 150, dinosaurs 250, the golden star 1000 (hard to hold); twenty seconds a try, then it drops where it is; all five won, 500 more | ▲ ▼ ◀ ▶ (▲ away from you) or the pointer on the glass, A or a tap drops | ✅ |
| Mechanical Bull | Bull Rider | ride the bull itself, the camera in your eyes over its horns: it bucks, rears, spins and throws you to a side, wilder every ten seconds; each move pushes you off your seat, lean against it (a balance ring shows how far you lean), past the edge you are thrown onto the mat; ten points a second (more when wilder), eight seconds 100, a move ridden out smoothly 25, sixty seconds and the bull is tamed (500) | ◀ ▶ ▲ ▼ lean, or hold the pointer the way you lean | ✅ |
| Air Hockey | Puck Rush | you at the near end against the computer: first to seven, or the most in two minutes; the table's own puck and strikers, the puck gliding off the rails and off each striker as hard as it moved; a goal 100, a hard one (SLAP SHOT) or one off a rail (BANK SHOT) 50 more, stopping a hard shot in front of your goal (SAVE) 20; a win 500, a shutout 300 more; the computer quicker with every goal you score; the scoreboard over the far goal | the pointer on the table moves your striker (as fast as a hand); or ▲ ▼ ◀ ▶, A quicker | ✅ |
| Foosball | Foos Frenzy | your red rods against the computer's blue: first to five, or the most in three minutes; the table's own rods slide to where you point (each its man nearest there) and kick together, the feet lifting as they follow through so your shot passes over your own men; men standing still stop the ball; a goal 100, from your goalie or defence (LONG SHOT) 100 more, within three seconds of the serve (QUICK GOAL) 50 more, a block by your goalie or defence 10; a win 500, a shutout 300 more; a dead ball is served again; the score panel on the far side | the pointer slides your men, a click or a tap kicks; or ▲ ▼ and A | ✅ |
| Pinball | Star Pinball | three balls on the machine's own tilted playfield: the plunger, the arch, three pop bumpers (100), two slingshots (10), three drop targets (200; all three 1000 and the multiplier up), three rollover lanes (50; all three 500 and the multiplier up; a flipper moves the lit ones along), a SKILL SHOT (the flashing lane first after a launch: 1000), a ball saved in its first six seconds, the bonus counted at the drain times the multiplier (×5 at most); a ball stuck is kicked free | ◀ ▶ (or B, A) the flippers, ▼ (or A) held and let go the plunger; on a screen each half holds its flipper | ✅ |
| Billiards | Pool Shark | eight-ball against the computer on the table's own sixteen balls (racked by the dice: the 1 at the apex, the 8 in the middle, a solid and a stripe at the back corners): you break; the first ball potted on a fair shot makes the groups; pot yours to shoot again; a foul (the cue ball potted, nothing hit, the other group's ball first) passes the turn and a scratch puts the cue ball back on the head spot; the 8 to win once your group is cleared (early, you lose; on the break it is spotted again); a ball 100, each further pot in a run 50 more, a win 1000 and 100 for each of the computer's left; the computer picks the clearest pot by the ghost ball, its hand a little unsteady; twenty seconds a shot, three let run out in a row and the game is the computer's; a guide shows the line, the ghost ball and the object ball's way (red: not yours); the score on the lamp over the table | the pointer aims the cue (sent as an angle, fine enough for a thin cut); hold A (the mouse button, a finger, Z), the power rising and falling, let go to strike; ◀ ▶ fine aim, ▲ ▼ more | ✅ |
| Mini Bowling | Strike Lane | ten frames scored as bowling is (a strike ten and the next two balls, a spare ten and the next one, 300 at most) on the lane's own ten pins: the ball rolls from where you stand toward where you aim, off the lane into the gutter; pins hit hard enough fall, slide into the others, off the kickbacks, into the pit, one only grazed wobbles and stays; into the pocket at an angle is where the strikes are, straight at the head pin fewer, off the middle none; it takes a steady hand (2026-10-26): while the power builds the aim sways about the mark, more the harder the throw, so you let go as it crosses it, and a hard throw skids a little off its line (`WOB`; a casual game about 120, a skilled one about 190, was 240); a sweep bar clears the fallen, a fresh rack drops in; the camera goes down the lane with the ball; left eight seconds, a soft roll anywhere | the pointer aims, ◀ ▶ where you stand, hold A and let go to roll (as the swaying line crosses your mark) | ✅ |
| Dance Machine | Neon Steps | arrows rise up the machine's own screen to 120 beats a minute (a count-in, thirty-two bars written by the dice from the seed, busier every eight: eighth notes, then jumps); PERFECT (within 2/60 s) 100, GREAT 70, GOOD 30, times the combo (×2 at fifty in a row), a MISS drains the life bar (empty: the song stops); a FULL COMBO 2000 more, the life left ten a point; the beat played as it goes (kick, snare, hats, a bass line, a chord each bar, synthesised) | ◀ ▼ ▲ ▶; on a screen, a tap toward that side | ✅ |

How it is built: a machine's measurements are in one place, shared/arcade/machines.js (WHACK, SKEE, HOOPS, RACING, BOXER,
CLAW, BULL, HOCKEY, FOOS with foosMen, PIN with pinAt, POOL with poolRack, BOWL with bowlPins, DANCE),
used by its 3D model (client/js/render/furniture-arcade.js), its rules (shared/arcade/games/<id>.js) and its game in the
world (client/js/play/machines/<id>.js), so the ball the server plays again is the ball that went through the hoop on
the screen. client/js/play/machine-play.js runs a game in the world: the camera (pinned, a wider lens and a near plane
for the ball in hand while it lasts), the sim stepped 60 times a second with the buttons (./arcade-pad.js: keyboard,
controllers, the pointer; `pointer: { hold: 'A' }` holds A while a finger or the mouse button is down, a charge), every
step's buttons sent to the server for its own replay (the play module 'arcade', as the cabinets'), the machine's parts
moved by the game (render/venue-motion.js asks it first: the whack-a-mole's own moles and mallet put away while the game's
are out, the hoop's rim slid, the claw machine's own prize pile and claw put away while the game's are out, the bull
turned and rocked on its pole, the punching ball knocked back, the air hockey table's puck and strikers, the foosball
rods slid and turned, the pinball's flippers, ball, drop targets and plunger, the pool table's balls rolled and its cues
put away, the bowling lane's pins tumbled), the LED panel (a canvas over the machine's
screen, or turned to face another way: the foosball table's on its far side; a long word drawn smaller so it fits; or
drawn by the game itself every frame, `paint`: the dance machine's arrows), sparks and points in the world, the results with stars, the board, experience and badges.
A game in the world gives create({ THREE, group, play, app }) → { camera, cameraNow, board, update, event, sfx, buzz,
part, pointer, hud, reset, dispose } (cameraNow: a camera that moves with the game, the rider on the bull; hud.balance:
the balance ring).

A player at a piece keeps it: the sim gives that place to nobody else for the next half hour of world time, and anyone
on their way to it goes elsewhere the moment the player sits down or starts to play (server/sim/agents.js `playerOn`,
`playerTook`; server/world/players.js `onUse`). A table played against the computer (catalog `cpu: true`: air hockey,
foosball, billiards) is all the player's: nobody is sent to its other end either. And a machine whose game is open is all its player's
wherever they are (looking in from above too; 2026-10-26: agents had walked up to a pool table a player was playing): the
game holds it as it opens (POST /api/arcade/hold, server/play/arcade-hold.js; again every 30 s, let go as it closes, a
hold lapses 75 s after the last; one machine per account, a machine another player holds is busy), and the sim sends
anyone at it or on the way elsewhere at once and lets nobody take a spot of it (server/sim/agents.js `holdPiece`).
Cabinets the same. Lab: tools-bin/machine-games-check.mjs (each machine clicked, its game
played to the end with the keyboard, the server's score). Without a browser (a machine too short of memory for one):
tools-bin/machine-views-check.mjs drives each game's part in the world through whole games in Node with the real
three.js (events, parts, camera, pointer, a painted screen) and builds each machine's model with its parts. On the
phone: tools-bin/machine-games-phone.mjs plays each on the OnePlus over USB (adb, its own Chrome over DevTools) with the
touch screen as a player would (taps, held touches, a finger on the table, two fingers for a jump), the frames a
second, ✕ and Leave. On a screen held upright a game may look another way (view.camera.narrow): the foosball table from
behind your goal with the field running up the screen, the pool table with its lamp put aside (noBoard: the score in
the bar). The bar over the game keeps one width, so ⏸ and ✕ never move under a finger.
