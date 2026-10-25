# Nights out: arcades, lounges and clubs

The product owner, 2026-10-23: "make these themed floors actually be usable by agents and residents, meaning some work
there, some go there spending money ... the lounge needs bartenders, several, musicians etc ... the night club needs
bartenders, several, nightclub dancers as well as a DJ that plays music ... they have free will to go dance at a night
club, sit at a lounge and socialize or play on the arcade".

A floor themed as an arcade, a lounge or a night club ([Floor Themes](floor-themes.md)) is a place of its own: its
level's `venue` is `arcade`, `lounge_bar` or `club` (shared/nightlife.js). It is open to everyone on whatever floor it is
(server/sim/windex.js), it is a business with its own menu (server/economy), people work there, and residents and agents
go there in their free time and pay. (A building's staff lounge, venue `lounge`, is unchanged: only its own people.)
Floors themed before this took their theme's venue at boot (server/world/generate.js `themeVenues`).

## Hours

| Place | Open | Shifts |
| --- | --- | --- |
| Arcade | 10:00 to 23:30 | 10:00 to 16:45, 16:45 to 23:30 |
| Lounge | 15:00 to midnight | 15:00 to midnight |
| Night club | 20:00 to midnight | 19:30 to midnight |

## Who works there

The piece someone works at makes their role (shared/nightlife.js `ITEM_ROLE`), their title, their wage and what they are
seen doing (a use of its own, shared/catalog.js USES):

| Piece | Role | Seen | Wage (per world hour) |
| --- | --- | --- | --- |
| Island Bar (3), Round Bar (2), Club Bar (3) | Bartender | Mixing drinks | 11.50 VC |
| DJ Stage (the decks) | DJ | DJing | 17 VC |
| DJ Stage (two places on stage), Go-Go Podium | Dancer | Dancing on stage | 13 VC |
| Lounge Stage (piano, microphone, double bass) | Musician | Playing music | 15 VC |
| an arcade's prize counter | Attendant | On shift | 10 VC |

Free places are filled with residents without work, the nearest first, the DJ and the band first
(server/sim/population.js `hireNightlife`, run with every reassignment: at boot and after edits). An owner can put one of
their AI agents at any of these places with the ⋯ menu (a post), like any counter.

The performers, the DJ and the band, are there for the whole night (2026-10-24, the product owner: "the dj left and there
was no music playing yet people kept dancing in the nightclub ... why would a dj leave?": a phone break in the middle of
the set, and a trip to the gym before it that made the DJ twenty minutes late). They set off for the show in good time
(server/sim/agents.js `onShift`: SHOW_EARLY hours more than the way there, so nothing they planned before it runs into
it), get ready at the stage until their set starts ("Getting ready": no music yet), take no breaks during it, and only
leave it to eat when there is nothing left (`onStage`); the bartenders and dancers keep their breaks.

## Going out

Residents choose from the same list as always (server/sim/agents.js `leisureOptions`), now with the arcade (in the day
and evening, more when they want fun and at weekends), the lounge (evenings, more when they want company) and the club
(from 20:00, more for night owls and at weekends). Free Will agents see the nearest ones by name, with the price of a
visit (server/free-will/options.js), the Mind knows them among the places near it (server/mind/), and connected agents can
be sent there (server/agent-world.js activities `arcade`, `lounge_bar`, `club`).

- **Arcade**: tokens at the prize counter, then two to four games (cabinets, pinball, the bull, billiards, air hockey,
  the dance machine ...), sometimes a soda in a booth.
- **Lounge**: a cocktail or wine at the bar or in the seats, sometimes another round in another seat.
- **Night club**: a drink at the bar, the dance floor, and for those with money a VIP booth.

One person to a seat (2026-10-24, the product owner: "a lot of agents are sitting on the same seat"): every stop of a
visit holds its seat or machine for its own stay, from the arrival to the end of the hold (server/sim/agents.js
`reserve`, `holdFor`: a stay each, several games in a row at one machine several stays), so a seat someone will only get
to later is free until then and one they will be in is nobody else's. A seat is chosen free over the stay reckoned from
the way there (`stayWindow`); once the way is planned, the stay is checked to the second and, taken, the plan steps back
and tries another (`useAt`), else skips that stop. It held one seat a resident, the last chosen: a plan's earlier stops
(the drink before the dancing) were given away while still ahead, and a club's bar filled its first stool with a dozen
people at once. tests/nightlife.test.mjs checks nobody is in a seat or at a machine someone else is in.

## What it costs

Each is a business (server/economy/policy.js menus; drinks are shared/food.js items, so they show in the hand):

| Place | Sells |
| --- | --- |
| Arcade | Game tokens 5 VC, sodas 3 VC |
| Lounge | Martini, Old fashioned, Gin & tonic, Aperol spritz, wines, Champagne, Whiskey (7.50 to 11 VC) |
| Night club | Cover charge 15 VC, cocktails, Champagne, beer, Bottle service 150 VC |

A visit is one bill (server/economy/households.js `basket`): tokens (sometimes two); the drink they had; at the club the
cover and a drink, and now and then a VIP table's bottle service.

## Live music

While the lounge's band is on stage (musicians at work, use `perform`) or the club's DJ is at the decks (use `dj`), music
plays from the stage. With songs for that stage in the city's library ([Music](music.md)), the band and the DJ play
those: the stage's deck on the server says which song and since when, and every browser in the room streams that
recording at the same second (the 🎵 over the stage opens its panel: requests, playlists, uploads). Where the library has
nothing for a stage, the music is synthesised in the browser (client/js/audio/nightlife-music.js) from our own songs
(client/js/audio/nightlife-songs.js): nothing recorded, nothing to license.

- **The lounge**: a jazz trio. The pianist plays an electric piano (comping, and the tune when nobody sings), the bassist
  walks an upright bass, the singer scats the tune ("doo", "bah"). Who is playing is who is on the stage (the piano on the
  left, the microphone in front, the double bass on the right). Eight tunes in four feels: swing (Velvet Hour, Midnight
  Walk, Brass and Smoke), ballads (Copper Moon, Late Train Home), bossa nova (Rio Lanterns, Soft Focus) and a blues (Blue
  Terrazzo), each played for two to four choruses, with a breath between tunes.
- **The club**: house from the DJ. A kick, claps, hats, an off-beat or rolling bass, supersaw chords that pump with the
  kick, a plucked arpeggio or hook, and each track's form: intro, a build (a snare roll that quickens, a rising sweep),
  the drop, a breakdown, another build and drop, an outro. Six tracks (Neon Tide, Palm Static, Ocean Drive, Velvet Rope,
  Sunset Strobe, After Hours), 122 to 128 BPM.

**Who hears it**: on that floor, a player walking it, or the camera looking into it (the floor in focus). The volume
follows the distance from the player (else from the camera) to the stage (full within 6 m, falling off beyond) and the
sound is panned to where the stage is; anywhere else it is silent. Where the set is comes from the clock, the same for
everyone: leave and come back and the band has moved on. The level is **Settings → Sound → Live music** (default 80 %).

## Alive: what moves, and the people at work

The product owner, 2026-10-23: "we need animations for EVERthing as well as the assets need to look alive, like the
games at the arcade, the lights and the lasers at the night club".

- **Moving parts** (render/furniture.js `part`, render/interiors.js `animateParts`, render/venue-motion.js): a piece's
  builder may set apart parts that move on their own, each about its pivot; on the floor being looked into they move
  every frame by their kind, in time with the music playing there (audio/nightlife-music.js `beatAt`: the stage deck's
  song by the server's clock, else the synthesised set). The club's: the DJ stage's eight moving lights and the light
  towers' (their beams swept in shows that change every eight bars: all together, circles, a wave, crossing), the mirror
  ball and the specks of light it throws on the dance floor, the lasers' fans (on the stage and the laser bars), the
  decks' platters, the speakers' cones pushed out on every beat. With no music they rest or drift slowly.
- **Lights on the beat** (render/mats.js emits 9 and 10, uniforms uBeat and uBeatOn): a flash on every beat (the
  mixer's lights, the light towers' strobes, the go-go podiums' rings) and tiles lit a few at a time with the beat (the
  LED dance floor's coloured tiles, the LED wall's coloured panels).
- **At work**: bartenders (every bar of a lounge and a club) make a drink when someone orders (2026-10-24, the product
  owner: "bar tenders should be mixing drinks only when ordered"): someone sitting down on a bar stool orders, and the
  nearest bartender on that floor (within 3.2 m) makes it, one order after another: the shaker upright before the chest
  (the left hand on its cap), shaken, then tipped forward over the counter to pour (a chrome shaker in hand:
  render/char-props.js `shaker`); waiting, they stand at the counter, hands on it, wiping it now and then (render/agents.js
  chooses: act_shake or act_bar_idle, a clip of the browser's own, bar_idle); the DJ works the right deck, the mixer, then
  presses a cup of their headphones to one ear, nodding along. The decks stand at a working height, within the DJ's
  reach. The DJ wears headphones (2026-10-24, the product owner: "I'm not sure why the dj puts their elbow up so high
  when placing hand on ear, looks off"): render/char-props.js `headphones`, the first thing worn on the head (HEAD: the
  head's bone and its frame, venue-clips.json `heads`, fitted to each character's own head mesh, hair and all, by the
  venue bake; sizes in shared/stage.js PHONES); the hand goes by the chest's side to the cup on the ear, the head tilted
  to it, the elbow in front at about the shoulder's height (it had gone behind the ear, the elbow out and up). The
  lounge's band: the pianist plays as a typist types at a desk (the typing clip: 2026-10-24, the product owner: "the
  typing/working animation should work fine for the piano"; the keys at a desk's height over the stage and a typist's
  reach from the bench, the bench as high as an office chair's seat), the
  bassist stands behind the double bass as a bassist holds one (2026-10-24, the product owner: "the bass player needs
  more work the hand placements are off"): the bass leans back and to the left against them, its back on their left hip,
  turned half way to their right so the strings face the right hand; the left hand round its neck (the thumb behind,
  the fingers over the fingerboard) moves up and down it a note a beat, the right's fingers pluck the strings where the
  fingerboard ends. The singer holds the microphone's stand (2026-10-24: "their hand is not holding the mic stand"): the
  right hand round the stand just under the microphone, the thumb up, the microphone at the mouth, the other hand rising
  with each phrase. Where the bass and the stand are from the bassist's and the singer's places is kept in one place,
  shared/stage.js, used both to draw them (render/furniture-lounge.js) and to make the clips, so the hands land on them
  for every character (`--verify`: how far any hand falls short of where it was sent). These
  clips are a set of their own (tools/chars/extra-clips.mjs `--set venue`: client/assets/chars/<kind>.venue.bin and
  venue-clips.json, loaded after the extra clips), so they can be made again without the others.

### The arcade's machines (2026-10-24, the product owner: "the arcade games interaction animations need way more work
they look off")

Each machine has a clip of its own (the venue set), made against the machine's controls where
render/furniture-arcade.js draws them, the player's place moved within reach of them (shared/catalog.js); the machine's
moving parts follow the same motion (shared/arcade-motion.js, a function of the player's clip's phase, used by both the
clip tool and render/venue-motion.js, which finds whoever plays at the machine's place):

| Machine | The player | The machine |
| --- | --- | --- |
| Billiards table | down over the table, the cue (in hand) on the bridge hand, practice strokes, the shot | |
| Air hockey | bent over, the striker (in hand) side to side and shooting, the other hand on the rail | the puck slides; the table's own striker is put away |
| Foosball | both hands on two rods' handles, sliding and twisting, kicking | those rods (and their players) turn and slide with the hands |
| Whack-a-mole | the mallet (in hand) raised and brought down on a mole, the other hand on the edge | the moles pop up and duck when whacked; the machine's mallet put away |
| Punching machine | guard, then a right cross into the ball | the ball knocked up on its arm |
| Claw machine | the left hand on the joystick, the right pressing the button, looking up into the glass | the gantry and the claw follow the joystick, the claw drops on the button |
| Pinball | a hand on each front corner, pressing the flipper buttons, a nudge | the flippers flick with the presses, the ball rolls |
| Racing cabinet | seated, both hands on the wheel, turning it | the wheel turns with the hands |

Still to do: bowling, skee-ball and the basketball hoops (the ball thrown, its flight, the pins), the mechanical bull (the
rider moving with it). A character's clip (render/anim.js CLIP_NAMES) now travels from a player in 7 bits (128 clips).
Lab: tools-bin/arcade-pose-check.mjs puts a character at each machine's place playing its clip at fixed moments
(render/agents.js `pose`, for lab checks only) and photographs it from the side and behind.

## Checks

- `tests/nightlife.test.mjs`: a generated city with an arcade, a lounge and a club hires their people from residents
  without work and, run for a day, they work in their roles while the city comes (games and tokens, cocktails, the bar,
  the dance floor and VIP booths) at their hours; Free Will's evening names the club and the lounge; the economy opens
  each as a business with its menu and charges a visit.
- Lab `tools-bin/nightlife-music-check.mjs`: renders the trio and the DJ offline in the browser, measures them (loud
  enough, not clipping, music all the way) and saves WAV and MP3 in checks/out/nightlife-music/ to listen to.
- Lab `tools-bin/club-alive-check.mjs`: a club at night on a throwaway server with the DJ playing library songs: the
  moving parts move, the beat drives the lights, the frame rate (60 fps), frames to a short video.
- Lab `tools-bin/venue-anim-shots.mjs`: close-ups of people at work (the DJ, bartenders), a few frames each.
- Lab `tools-bin/nightlife-live-check.mjs`: a lounge and a club themed on a throwaway server, the evening; the music
  plays from each stage while its people play, louder up close, and stops outside the building.
