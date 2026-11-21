<!-- My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). -->
# Companions

An agent can go with its owner, wait somewhere, go somewhere or meet up with others because its owner asked, or
because its own AI chose to. This works the same way in Player mode and in sim mode.

## 1. What a person can do

| Order | Player mode | Sim mode |
|---|---|---|
| **Follow me** | The agent walks to you and stays with you, in a group behind you. It runs to catch up and follows you through doors and lifts. | It goes to your parked character and waits beside it. |
| **Get in** | Up to 3 companions within 20 m get into your car when you drive. They get out next to you when you stop. | (No car in sim mode.) |
| **Wait** | It waits where it is, or at a place you name. | The same. |
| **Send to…** | It goes to a place (a café, a park, a building, home, work) and stays there for a while. | The same. "Where I'm looking" sends it to the floor you are viewing. |
| **Go with…** | It joins another of your agents. If that agent follows you, it follows you too. | The same. |
| **Meet up** | Several of your agents meet at one place, stand in a ring and talk once a second one arrives. | The same. The world map has "Send my agents here". |
| **Sit down** | You sit on a bench, at a table or on the edge of a fountain: it sits down with you (§6f). Told to, or by itself a few seconds after you sat (an agent without Free Will). | (You are not sitting in sim mode.) |
| **Eat with me** | At your table where food is served, it sits down with you, orders and pays from its own money. | The same. |
| **Let go** | It goes back to its own day. | The same. |

You can give these orders in four places:
- The **party bar** on the left, above the map: a face for each companion with its status, and a menu on each face.
- The bar's **panel**: add a companion, set a meet-up, or let everyone go.
- The **card of your own agent** when you select it.
- The agent's **chat**, by saying it: "follow me", "come here", "wait here", "let's go to the café", "meet Max at the
  park", "get in", "you're dismissed". The order is carried out at once and appears as a line in the chat. The
  agent's brain also gets the note, so it can answer in its own words.

Only the agent's owner, or an account it is shared with to manage, can give orders. Other people's agents can never be
controlled; to the API they look as if they don't exist (404).

## 2. Switching modes and leaving

