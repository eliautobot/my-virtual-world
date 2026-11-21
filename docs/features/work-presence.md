# Who is at work

Proprietary — see [LICENSE](../../LICENSE).

The product owner, 2026-11-16: "if the agent is not at their post then they cant be on the air or at their post … co-hosts
need to recognize which agents are there and arent, because they still end up talking as if they are there … agents need to
know their positions, posts, and co-workers and their role so that agents know when a co-worker is missing, late, or will
be back soon." Decisions: they may say when someone is out or late and why — for any agent and any owner; late means 5
minutes into the shift; residents are included.

## 1. What it is

One staff list per workplace, and each person's status on it, worked out from **where their body actually is** — never
from the timetable alone. Code: `server/workplace/presence.js` (`WorkPresence`).

- **Positions** come from what is already set up; nothing has to be set up again:
  - everyone whose job is at a piece of furniture (an office desk, a café counter, a bar, a checkout, a reception desk,
    a kitchen's stations, a radio studio's broadcast desk and DJ booth), by their hours;
  - every agent on post there around the clock (`server/agent-posts/`).
- **Role**: from the piece (radio host, DJ, cook, cashier, receptionist, fishmonger, bartender …), else the job's title
  ("Accountant"). **Workplace**: the room the piece stands in (a studio, a kitchen: an interior module), else the venue's
  floor.
- **Status** (`status(i)`):

  | State | When | Example text |
  |---|---|---|
  | `on_duty` | at their place during their hours | On duty |
  | `coming` | heading there, not yet late | On the way (about 3 min) |
  | `late` | their shift started more than `work.lateMinutes` ago and they haven't been there yet | Late (12 min) — out with Kim |
  | `away` | they had been there this shift and left (an order took them, or their day did); on the way back with its time | Away — out with Kim · Away — on the way back (back in about 4 min) |
  | `break` | a break or a meal during their shift | On a break — back in about 6 min |
  | `off` | not their hours | Off shift (starts 8:00 AM) |

  The reason comes from what they are doing: an order ("out with Kim", "at a meet-up at Founders Park", "out at Café 21",
  "meeting Sara"), or their act ("still asleep", "having a coffee", "on the way").
- **Moments**: a look every 4 seconds notices `late`, `arrived` (with how late), `left` (during the shift) and `back`
  (after how long). `late` and `arrived` come once a shift. The first look after the server starts says nothing about
  how things already were.
- Nothing here draws a simulation random number or changes anyone's plan: it only looks. The whole city is looked at in
  a few milliseconds.

## 2. Who uses it

- **The radio** (`server/radio/radio.js`):
  - Only hosts at the broadcast desk and a DJ at the booth are on the air (`hostsOf`, `djOf`; `{ all: true }` gives
    the job's holders, there or not — `server/radio/host-job.js`).
  - The ones on the air are told who is missing and why (`missingOf`), and may mention it truthfully. They never speak
    for them or address them as if they were there.
  - Nobody in the studio: no talk, music only.
  - A station with no studio: its hosts, unless an order took them away.
  - The station panel and Settings → Radio show "Not in: …".
- **The kitchens** (`server/play/kitchen-shifts.js`): a cook cooks Rushes only while at its station.
- **The agents' minds** (`server/mind/`): a "MY WORK" line (role, place, hours, where they stand) and "MY CO-WORKERS ON
  THIS SHIFT" in every thought. A line out loud knows whether they are on duty and who is not there.
- **The moments** (`server/workplace/remarks.js`):
  - An agent remembers getting in late, leaving during a shift and coming back (its life's memory).
  - When it gets in late it may say a word about it.
  - One co-worker there with a brain of its own may say a word too — whoever knows them best — to them, or about them.
  - All of it in their own words, through the usual speech limits and moderation.
  - At most one co-worker word per workplace a minute.
- **The screens**:
  - A person's card: "At work" — their role, place and status — and their co-workers on shift with theirs.
  - A seat's ⋯: whether whoever works there is there now.
  - The Companions bar: a companion out with you during its shift shows "⏰ Late for work" or "Missing work".

## 3. Settings (Settings → Agent limits)

| Setting | Default | |
|---|---|---|
| `work.lateMinutes` | 5 | World minutes into a shift before someone not there yet is late |
| `work.remarks` | on | Agents may say a word when a co-worker is late, leaves or gets back (they remember it either way) |

## 4. API

- `GET /api/work/person?i=` → `{ i, work: { role, place, hours, state, text, reason, onShift, lateBy, eta, team: [...] },
  place: { key, b, f } }` (`world.view`).
- `GET /api/work/place?b=&f=&room=` → `{ key, name, kind, staff: [{ i, name, role, state, text, reason, eta, lateBy,
  onShift, agent }] }` (`world.view`; 404 when nobody works there).
- `GET /api/agent/:i` carries `work` too.

What anyone walking in could see — who works there, who is in, who is not and why — is the same for every visitor.

## 5. Tests

- `tests/unit/workplace-presence.test.mjs`: staff lists and roles, a shift's arrivals, an agent taken out mid-shift
  (away, then back), kept away from the start (late, with the reason, arrived late once), and the setting and speed.
- `tests/unit/radio-presence.test.mjs`: the cast is who is in the studio.
- `tests/workplace-http.test.mjs`: the routes and the card.
