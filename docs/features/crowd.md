# The crowd and the Crowd Studio

## The crowd

The city's residents are drawn from a library of parts made by the character builder (`client/assets/crowd/`: a body, a
head, hair, a beard, a top, bottoms and shoes for each sex, at four levels of detail — close-up, near, middle and far),
each resident wearing its own mix in its own colours (`client/js/render/characters.js`), the level of detail picked by
how big they are on the screen. It is always on. Agents, players and characters built in the Agent Studio keep their
own look.

How the crowd moves and fits — the animation fixes for the men's and women's bodies, how clothes sit, the faces — is its
**tuning** (`shared/crowd-tuning.js`). The release carries its own (`client/assets/crowd/tuning.json`), and its library
was baked with it, so a server needs nothing more (no browser, no bake). `GET /api/crowd/tuning` gives the tuning in use
to every page that draws the crowd.

## The Crowd Studio (off by default)

`client/dev/crowd-studio.html` is where a tuning is made: the outfits in the crowd, the skeleton (turning and moving
joints, per animation), undo and redo (Ctrl+Z, Ctrl+Y / Ctrl+R), and the level of detail the library is baked with.

It is there only when the server is started with **`MVW_CROWD_STUDIO=1`** (`server/config.js`, `.env.example`). Off —
the default —:

- its pages (`/dev/crowd-studio*`) and the simplifier only it uses (`/vendor/meshopt/`) are not found (404);
- the tuning can't be changed: `POST /api/crowd/tuning` is not there (405) — for no one, not even the owner;
- the library can't be baked again: `/api/crowd/bake` is not there (404);
- everyone still sees the crowd, drawn with the tuning in use.

Switched on, an administrator (the capability `world.edit`) may save a tuning of the installation's own; it is kept in
the data folder (`crowd-tuning.json`) and used instead of the release's from then on, even after the studio is switched
off again. Baking the library again with other levels of detail needs a browser on the server (playwright-core and
Chrome); the Docker image has none, and says so.

Checks: `tests/crowd-studio-switch.test.mjs` (off and on, on a real server), `tests/crowd-tuning.test.mjs`,
`tests/crowd-bake.test.mjs`.