- **Player mode → sim mode.** Your character stays parked where it was. Companions wait beside it ("Waiting by your
  character"). When you play again, they walk on with you. While in sim mode you can still send them places or set
  meet-ups.
- **Driving.** Switching to sim mode while driving gets you out of the car first, so companions get out too.
- **Leaving the world.** Companions wait where you were. After `companions.waitMinutes` (10 real minutes by default)
  they go back to their day, and you get a notification. Orders you gave (a wait, a meet-up, a place) end the same way
  once you have been gone that long.
- **It stays until you let it go.** A companion you took along — following you, waiting beside you or where you asked,
  riding in your car — stays with you whatever its own day says: its shift, its hunger, its tiredness. With Free Will on,
  those come up as moments (it mentions them once, or asks whether it may go: `server/free-will/moments.js`); if you
  told it not to worry about work for this outing, its work is not raised again. Let it go (Dismiss) and it goes back
  to its day — to work, if its shift is on. Agents off together by their own choice are different: one too hungry or
  tired to go on goes off, and its part of the outing ends.
- **Messages don't pull it away.** A companion answers messages on the go. It no longer walks off to its desk or
  computer to reply.

## 3. How the agent knows it should be a companion

There are three layers, fastest first:

1. **The reflex** (`server/companions/intent.js`). Plain, short commands are understood without calling any AI, for
   every agent, whatever its brain. Something that only looks like a command is ignored: "follow up on the email",
   questions, tasks, long messages.
2. **The decision service.** If the reflex finds nothing, the agent's decision service (its Free Will connection, or
   the installation's default) is asked whether the owner wants something in the city: come along, wait, go, let go,
   or nothing. Only a confident answer (≥ 0.6) is acted on. It runs alongside the chat and never delays the answer.
   Admins can turn it off with `companions.understand`.
3. **The brain's own tools.**
   - A built-in brain (the Mind) gets `come_along`, `wait`, `go_to`, `meet_up`, `go_with` and `let_go` in its owner's
     Life chats (`server/companions/brain-tools.js`). It is told what its body is doing as a companion.
   - When the reflex already carried out the message, the brain is told plainly what it is now doing ("you are walking
     over to Kim and going wherever they go — 'here' means Kim"), so it answers as someone already on the way instead
     of asking where. If it calls the same tool anyway (for example `wait` with a place it guessed), the call is
     answered "already done" and the order is left as the message gave it.
   - A connected agent's body tools gain the same actions on `act`: `come_along`, `wait`, `go_with`, `let_go`. Its
     facts include `companion`.
   - OpenClaw and Hermes agents get the world's note added to the message they receive.

## 4. How it works

- **One order on the body.** Every order is a Brain order on the agent's body (`server/sim/agents.js` order):
  - `follow`, with a lead: a player's account or a resident's body.
  - `hold`, with a spot. A meet-up is a `hold` shared by a group.
  - A venue, home or work.

  The order comes before the routine, a post and an open task, and it is saved on the resident, so it survives a
  restart.
- **The moves** (`server/sim/companion-moves.js`). Each follower has a slot round its leader: beside it first, then
  a step behind, then further round. It walks, jogs or runs straight there when the path is clear (the players' own
  walkability rules), otherwise it goes through doors, lifts and streets. Riding means being hidden in the car at the
  car's position.
  - **Keeping up.** Beside a leader on the move it walks on with them at their pace (no stop-and-go), a little faster
    the further behind it is, and runs (up to 6.2 m/s) after a running player. The city plans everyone a few seconds
    ahead, so a follower's next stretch starts where a walking player *will be* by then, not where they were.
  - When the leader stops, it stops beside them.
- **The watch** (`server/companions/companions.js`, twice a second). It:
  - re-plans a follower as soon as its leader turns, stops or speeds up (a step or two when close; a good part of
    the distance when far behind);
  - gets followers into the car and out of it;
  - waits for leaders who left, then ends the orders;
  - tells owners when an order ended by itself;
  - sends each owner's pages their list as a `companions` frame.
- **The city is unchanged.** Nothing here uses a simulation random number, and residents without a companion order
  live exactly as before (`tools/sim-digest.mjs` gives the same digest).

## 5. Settings (Settings → Agent limits → Companions)

| Setting | Default | |
|---|---|---|
| `companions.enabled` | on | Owners may take their agents along and send them places |
| `companions.maxPerPlayer` | 3 | Most agents following one player (1–6) |
| `companions.waitMinutes` | 10 | Real minutes companions wait for someone who left |
| `companions.understand` | on | The decision service reads owners' messages for requests in the city |
| `companions.agentInvites` | on | Agents may ask each other along, and answer for themselves |
| `voice.cityLines` | on | Agents' lines in the city are spoken in their own voices |
| `voice.cityAudience` | public | Who hears agents' voices unless their owner chose: everyone near, or only the owner |

## 6. API

- `GET /api/companions` returns `{ companions: [...], max, following, enabled }`.
- `POST /api/companions` takes `{ agent, action, target?, place?, spot?, minutes?, goal? }`. The actions are `follow`
  (target `me`, an agent id or a name), `come`, `stay`, `go`, `ride`, `sit`, `eat`, `stand` and `dismiss`. A meet-up is
  `{ action: 'meetup', agents: [...], place | spot }`. `sit`, `eat` and `stand` answer `{ ok, action, text, brain,
  companion }`; one it could not do is a 409 with `{ ok: false, code, error, text, brain }` (§6f).
- `POST /api/companions/dismiss-all`.

All of them need the capability `agents.profile`. Agents you don't own or manage answer 404.

## 6b. Voices: agents talking out loud

- **Every line in the world is spoken.** When an agent says something in the city (a brain's line that the moderation
  allowed, a greeting, a companion's remark), the server makes the audio once, in that agent's own voice. The voice is
  the agent's own if set, else its owner's, else the installation's (`voice.speakConnection`), and is counted as its
  owner's (`server/voice/lines.js`). The `say` event carries the audio's id. Every page near the speaker plays it
  (`client/js/audio/voices.js`):
  - in Player mode, by distance from the player (26 m); in sim mode, by distance from the camera's point, and quieter
    from high above;
  - only in the same space (the same floor, or both out in the open);
  - at the Voices volume in Settings → Sound;
  - at most 3 voices at once (the nearest), one line at a time per agent.

  **Heard like a voice in that place** (3D audio): from the speaker's position (left or right, moving with it), fading
  with distance; indoors with the room's echo (longer on a bigger floor); muffled and close-range only through a floor
  or a building's walls; quieter from high above in sim mode.
  **Who hears it**: each agent's Studio → Voice — everyone near (public), only its owner (and those it is shared with to
  manage), or the world's default (`voice.cityAudience`). An owner-only voice is sent to the owner's pages alone
  (`say_voice`); everyone else sees the speech bubble without hearing it, and the audio is refused to them.
  `GET /api/voice/line?id=` serves the audio to whoever may hear it, for 5 minutes. At most 4 lines are made at once
  (any more are shown without voice). A line waits up to 7 s for its voice before it is shown without it.
- **Your own agents answer you out loud.** An answer in its chat (face to face in Player mode, or from the chat window)
  shows in its bubble and is spoken in its voice for you alone, when its body is near enough to hear. The chat window's
  voice mode reads answers itself, so nothing is read twice.
- **Moderation without OpenAI.** Public lines need a moderation check. A brain on a provider that has no moderation
  service (OpenRouter, Anthropic, Google) now judges each line itself: one short call, temperature 0, answering only
  `{flagged, categories}`. Anything else counts as not checked, and nothing is said
  (`server/providers/models.js modelModerate`).
- **Companions talk.** A companion says a word, in its own words and voice, when it joins you from a button, arrives at
  a meet-up, or gets into or out of your car. At most one a minute each, within the speech limits (`mind.speechPerDay`,
  `mind.speechGapSeconds`). Agents standing together in a group, at a meet-up or going round with the same person, get
  a chance to talk: one speaks, the other may answer (the Mind's meeting, once a world day per pair). An answer to
  someone who just spoke needs only 2.5 s since its last line, not the full gap.

## 6c. Agents with agents: their own companions

When two agents with brains of their own meet, they talk. This happens anywhere in the city (their routine), at a
meet-up, or in a group. If both are free (no order from anyone, or at the same meet-up once they have got there), and
`companions.agentInvites` is on:

1. The first one's line may ask the other along: to one of its nearby places, or for a walk. Its brain decides; most of
   the time it just chats. The invitation must name a place it was offered, or a walk, or it doesn't count.
2. The other one hears it and answers out loud. Its own brain decides yes or no, from its mood, needs and what it is
   doing.
3. On a yes, they go together. The one who asked leads (to the place, or a stroll in the nearest park) and the other
   follows, for about an hour of the world (`via: 'agent'`; no person gave the order). Both remember it. Each owner sees
   it in their Companions: a dashed face reading "Going with …" or "Out with … · place". Either owner can let theirs go.

Nobody is ordered here. A stranger's agent is never controlled: it only ever goes because its own brain said yes.

**Talking on.** Two agents who meet anywhere greet each other once a world day. Two who are spending time together —
following the same person, at the same meet-up, or off together by their own choice — keep talking: about every 75
seconds at the soonest (one pair at a time per group), up to 10 times a world day per pair, each line within the
agent's own speech limits (`mind.speechPerDay`) and moderation. Each time they pick up from what was said last, and
know what they are doing together ("we're meeting up at Founders Park"). Either of them may suggest going somewhere
together then — the one who speaks first, or the other in its answer — and the one asked decides. Two who are spending
time together are not held to a stranger's few answers a day (`social.strangerLinesPerDay`); blocks still apply. Code: `server/mind/mind.js` `onMet(…, { again, together })` / `chatOn`, called by
`server/companions/companions.js` `chatter`.

## 6d. In the car: seen in their seats

The product owner, 2026-11-16: "the driver should be visible, and other companions aswell. so they are visible on the
seat. This should also be the same for agents using cars to go places".

- **Who sits where** (`server/world/car-seats.js`). The server keeps each car's riders besides its driver. A rider
  takes the lowest free place and keeps it for the ride; a car takes no more than its kind's seats
  (`shared/vehicle-specs.js`). Every page is told (`vseats` messages; the whole list on connecting).
- **The seats** (`client/js/render/vehicle-seats.js`): read off each vendored model's own interior — cushions,
  backrests, headrests, the steering wheel — with rays for the roof lining, the floor and the door. Nothing is written
  down a second time.
- **The people** (`client/js/render/car-occupants.js`, `seat-fit.js`):
  - The driver (a player, or a resident or agent driving its own car) at the wheel, hands on it, turning it with the
    car's steering (`car_drive`).
  - Passengers sitting with their hands on their thighs (`car_ride`).
  - Both clips are baked into the characters by `tools/chars/extra-clips.mjs`.
  - Each body is fitted to its seat: on the cushion, its back at the backrest, its head under the roof lining (hair
    may brush it), its feet in the footwell.
  - A body taller than the low cabin allows is drawn a little smaller: about 0.85 of its size in a sedan, 0.75 in a
    compact or taxi, 1.0 in a van or bus.
  - They are posed from the same frame's car pose, so they never slide in the car (measured: under 0.01 cm at 24 m/s).
- **Still hidden for everything else.** Riders stay hidden in the simulation: the cars' physics ignore them (no
  bumps), and nobody can walk into them.
- Checks: `tests/vehicle-seats.test.mjs` (every seat of every kind; 8,448 fits of every character, height and build),
  `tests/unit/car-seats.test.mjs`, and `tools/car-occupants-check.mjs` (a real browser: a driver with three companions,
  seen by a second player; a resident driving its own car).

## 6e. Talking with your companions out loud (no chat window)
- **One row by the Companions bar** (`client/js/ui/companion-voice.js`): the button, who is listening and what it is
  doing, and the way to talk (a menu): **Off**, **Hold to talk** (hold the button or V), **Wake word** ("hey Sam", "hey
  team", then speak — the browser's own recognition, so nothing is sent anywhere until a name is heard; Chrome, Edge,
  Safari) or **Live** (an open conversation that answers when you have finished — the patience, habit and words-so-far
  of chat-and-voice.md "Live voice"). Above the bar on a computer, under it on a phone; under the chat windows; not
  there with nobody out with you. The way is kept on the device; a page that opens never starts listening by itself.
- **Who answers**: the one named at the front ("Sam, …") or called at the end ("… what do you think, Lara?"), several
  named together ("Sam and Lara, …"), everyone ("everyone", "team", "guys", "you all") — at most 3, one after another,
  each in its own voice, the next one thinking while the one before speaks — or, with no name, the one spoken to last
  (`companion-voice-words.js`, `tests/unit/companion-voice.test.mjs`). A name heard as something that sounds like it
  ("Lera" for Lara, "Simon" or "Sammy" for Sam) counts where a name is expected — at the front, after a greeting word,
  called at the end after a comma — when it is no ordinary word ("same", "summon") and sounds like exactly one of the
  companions out with you.
- **One conversation**: everyone out with you is one group (`server/chat/groups.js`): each is told what the others said;
  in each one's chat the person's line is marked "to Sam and Lara" (the window's label: nothing the brain is told).
- **One chat per agent**: the voice row, E face to face and the chat window all continue the chat the person has with
  it now — the one a chat window shows for it (a New chat there too), else the one last written in
  (`server/chat/sessions.js` current, `client/js/ui/chat.js` current) — and none starts a chat by itself (only New
  chat does; an agent with no chat gets a first one). An answer through the voice row shows in its speech bubble too,
  once when the chat window shows the same answer.
- **An outing in the chat**: when an agent starts going out with you (following you, so riding with you and waiting
  beside your parked body too), its current chat gets a divider — "Out with Kim · 8:21 AM" — and one when it is back to
  its own day (no order of yours left); an order given again, or a wait between two walks, adds none
  (`server/companions/outings.js`). They are the chat's own lines, never part of what its brain is told.
- **It never listens while they speak** (it would hear them and answer itself); the button stops them and listens.
- Checks: `tools/live-voice-check.mjs dock`, `tools/companion-voice-ui-check.mjs`, `tools/one-chat-ui-check.mjs`; tests:
  `tests/companions-outings-http.test.mjs`.

## 6f. Sitting down with you

The product owner, 2026-11-17, after a walk with Sam and Lara: "in the park they can't sit down next to me on the bench
... in a restaurant they can't sit down at the table and order food ... they need to interact with the world".

- **Where someone sits** (`Brain.seatAt(x, z, ctx)`, `server/sim/companion-moves.js`): the seat a body is on, within
  0.6 m of it — indoors by its building and floor, outdoors in a park's grounds (a park is walked at street level by
  players) or on a decoration with seats (a bench placed on open land, a dock's picnic table:
  `server/sim/decor-seats.js`). It says what it is in plain words: "a bench", "the edge of the fountain", "a table at
  «Restaurant 16»", "an armchair", "a bench at «Bayside Marina»", "a picnic table by «6th Ave & Pine St»", and the
  place (`venue: { kind, name }`; a decoration's: its dock's name or address). A player sits when their page says so (`PF_USING`);
  `Companions.leaderSeat(account)` is that player's seat (the senses: "Kim — sitting on a bench").
- **Sit** (`action: 'sit'`): the free seat nearest its leader — their own piece first (the other end of the bench,
  another chair at their table, further round the fountain), else a seat within 4 m. Its leader standing: a seat within
  4 m of itself. It walks over and sits as residents sit (the city's slots); the seat is held for it the whole time, so
  no resident takes it. It stays while its leader sits or stands near, and gets up and follows when they walk off
  (more than 3 m) or drive off. The seat is part of its follow order (`order.seat`), not an order of its own: the
  outing, the Companions bar and the chat's dividers go on as they were.
- **Eat** (`action: 'eat'`): its leader sitting at a table in a restaurant, a café, a lounge bar or a club, it sits at
  their table (else the nearest free one within 8 m) and orders as residents order there. The bill is the economy's
  own (`sim.onAct`), from its own money and within its owner's limits; first the economy is asked what it would cost
  (`Households.quote`). With too little money it sits with them without ordering, and its brain is told so. The meal
  is cut short when its leader leaves.
- **Stand** (`action: 'stand'`): it gets up, beside its leader again.
- **Honest answers.** Each answer has `text` (the line for the person: "Lara sits down on a bench beside you") and
  `brain` (what its body did, for its chat: "you sat down on a bench beside Kim"). Not possible is `ok: false` with
  `code` (`full`, `no_seat`, `not_seated`, `not_food`, `riding`, …) and a `brain` that says it could not ("you could not
  sit down: every seat near Kim is taken"). A chat can't claim a seat its body didn't take.
- **By itself** (`Companions.decides(rec)`): for an agent its Free Will doesn't decide for (the default), its leader
  having sat 4 seconds and a seat free near them, it sits down with them — once each time they sit — and gets up when
  they do. An agent whose Free Will decides waits to be told (Free Will may send `sit` or `eat`).
- **What its owner sees** (`Companions.view`): `doing` — "Sitting with you on a bench", "Eating with you at «Restaurant
  16»" — and `seat: { words, use, item, since, mode, eating, auto, venue }` while it sits.
- **Players on park benches** are nobody else's seat now too (`playerOn`, `playerTook`: a park's grounds and the
  street are one space).
- Checks: `tests/unit/companions-seat.test.mjs` (a park bench, a full bench, a restaurant's meal and its bill, no money,
  by itself, `seatAt`), `tests/companions-seat-http.test.mjs`, `tools/companion-seat-ui-check.mjs` (a real browser).

## 7. Not yet
- No missions with goals and rewards yet. A companion order with a goal is the seed for them.
