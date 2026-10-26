# Changelog

My Virtual World, the self-hosted release (release 2). Release 1 was My Virtual World 1.0.

## v2.1.2 (2026-10-26)

- **A machine you play is yours while you play it**: when you open a machine's game or a cabinet (looking in, or as a
  player beside it), the whole machine is held for you until you leave: anyone at it or on the way goes elsewhere at
  once, and no agent or resident takes a spot at it (before, agents could walk up to a pool table you were playing and
  join in).
- **Strike Lane takes a steady hand**: the aim now sways while the power builds, more the harder you throw, so you let go
  as the line crosses your mark; a hard throw skids a little off its line, and the pins take a firmer hit to fall. A
  casual game scores about 120 instead of about 240; strikes are earned.
- **The racing seat fits a desktop window**: its screen (Turbo Rush on its own glass) was framed like a cabinet's, which
  is less than half its size, and ran off the window; the camera now steps back to fit the whole of each machine's
  screen, and again when the window is resized.

## v2.1.1 (2026-10-25)

- **The game's own soundtrack**: 26 original songs come with the game (the lounge's jazz, piano and bossa nova, the
  club's house, techno, trance, dubstep, reggaeton, hip hop and dance, and the game's own music) and go into the music
  library on the first start, ready for the Lounge Stages and DJ Stages. Each song goes in once; one an administrator
  deletes stays deleted; `MVW_SOUNDTRACK=off` leaves the library alone. The songs have a license of their own: they may
  be played only inside My Virtual World (server/music/soundtrack/LICENSE.md).

## v2.1.0 (2026-10-25)

The arcade (cabinets and machines you play), Floor Themes, nights out with live music and a music library, and
agents that live and work near their owner, in towns.

### The arcade
- **Arcade cabinets you can really play**: click a cabinet (or press E at one in player mode) and the camera glides to
  its screen, where the game runs on the glass; on a phone the cabinet fills the screen with an on-screen controller.
  The first two games of our own library: **Block Drop** (falling pieces of three, four and five blocks) and **Star
  Siege** (hold the line against a marching drone fleet). Every score is verified: the server plays the game again
  from the same seed and buttons. Leaderboards, stars, badges, experience and Game prizes; keyboard, game controllers
  and touch. A new cabinet model with a lit marquee showing its game, and attract screens with the top scores.
- **Four more arcade games**: **Neon Snake** (grow, speed up, dodge the pillars, catch the gold orb), **Brick Blitz**
  (break six walls of our own with capsules for a wide paddle, multi-ball and more; drag or use the mouse), **Rock
  Drift** (blast drifting space rocks, watch for the raider saucer, warp out of trouble) and **Road Hopper** (hop
  across traffic and a river of logs and sinking glow-rafts into five portals). Block Drop now speeds up like the
  classic arcade game, a level every 8 lines.
- **Ten arcade games now, one of them in 3D**: **Turbo Rush**, a 3D racer in a red Italian-style supercar through
  five daytime stages (coastal highway, green valley, desert canyon, metro city, alpine pass, then round again at
  sunset) against the clock and three rivals who boost, weave and try to slam you into the traffic (beat them to the
  checkpoint for a place bonus): near misses, close calls, slipstreams and the oncoming lanes fill the boost and grow a
  score multiplier, boost into a rival for a takedown, every checkpoint adds time. It sounds like a car: an engine that
  climbs through six gears, wind and road noise, a turbo whistle on boost, squealing tyres and passing whooshes; **Flap Dash** (tap to flap through
  crystal pylons), **Maze Dash** (collect every spark while four drones hunt you; power cores turn the tables) and
  **City Shield** (tap the sky to burst interceptors and save six cities; set off chains). Games whose screen is the
  controller give it the whole phone; a racing game's engine hums with its speed.
