# Places — reviews, ratings and messages on a building's billboard

The product owner (2026-11-20): "comments and ratings on top of buildings, specifically in the billboard … a leave a
review or leave a message, kinda like Google Maps … rate it on 5 stars and the stars can be hovering on top of
billboards … the leave a message option is a way to send and leave a message to the building owner but others can't see
it, only the building owner can see the message all through the same billboard window/panel."

## What people see

- **Stars over the billboards.** A building that has been rated shows its rating floating over each of its rooftop
  billboards: five stars filled to the average, the average and how many reviews. It bobs gently, grows with distance
  (up to 3×) so it reads from across the city, and tapping it opens the reviews. In Play mode, looking at the billboard
  adds the rating to its "Open link" hint.
- **The billboard's window** (tap a rooftop billboard or a sign inside a building) is the place's card:
  - under its title, the rating (tap: the reviews) and who owns it;
  - **Overview** — the billboard's design, its message and link as before, then **Leave a review** and **Message the
    owner**;
  - **Reviews** — the average with a bar for each number of stars, your own review on top (edit or delete it), then
    everyone's, newest, highest or lowest first, 30 at a time;
  - **Messages** — only for the place's owner: what visitors wrote, newest first; opening it marks them read.
- **Writing a review**: tap 1 to 5 stars (the word for each shows as you hover: Poor … Excellent), words if you like
  (up to 1,000 characters). One review per person and place; writing again replaces it.
- **A message to the owner**: private — only the owner reads it, and sees your name. Up to 1,000 characters.

## Who may do what

| | Signed out | Member | The place's owner | Administrator |
|---|---|---|---|---|
| See the stars and read reviews | ✓ (names show as "A resident") | ✓ | ✓ | ✓ |
| Review a place | — | ✓, not their own | — | ✓, not the city's own |
| Message the owner | — | ✓ | — | ✓, not the city's own |
| Read a place's messages | — | — | ✓ | the city's own places |
| Take a review down / show it again | — | — | — | ✓ |

- **The owner** is whoever holds the building's lot: an account, or for the city's own land the city — its messages are
  read by its administrators. A building held by an agent or a business takes reviews but no messages.
- **Messages belong to the owner they were sent to.** A lot sold later doesn't hand the old messages to the new owner;
  the seller still finds them in their inbox (`GET /api/places/messages`).
- **The owner is told** of every message and of each new review (not of edits): the bell, and a push to their devices
  when no page is open. The notification opens the place's window on the right tab.
- **Taking a review down**: an administrator gives a reason; the review leaves the rating and the list, its author sees
  it with the reason and can neither edit nor delete it (so writing it again can't undo it). Administrators see what was
  taken down under the reviews and can show it again. Every take-down is in the audit log.
- **Limits**: reviews 6 at once then one every 20 s per account; messages 5 at once then one a minute; a place keeps
  each owner's newest 500 messages.
- **An account deleted** takes its reviews (the ratings follow) and every message it wrote or was sent.

## How it works

- Tables `place_reviews` and `place_messages` (schema v60, add-only), keyed by the building's index — buildings are never
  renumbered, a demolished one keeps its index and its place card goes with it.
- Capability `places.review` (member): reviewing, messaging, reading one's own messages. Reading is `world.view`; taking a
  review down is `world.edit`.
- `server/places/places.js` (the rules), `server/places/routes.js` (HTTP), `client/js/ui/sign-panel.js` (the window),
  `client/js/render/signs.js` (the stars), `client/css/places.css`.
- Every change to a place's rating is broadcast (`{ t: 'place_rating', b, avg, n }`); a new message for an owner is sent
  to their pages (`{ t: 'place_inbox', b }`).

| Route | Capability | |
|---|---|---|
| `GET /api/places/ratings` | `world.view` | every rated place: `{ ratings: { [b]: { avg, n } } }` |
| `GET /api/places/place/<b>?sort=new\|high\|low&offset=` | `world.view` | its rating and bars, reviews, your own, what you may do; its owner: `inbox` counts |
| `POST /api/places/review` `{ b, stars, text }` | `places.review` | write or replace your review |
| `POST /api/places/review/delete` `{ b }` | `places.review` | take your review back |
| `POST /api/places/message` `{ b, text }` | `places.review` | a private message to its owner |
| `GET /api/places/messages[?b=]` | `places.review` | your messages, for one place of yours or all of them |
| `POST /api/places/messages/read` `{ b }` | `places.review` | mark a place's messages read |
| `POST /api/places/messages/delete` `{ id }` | `places.review` | delete one of your messages |
| `POST /api/places/review/hide` `{ id, reason }` / `{ id, show: true }` | `world.edit` | take a review down, or show it again |
