// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's library (docs/features/arcade.md): every game a cabinet can play, as the cabinet's menu and the server
// see it. A game is one of
//   builtin   ours: a deterministic sim in shared/arcade/games/<id>.js and its screen in client/arcade/games/<id>.js;
//             the server plays every finished run again (shared/arcade.js) — verified scores, prizes, leaderboards
//   package   (later) a player's own game, reviewed, hosted as a frozen copy, run in the sealed box with the arcade kit's
//             protocol; community scores (not verified), no prizes
//   emulator  (later, self-hosted Local only) an emulator adapter with the owner's own game file, the same protocol
// A game played at a machine of its own (2026-10-24, the product owner: "on the arcade every single machine or game that
// isn't decorative has to be a real mini game players can play"): `machine` is the arcade piece (shared/catalog.js) that
// plays it — Play at that piece opens the game itself, no library; `cabinet: false` keeps it off the cabinets' library
// (a machine's own game: the skee-ball lane, the hoops). The play module makes every built-in game a course, so each
// has its leaderboard, stars and verified scores. `cpu: true`: a two-sided table played against the computer, so the
// player holds all of it (nobody else is sent to its other end: server/sim/agents.js playerOn).
// Each game says how it is played: `controls.layout` is the on-screen controller a phone shows (client/js/play/arcade-pad.js):
//   'dpad'  a cross (four ways) with A and B      'lr'  ◀ ▶ with A (B when named)
// and the names of its buttons; `gestures` (optional) what touches on the game's screen itself do.
export const GAMES = Object.freeze([
  {
    id: 'block-drop', kind: 'builtin', title: 'Block Drop', icon: '🧱', like: 'falling blocks',
    blurb: 'Pieces of three, four and five blocks fall into the well. Fill rows to clear them; clear five at once for a Blockbuster.',
    color: '#8b5cf6', accent: '#22d3ee',
    controls: { layout: 'dpad', up: 'Drop', down: 'Faster', a: 'Turn', b: 'Turn back' },
    gestures: { tap: 'A', swipeX: true, flickDown: 'U', holdDown: 'D' },
    keysHint: '◀ ▶ move · ▼ faster · ▲ drop · Z / X turn',
    difficulty: 3, stars: [2000, 8000, 20000],
  },
  {
    id: 'star-siege', kind: 'builtin', title: 'Star Siege', icon: '🚀', like: 'a fixed shooter',
    blurb: 'Hold the line against a marching drone fleet. Hide behind the shield pods, hit the command saucer, clear the wave.',
    color: '#22d3ee', accent: '#f472b6',
    controls: { layout: 'lr', a: 'Fire' },
    keysHint: '◀ ▶ move · Z / Space fire (hold)',
    difficulty: 3, stars: [1500, 4000, 9000],
  },
  {
    id: 'neon-snake', kind: 'builtin', title: 'Neon Snake', icon: '⚡', like: 'snake',
    blurb: 'Eat the orbs and grow. Every five orbs it gets faster, and from level 3 pillars rise. Catch the gold orb while it lasts.',
    color: '#22c55e', accent: '#a3e635',
    controls: { layout: 'dpad' },
    gestures: { swipe4: true },
    keysHint: '▲ ▼ ◀ ▶ steer',
    difficulty: 2, stars: [300, 1000, 2500],
  },
  {
    id: 'brick-blitz', kind: 'builtin', title: 'Brick Blitz', icon: '🏓', like: 'a brick breaker',
    blurb: 'Keep the ball in play and break the wall. Catch the capsules: Wide, Multi-ball, Slow, Life, Bonus. Steel never breaks.',
    color: '#f472b6', accent: '#fbbf24',
    controls: { layout: 'lr', a: 'Launch' },
    pointer: { tap: 'A' },
    keysHint: '◀ ▶ or the mouse · Z / Space launch',
    difficulty: 3, stars: [2000, 6000, 15000],
  },
  {
    id: 'rock-drift', kind: 'builtin', title: 'Rock Drift', icon: '🪨', like: 'space rocks',
    blurb: 'Drift through a field of rocks and blast them to dust. Big rocks split; watch out for the raider saucer.',
    color: '#38bdf8', accent: '#f97316',
    controls: { layout: 'dpad', up: 'Thrust', a: 'Fire', b: 'Warp' },
    keysHint: '◀ ▶ turn · ▲ thrust · Z fire · X warp',
    difficulty: 4, stars: [2000, 6000, 15000],
  },
  {
    id: 'road-hopper', kind: 'builtin', title: 'Road Hopper', icon: '🏁', like: 'a road and river crossing',
    blurb: 'Hop across the traffic and the river into the five portals at the top. Rafts sink now and then; catch the firefly.',
    color: '#a3e635', accent: '#38bdf8',
    controls: { layout: 'dpad' },
    gestures: { swipe4: true, tap: 'U' },
    keysHint: '▲ ▼ ◀ ▶ hop',
    difficulty: 3, stars: [800, 2500, 6000],
  },
  {
    id: 'turbo-rush', kind: 'builtin', title: 'Turbo Rush', icon: '🔥', like: 'a traffic racer (3D)', render: '3d',
    blurb: 'Race a red supercar through five daytime stages against the clock and three rivals who boost and slam. Near misses fill your boost; boost into a rival for a takedown.',
    color: '#f43f5e', accent: '#22d3ee', machine: 'racing_sim',
    controls: { layout: 'lr', a: 'Boost', b: 'Brake' },
    keysHint: '◀ ▶ steer · Z / Space boost · X brake',
    difficulty: 4, stars: [15000, 60000, 200000],
  },
  {
    id: 'flap-dash', kind: 'builtin', title: 'Flap Dash', icon: '✨', like: 'a one-button flyer',
    blurb: 'Tap to flap Pip through the gaps in the crystal pylons. One touch and it is over. Grab the star orbs; watch the swaying ones.',
    color: '#fbbf24', accent: '#38bdf8',
    controls: { layout: 'tap', a: 'Flap' },
    gestures: { press: 'A' },
    keysHint: 'Space / Z / ▲ or a click flaps',
    difficulty: 2, stars: [10, 30, 60],
  },
  {
    id: 'maze-dash', kind: 'builtin', title: 'Maze Dash', icon: '🌀', like: 'a maze chase',
    blurb: 'Collect every spark in the maze while four drones hunt you. Grab a power core and turn the tables.',
    color: '#22d3ee', accent: '#e879f9',
    controls: { layout: 'dpad' },
    gestures: { swipe4: true },
    keysHint: '▲ ▼ ◀ ▶ steer (a turn waits for its corner)',
    difficulty: 3, stars: [3000, 8000, 18000],
  },
  {
    id: 'city-shield', kind: 'builtin', title: 'City Shield', icon: '🎯', like: 'sky defence',
    blurb: 'Tap the sky to burst interceptors and save the six cities. Catch missiles in a blast to set off chains.',
    color: '#fb923c', accent: '#a78bfa',
    controls: { layout: 'tap', a: 'Fire' },
    pointer: { down: 'A' },
    keysHint: 'click to fire · or ▲ ▼ ◀ ▶ aim, Z fire',
    difficulty: 3, stars: [3000, 9000, 20000],
  },
  // ---- the arcade's machines, each its own game (played at the machine: not on the cabinets)
  {
    id: 'mole-mayhem', kind: 'builtin', title: 'Mole Mayhem', icon: '🛠', like: 'whack-a-mole', machine: 'whack_mole', cabinet: false,
    blurb: 'Sixty seconds, nine holes. Whack the moles as they pop up: gold ones pay big, the ones with a bomb cost you. Combos multiply; the last ten seconds are a frenzy.',
    color: '#14b8a6', accent: '#fde047',
    controls: { layout: 'tap', a: 'Whack' },
    pointer: { down: 'A' },
    keysHint: 'the mouse aims, click whacks · or ▲ ▼ ◀ ▶ and Z',
    difficulty: 2, stars: [1500, 4000, 7000],
  },
  {
    id: 'skee-roll', kind: 'builtin', title: 'Skee Roll', icon: '🎯', like: 'skee-ball', machine: 'skeeball', cabinet: false,
    blurb: 'Nine balls up the lane and over the hump. Aim, hold to charge, let go: the cups pay 10 to 50, the corner pockets 100. Three big ones in a row: a bonus.',
    color: '#f59e0b', accent: '#e879f9',
    controls: { layout: 'tap', a: 'Charge' },
    pointer: { hold: 'A' },
    keysHint: '◀ ▶ aim · hold Z, let go to roll · or hold the mouse',
    difficulty: 2, stars: [250, 450, 700],
  },
  {
    id: 'hoop-fever', kind: 'builtin', title: 'Hoop Fever', icon: '🏀', like: 'basketball hoops', machine: 'hoop_shot', cabinet: false,
    blurb: 'Forty-five seconds to sink as many as you can. A basket is 2, a swish 3; three in a row and you are on fire. In bonus time the hoop slides.',
    color: '#f97316', accent: '#fde047',
    controls: { layout: 'tap', a: 'Shoot' },
    pointer: { hold: 'A' },
    keysHint: '◀ ▶ aim · hold Z, let go to shoot · or hold the mouse',
    difficulty: 3, stars: [60, 140, 240],
  },
  {
    id: 'power-punch', kind: 'builtin', title: 'Power Punch', icon: '🥊', like: 'a punching machine', machine: 'boxer', cabinet: false,
    blurb: 'Three punches at the machine. Hold to wind up, let go when the light is in the green: the harder and truer the punch, the higher it reads. A perfect one: 100 more.',
    color: '#dc2626', accent: '#fde047',
    controls: { layout: 'tap', a: 'Punch' },
    pointer: { hold: 'A' },
    keysHint: 'hold Z (or the mouse), let go to punch',
    difficulty: 2, stars: [1200, 2000, 2700],
  },
  {
    id: 'claw-catch', kind: 'builtin', title: 'Claw Catch', icon: '🧸', like: 'a claw machine', machine: 'claw_machine', cabinet: false,
    blurb: 'Five tries at the claw. Steer it over a prize, drop it: right over one it holds, to one side it may slip. Bears 100, bunnies 150, dinosaurs 250, the golden star 1000.',
    color: '#f472b6', accent: '#22d3ee',
    controls: { layout: 'tap', a: 'Drop' },
    pointer: { tap: 'A' },
    keysHint: '▲ ▼ ◀ ▶ or the mouse steer · Z or a click drops',
    difficulty: 3, stars: [300, 800, 1500],
  },
  {
    id: 'bull-rider', kind: 'builtin', title: 'Bull Rider', icon: '🐂', like: 'a mechanical bull', machine: 'mech_bull', cabinet: false,
    blurb: 'Ride the mechanical bull as long as you can: it bucks, rears, spins and throws, wilder every ten seconds. Lean against it to stay on. Eight seconds: a bonus; sixty: the bull is tamed.',
    color: '#b45309', accent: '#facc15',
    controls: { layout: 'dpad' },
    keysHint: '◀ ▶ ▲ ▼ lean · or move the mouse the way you lean',
    difficulty: 3, stars: [300, 900, 2000],
  },
  {
    id: 'puck-rush', kind: 'builtin', title: 'Puck Rush', icon: '🏓', like: 'air hockey', machine: 'air_hockey', cabinet: false, cpu: true,
    blurb: 'Air hockey against the computer: first to seven, or the most in two minutes. A goal 100; a slap shot or a bank shot 50 more; a save 20; a win 500, a shutout 300 more. The computer gets quicker with every goal you score.',
    color: '#ef4444', accent: '#22d3ee',
    controls: { layout: 'tap' },
    pointer: {},
    keysHint: 'the mouse (or a finger) on the table moves your striker · or ▲ ▼ ◀ ▶, Z to go quicker',
    difficulty: 3, stars: [500, 1400, 2200],
  },
  {
    id: 'foos-frenzy', kind: 'builtin', title: 'Foos Frenzy', icon: '⚽', like: 'foosball', machine: 'foosball', cabinet: false, cpu: true,
    blurb: 'Foosball against the computer: first to five, or the most in three minutes. Your red men follow where you point and kick together; their feet lift as they follow through, so your shots pass over your own men. A goal 100, a long shot 100 more, a quick goal 50 more, a block 10; a win 500, a shutout 300 more.',
    color: '#16a34a', accent: '#f87171',
    controls: { layout: 'tap' },
    pointer: { down: 'A' },
    keysHint: 'the mouse (or a finger) slides your men · a click, a tap or Z kicks · or ▲ ▼ and Z',
    difficulty: 3, stars: [400, 1000, 1500],
  },
  {
    id: 'star-pinball', kind: 'builtin', title: 'Star Pinball', icon: '🌟', like: 'pinball', machine: 'pinball', cabinet: false,
    blurb: 'Three balls. Launch with the plunger, keep the ball up with the flippers: pop bumpers, slingshots, three drop targets and three rollover lanes (each set raises the bonus multiplier), a skill shot at launch and a ball saved in its first six seconds.',
    color: '#7c3aed', accent: '#facc15',
    controls: { layout: 'tap' },
    pointer: { sides: ['B', 'A'] },
    keysHint: '◀ ▶ flippers · hold ▼ (or Space) and let go to launch · on a screen, hold its left or right half',
    difficulty: 3, stars: [5000, 15000, 30000],
  },
  {
    id: 'pool-shark', kind: 'builtin', title: 'Pool Shark', icon: '🎱', like: 'eight-ball pool', machine: 'pool_table', cabinet: false, cpu: true,
    blurb: 'Eight-ball against the computer. You break; the first ball potted makes the groups. Pot yours to shoot again, clear them, then pot the 8 to win. A ball 100, more for a run; a win 1000 and 100 for each of the computer\'s left. Twenty seconds a shot.',
    color: '#0f8a5f', accent: '#facc15',
    controls: { layout: 'tap' },
    pointer: { hold: 'A' },
    keysHint: 'the mouse (or a finger) aims the cue · hold the button (or Z) and let go to strike · ◀ ▶ fine aim, ▲ ▼ more',
    difficulty: 3, stars: [400, 1200, 2000],
  },
  {
    id: 'strike-lane', kind: 'builtin', title: 'Strike Lane', icon: '🎳', like: 'mini bowling', machine: 'bowling_lane', cabinet: false,
    blurb: 'Ten frames of bowling with the real scoring: a strike ten and the next two balls, a spare ten and the next one, 300 at most. Aim, choose where you stand, and roll with the power you want: into the pocket at an angle is where the strikes are.',
    color: '#6d28d9', accent: '#fde047',
    controls: { layout: 'tap' },
    pointer: { hold: 'A' },
    keysHint: 'the mouse (or a finger) aims · ◀ ▶ where you stand · hold the button (or Z) and let go to roll',
    difficulty: 2, stars: [100, 160, 220],
  },
  {
    id: 'neon-steps', kind: 'builtin', title: 'Neon Steps', icon: '💃', like: 'a dance machine', machine: 'dance_machine', cabinet: false,
    blurb: 'Step on the arrows as they reach the top of the screen, in time with the beat: PERFECT, GREAT or GOOD, a combo for each in a row. Misses drain the life bar. A full combo: 2000 more.',
    color: '#7c3aed', accent: '#22d3ee',
    controls: { layout: 'tap' },
    pointer: { arrows: true },
    keysHint: '◀ ▼ ▲ ▶ step · on a screen, tap toward that side',
    difficulty: 3, stars: [8000, 18000, 28000],
  },
].map(g => Object.freeze({ aspect: [3, 4], cabinet: true, ...g })));

export const gameOf = id => GAMES.find(g => g.id === id) || null;
/** The game played at an arcade piece of type t (its machine), or null: a cabinet plays the library instead. */
export const machineGame = t => GAMES.find(g => g.machine === t) || null;