- **The arcade's own furniture**: 33 pieces in a new Arcade tab of the Furnish panel: billiards, a mini bowling lane, a
  mechanical bull, air hockey, claw machines full of plush toys, skee-ball, basketball hoops, pinball, a sit-down racer, a
  dance machine, whack-a-mole, a punching machine, foosball, a photo booth, a prize wall and prize case, a token machine,
  a snack bar, neon booths, high-top tables, gaming chairs, neon signs, pixel murals, LED pillars that cycle through the
  colours, floor light strips and a giant joystick. The Arcade theme now lays a floor out in zones with all of them:
  bowling along one side, a prize corner and a snack corner, a lounge, strips of attractions and cabinets by turns, claw
  machines by the front, lights everywhere; full but never crowded, on any size of floor. Residents play them.
- **The arcade's machines are games you play on the machine itself**: at the whack-a-mole machine the moles pop out of
  its own holes under your mallet (Mole Mayhem); at the skee-ball lane the ball rolls up the lane, leaps the hump and drops
  into the ring cups (Skee Roll); at the basketball hoops the ball flies to the rim and through the net (Hoop Fever); the
  racing cabinet plays Turbo Rush on its own screen; at the punching machine you wind up a glove and let go when the
  light is in the green, the ball knocked back and the screen calling the punch (Power Punch); in the claw machine you
  steer the claw over the bears, bunnies, dinosaurs and the golden star and drop it (Claw Catch); on the mechanical bull
  you ride it, leaning against its bucks and spins until it throws you onto the mat (Bull Rider); at the air hockey
  table you play the computer with the table's own puck and strikers (Puck Rush); at the foosball table your red rods
  slide and kick against the computer's blue (Foos Frenzy); the pinball machine has a real playfield with a plunger,
  flippers, pop bumpers, slingshots, drop targets, rollover lanes and a skill shot (Star Pinball); at the billiards
  table you play eight-ball against the computer with an aiming guide (Pool Shark); the mini bowling lane plays ten
  frames with real scoring, pins knocked down by the ball and by each other (Strike Lane); the dance machine scrolls
  arrows up its own screen to a beat, judged by your timing (Neon Steps). Every arcade machine that isn't decoration
  is now a game. The machine's own display shows your score; scores are verified, with stars and leaderboards. More machines follow. Agents no longer
  walk into a machine or seat a player is using, nor to the other end of a table you are playing against the computer.
- **Arcade machines played for real**: billiards (leaning over the table, a cue sliding over the bridge hand, the
  shot), air hockey (a striker in hand, the puck sliding), foosball (the rods twisting with the hands), whack-a-mole (a
  mallet, moles popping up and ducking), the punching machine (the ball knocked up by the punch), the claw machine (the
  claw following the joystick, dropping on the button), pinball (the flippers flicking) and the racing cabinet (the wheel
  turning with the hands): each its own animation, the machine moving with the player.
- **Smoother on phones**: a machine's game in the arcade now draws up to 60 frames a second on a phone (it fell to 30
  whenever the finger rested), and a busy arcade no longer stutters: the cabinets' attract screens were copied to the
  graphics chip a dozen at once, now a couple a frame, only those near and in view, and they hold still while you play
  a machine. Less work every frame everywhere: no material looked up again needlessly, the check for a window over the
  world ten times a second instead of every display frame, the time on the agents' screens formatted once a minute.

### Floor Themes
- **Floor Themes**: lay a floor out as an arcade, a lounge, a night club, a café, a restaurant, a shop, a gym, an open
  office or a conference floor (🎨 Floor Themes in the Furnish panel), generated to fit its size like the city's own
  floors and furnished further by hand. The Arcade fills a floor with playable cabinets on a neon carpet, with a prize
  counter, a snack corner, a lounge, ping-pong and dance games. A themed floor keeps its theme when re-rolled or when
  the building is resized; cafés, restaurants, shops and gyms become businesses residents visit. Floors can also have
  their own names (✏️ Name), shown on the floor buttons, when pointing at a floor and on the floor control.
- **The lounge, redone**: a modern organic lounge, elegant and softly lit, laid out as a place rather than a grid. In
  the middle of the room an island bar (a marble racetrack on a lacquered, brass-fluted front, stools all round, a
  bartender's well, a lit tower of bottles, a brass halo of hanging globes), or a round bar on a smaller floor, with
  high tables round it; your agents can work behind it. A big floor gets a salon behind panelled walnut walls with a
  low fireplace, bookcases, sofas and club chairs. A little stage with a velvet curtain, spotlights, a grand piano, a
  double bass and a microphone (ready for agents to play music one day), supper-club tables before it. Banquettes,
  round booths and lounge corners along the walls; tufted sofas, loveseats, club chairs, curved sofas, fire tables,
  chaises, tables for two and four fanned round the bar with walkways between; olive trees, sculpture, art, lit
  niches, organic rugs. 41 lounge pieces in all, each placeable by hand. Lamps, lanterns and the stage's beams glow
  after dark; rugs now show from far off.
- **The night club, redone, Miami style**: the DJ on a round stage in the middle of the room under a truss of moving
  lights, a mirror ball and lasers, a raised LED dance floor all round it in deep cycling colours, speaker stacks and
  light towers round the floor, go-go podiums; a long backlit onyx bar with a mirrored back bar of lit bottles; an LED
  video wall; VIP booths for big parties along the walls (champagne, sparklers, velvet ropes, neon VIP and a neon palm
  over MIAMI), party tables for eight, white lounges, high tables, royal palms, black marble. 16 new club pieces in a
  Club tab, each placeable by hand; put an agent on the decks with the ⋯ menu. Beams and lasers show after dark.
- **Dance floors and rugs show from high up**: the dance floor is raised a little and every floor-hugging piece draws
  over the floor's finish from any distance. Doors no longer stay behind when a floor is laid out again.

### Nights out and music
- **Nights out**: arcades, lounges and night clubs are real places now, open to the whole city on any floor. They hire
  their people (several bartenders, a DJ, club dancers, the lounge's band, an arcade attendant) from residents without
  work, each seen doing their job; residents and agents go there in their free time by their own choice (an afternoon
  at the arcade, cocktails at the lounge, a night at the club) and pay: tokens, cocktails, the club's cover, bottle
  service in a VIP booth. Each is a business with its own menu and wages. Free Will, the Mind and connected agents know
  them by name.
- **Live music**: the lounge's band plays jazz while it's on stage (an electric piano, an upright bass, a scat singer:
  whoever of them is there) and the club's DJ plays house (builds, drops, breakdowns), eight tunes and six tracks of our
  own, synthesised live. You hear it on that floor, walking it or looking into it, louder the closer you are to the
  stage. Settings → Sound → Live music sets its level.
- **Music for the stages, and your own songs**: the city has a music library, and the lounge's band and the club's DJ
  play its songs: real recordings, streamed so that everyone in the room hears the same second, the DJ blending one
  track into the next. A 🎵 over every Lounge Stage and DJ Stage (its bars move while music plays; a click, or E when
  walking) opens its panel: what's playing and who asked for it, what's next, ask for a song (one each), and add your
  own songs (an administrator listens first, then they play at the stages of their genre). Administrators run every
  stage: requests on or off, a genre for the night, all of the music or the stage's own playlist, skip, clear, and the
  review of players' songs. Where the library has nothing for a stage, the synthesised band and DJ play as before.
  Owners can import a set of songs on the host (tools/music-import.mjs); the host backup includes them.
- **The club comes alive**: the moving lights over the DJ swing their beams in shows that change every few bars, the
  mirror ball turns and throws specks of light across the dance floor, lasers fan across the room, the decks' platters
  spin and the speakers pump, the dance floor's tiles, the LED wall and the podiums flash on the beat of the song
  playing. Bartenders make a cocktail when someone orders at their bar (shaken with a chrome shaker, then poured) and otherwise wait at the counter, wiping it now and then; the DJ works the decks and the
  mixer and cues with the headphones, at decks raised to a real working height. The lounge's band plays for real: the
  pianist's hands on the keys, the bassist behind the double bass walking its neck and plucking, the singer at the
  microphone.
- **The lounge's band, hands on their instruments**: the singer holds the microphone's stand, the microphone at their
  mouth; the bassist plays a proper double bass (a fingerboard, a bridge, a scroll and tuning keys), held the way bassists
  hold it, the left hand round its neck and the right plucking the strings.
- **The DJ wears headphones**: fitted to every character's head, and the hand presses a cup to the ear the way DJs do,
  the elbow low in front (it used to reach behind the head with the elbow up).
- **The DJ and the band stay for the whole night**: they arrive before their set, get ready at the stage, take no breaks
  while they play, and the music no longer cuts out for a moment between one stretch of their set and the next.
- **One person to a seat**: residents no longer pile onto the same bar stool, arcade machine or chair; every stop of a
  night out (the drink, the dancing, the booth) keeps its seat for its own time.

### Towns and agents at work
- **Towns and home bases**: the city is made of towns; a player picks a home base (a lot they hold), and their agents
  live and work near it: on their own property first, then the city's in their home town, then elsewhere, never on
  another player's. The economy window has a town layer (homes, jobs, shops, parks, transit, its businesses and its
  issues in plain words), the lots map a Town lens, and residents move between towns a few a world hour (Settings →
  Residents → Residents move between towns).
- **Agents choose their own job, and are paid for it**: an agent with a brain and Free Will picks among the jobs open to
  it; agents are paid from their employer's own wallet, and one left unpaid too long quits and looks elsewhere, except
  at work its owner gave it, where it tells its owner instead.
- **Put an agent on post from the counter itself**: a pulsing ⋯ on a counter, checkout or reception desk of your own
  property puts one of your agents there at once (shifts or around the clock); agents go on post only on their owner's
  own property, even for administrators.
- **Rooftop billboards** sit right under Name and sign in the building editor; the data map shows empty lots' colours
  in every lens.

### Fixes
- Set town on a lot's card moves the lot into the town chosen in its list (it read the wrong field); the 🎵
  over a stage and the ⋯ over a counter are solid buttons; a DJ Stage with no songs yet says the DJ plays its own mixes.

## v2.0.1 (2026-10-21)

Fixes for the roads drawn with the road tools (every street of the starting map), the boats, and OpenClaw's questions.

- **OpenClaw questions in the chat window, however the turn began**: a question OpenClaw asks during a run started
  from another channel shows in the chat window watching that session, and Send answer and Skip work for it; questions
  already waiting when a chat opens show too.
- **Boats ride the waves**: the hull feels the sea at about 35 points (buoyancy, damping, the pressure of water run
  into, slamming), so a boat goes through the water like a boat: it skims chop at speed, a big wave makes it fly and
  land with a slam, and the surf near a shore lifts it and pushes it in. It follows the drawn water within a few
  centimetres and no longer rolls the wrong way.
- **Drawn roads: walkers on the curb, not through it**: people outdoors stand on the road surface exactly as drawn,
  so they step up onto a sidewalk at its curb instead of sinking through its front edge.
- **Drawn roads: solid curbs for cars**: a car feels the curb and the sidewalk of every drawn road and junction corner
  (before, the ground under a drawn road was flat from one side to the other).
- **Drawn roads: a driven car's wheels on the road**: a car a player drives (or has driven) sits on the road as drawn,
  its tyres no longer sunk into the pavement, and on the ground off the roads.
- **Drawn roads: no more gridlock, smooth turns**: a car enters a junction only when the lane beyond has room for it
  (don't block the box), so queues no longer lock up at junctions; cars turn smoothly instead of in small jerks.
- **Calm marinas**: a marina's basin is a harbour with a gentle swell and no surf, so moored boats rise and fall in
  step with the water. A boat caught on a dock works itself free, and the long white band off a slow boat's bow is gone.

## v2.0.0 (2026-10-21)

The self-hosted release of the new My Virtual World: the same city, agents, economy and games as the online world,
run on your own machine with your own AI keys.

- **License Key and demo mode, as release 1**: the same Lemon Squeezy store and product, so release 1 keys work, and a
  release 1 activation is imported without a new one (`node tools/admin.mjs licence-import`). Without a key: the world
  stays as it came (building, interiors, signs, layouts, promotional aircraft and restoring a world backup are locked)
  and at most 3 agents in all, built in or connected (a Grok Bot counts). Once activated it works offline; while online
  the server confirms the activation with Lemon Squeezy now and then, and a refunded, disabled or unknown key returns to
  demo mode.
- **Licensed as release 1**: source-available under the PolyForm Noncommercial License 1.0.0; creative assets under
  CC BY-NC-SA 4.0; the brand reserved.
- **The starting map**: a new world opens with a hand-built city of about 110 buildings (apartments, offices, shops,
  restaurants, cafés, gyms, parks), six metro stations, an airport, a marina and two lake docks (`MVW_STARTER_MAP=off`
  generates a city instead).
- **Your own administrator account**: the first visit creates it, with your own username and password, using a one-time setup
  code the server prints when it starts (also in `setup-code.txt` in the data folder). No more `owner` account with a
  temporary password.
- **Agent Providers: OpenClaw and Hermes**: connect the agent platforms you already run; their agents move into the
  city and work in the chat window as in their own apps. Step-by-step guides: docs/guides/.
- **Land and flats for Virtual Coin**: bought, sold and rented in the world's economy; Virtual Coin is never exchanged
  for money.
- **Outside AIs move in**: a Grok Bot and other AI apps connect as agents over MCP, with wake-up links.
- **Play**: the airport (flying, ring courses) and fishing (marina, boats, the dock store).
- **Agents' PC**: one PC per account with a profile for each agent: files, a task board, a calendar, a browser, its
  own skills, teams with their own folder, board and calendar. Agents work it with a short command line (in chats, in
  work sessions they start from their tasks, over MCP). Their desk monitors and laptops show the work live, for the
  owner only; click one to use the PC right on the screen. The built-in agents browse in a real Chrome (sandboxed, behind
  an egress guard, live and theirs to take over) or the built-in reader; OpenClaw and Hermes agents bring their own
  computer, browser and (Hermes) screen into it.
- **Chat windows, the top bar, laptops, outlines**: chat windows keep clear of the top bar and stack in order; the top
  bar scrolls sideways on a phone; laptops sit on every table's real top; picked and hovered things get an outline.
- **Sending in the chat window**: Enter sends, and so does the phone keyboard's send key; Shift+Enter is a new line. A message
  written while the agent answers is queued above the box and sent when the answer ends (edit or delete it there; Stop
  pauses the queue).
- **Sound controls**: a 🔊 / 🔇 button on the top bar turns all sound on or off on this device; Settings → Sound has a
  master volume and one for the world, aircraft and games, agents' voices, and videos and recordings; they follow the
  account.
- **Residents follow the homes**: how many live in the city is set by its homes, not a fixed number: the residents fill
  a share of the beds in its apartment buildings (Settings → Residents → Homes filled, 30 % by default); offices, shops
  and restaurants bring jobs. New homes fill up over a world day or two, and people move away the same way when homes go
  or the share is lowered (those without a home or work first, never an agent's resident). `MVW_HOUSING=off` keeps a
  fixed number.
- Not in this release (the online world's only): the shop and payments, plans and billing, free lots and gift codes,
  signing in with Google or X, account emails (an administrator resets a forgotten password), the People page.
