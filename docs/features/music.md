# Music: the library, the stages and their panel

The product owner, 2026-10-23: "people who make music and want to put it in MVW they can, so we need to make the club be
able to play users songs"; "some kind of way to add to the playlist, so we can easily add in the future and other
players can add their own some how. So maybe like a UI that can be interacted with when a player or user interacts with
the jazz stage or the dj booth ... And admin should have full control for now."

The city has one music library. Every Lounge Stage and DJ Stage has a deck that plays from it while the band or the DJ
is there, and a panel anyone can open to see what plays, ask for a song or add their own.

## The library

The whole library is also shown in the **Radio Stations window**'s Music Library (`client/js/ui/radio-stations.js`,
2026-11-25; [radio.md](radio.md)): every song with the stations it is on (Used by), listen, add several to a station,
upload, and — administrators — review and delete (a deleted song comes off every station, told first).

Each track has a title, an artist, a genre, its length, its loudness and who added it (server/music/music.js; the table
`music_tracks`, schema 55; the files in `<data>/music/`, one MP3 each). Genres (shared/music.js `GENRES`) belong to a
family that says where they play:

| Family | Genres | Plays at |
| --- | --- | --- |
| Lounge | Jazz, Piano, Bossa nova, Lounge, Soul & R&B | the Lounge Stage |
| Club | House, Techno, Trance, Dubstep, Reggaeton, Hip hop, Dance / EDM | the DJ Stage |
| Radio | Pop, Rock, Other | only where an administrator adds them to a stage's own playlist |
| Game music | (administrators only) | not on a stage: the game's own background music (later) |

A track is **approved** (it plays), **pending** (waiting for an administrator's review) or **rejected** (with a reason its
uploader reads). Only approved tracks are listed to everyone and streamed to everyone; a pending one only to its
uploader and administrators.

**Adding a song** (the panel's Your songs, or `POST /api/music/upload`; the panel keeps the chosen file itself — its file
input is never `required`, as a repaint empties it and the browser would refuse the form; fixed 2026-11-25): a file of up to 25 MB, 30 seconds to 10 minutes,
its title, artist, genre, whether it has explicit lyrics, and (players) the confirmation that it is theirs or they have
the rights to share it in My Virtual World. An administrator's song goes straight into the library; a player's waits for
review (at most 10 waiting each). With ffmpeg on the server, any common audio file (MP3, M4A, OGG, WAV, FLAC) is
converted to one MP3 (192 kbit/s, 48 kHz, no tags or pictures) at the library's loudness (-16 LUFS, one fixed gain).
Without ffmpeg (the official Docker image has none) MP3 files are taken as they are, their length read from the file and
their loudness as the uploader's browser measured it (applied when played).

**The game's soundtrack** (`server/music/soundtrack/`, listed in its `soundtrack.json`) goes into the library when the
server starts (`server/music/soundtrack.js`): each song once, approved, as it is (already at the library's loudness, so
the game music's loop points stay exact), marked `source: 'import'` with `meta.soundtrack`. What a world has taken is kept in its settings
(`music.soundtrack`): a song an administrator deletes stays deleted, a song already imported under the same key is not
added twice, and a later version's new songs come with the next start. `MVW_SOUNDTRACK=off` leaves the library alone.

**Importing a set of songs** on the host (an owner's own music): `node tools/music-import.mjs <list.json>
--data <data folder> [--as-is]` while the server is stopped (docs in the tool). The host backup (`tools/admin.mjs
backup`) includes the songs.

## Albums and artists: the library as a music player (2026-11-25)

The product owner: "upload songs like in a folder and organize them as an album ... MVW Originals, so that should be an
album ... organize them by artist, album ... almost like Spotify, YouTube Music ... the music library is like a music
player, and the stations are the playlists"; "the cover art can be taken from ... the folder that gets uploaded".

- **A song's album** (schema v62: `music_tracks.album`, `album_artist`, `track_no`, `year`): an album is the songs that
  share an album name and an album artist (`shared/music.js albumKey`: however its capitals or spaces are written). Its
  record (`music_albums`) keeps its cover and year. A song with no album is one of its artist's singles. The game's
  soundtrack is the album «Soundtrack 1» by MVW Originals, numbered in `soundtrack.json`'s order (songs taken before
  albums are put on it at the next start: `server/music/soundtrack.js`).
- **Covers** (`POST /api/music/cover?key=`, a JPEG, PNG or WebP up to 3 MB, checked by its bytes; `GET /api/music/cover/<file>`):
  an administrator's at once; a player's only for an album all of whose songs are theirs, waiting for review and approved
  with the first of them. Kept in `<data>/music/covers/`.
- **Uploading an album or a folder** (`client/js/ui/album-upload.js`): choose songs or a folder, or drop them. Each MP3's
  own tags are read in the browser (`client/js/core/id3.js`: ID3v2.2–2.4 and v1 — title, artist, album artist, album,
  number, year, genre, picture; the server's converter drops tags, and the official image has none); the cover is the
  folder's (cover / folder / front / album / artwork, else its one image, else the largest), else a song's own picture,
  made a JPEG of at most 1000 px. Everything is shown first — album, artist, year, genre, cover, each song's number and
  title, which to leave out — then sent one song at a time, then the cover. A player's album waits for review whole: 20
  songs at once, then four a minute, at most 40 waiting (the form waits and goes on by itself).
- **The library** (`client/js/ui/music-library.js`, in the Radio Stations window): **Songs** (title, artist, album,
  genre, length, plays, the stations it is on — sorted by any), **Albums** (covers; an album's page: its songs in order,
  artist, year, length, add it to a station; administrators rename it or change its cover), **Artists** (their albums,
  singles and most played; add them all to a station), **Genres**, **Review** (administrators: by album, approve or reject
  an album at once). One search for songs, albums and artists. Pick songs: add them to a station; administrators edit
  their album, artist, genre or year at once (`POST /api/music/tracks`) or rename an album (`POST /api/music/album`).
- **Hosts** search albums and add a whole one to their station (`find_albums`, `playlist_add_album`; radio.md).

## The city's own music in the background

`client/js/audio/score.js` (2026-10-26): the score (the library's `score` songs, each with its mood and loop points: the
game's soundtrack) plays as you go about the world. The mood of the moment (`shared/music.js` `scoreMood`): `build` while
building or furnishing, else by the city's hour: `day` from 5:30, `evening` from 17:30, `night` from 20:30. A song loops
seamlessly between its loop points for two and a half to four minutes (`SCORE.turn`), then another of its mood comes in
over a 7 s crossfade; a new mood comes in over 4 s. Its volume is Settings → Sound → **Background music** (`sound.score`,
40 % by default; the master volume and the top bar's mute too). It makes way: silent where live music is heard (a band
or a DJ: the stage's level, by distance), lower while an agent speaks (35 %) or the page listens to you (15 %), and while
a machine's or a cabinet's game is open (30 %). It fetches a song only when it is to play (nothing while its volume is
0; turned down to 0 it lets the song go after 4 s), keeps at most two decoded at 32 kHz, starts with the first click or
key (browser rules), and stops while the page is hidden. `app.score.state` shows what plays. Checks:
`tests/score.test.mjs`; lab `tools-bin/score-check.mjs` (a real browser: day, night, building, the dip, off and on, at
most two decoded) and `tools-bin/score-club-check.mjs` (silent in a club while the DJ plays).

## A stage's deck

One for each Lounge Stage and DJ Stage (a building, a floor, the piece: `b:f:id`), kept by the server (table
`music_decks`):

- **What plays**: only while someone performs there (the band, use `perform`; the DJ, use `dj`), seen from the city's
  people every 2 seconds. A song starts 1.5 s after it is chosen (every browser loads it) and plays to the end; the band
  leaves 3 s between songs; the DJ starts the next track 8 s before the last one ends and blends them. When the band or
  the DJ leaves, the music stops; a request cut short before its middle goes back to the front of the line. A stage
  empty for a moment plays on (MUSIC.grace, 20 s: a performer between one stretch at work and the next was gone for a
  fraction of a second, and the song stopped and another began).
- **The requests**: one waiting song per player at each stage (asking again replaces it), at most 20 in line, played
  before the playlist. A player takes theirs back; an administrator removes any or clears them all.
- **The playlist**: by default every approved song of the stage's family (or of one genre for the night), shuffled,
  never one of the last few or one already asked for; or the stage's own playlist, played in order. The next three
  songs are shown.
- **Settings** (administrators): requests on or off, the genre for the night, all of its family's music or its own
  playlist (add, reorder, remove), skip, clear the requests.

Everyone sees and hears the same: the deck's `now` is a song and the moment it started by the server's clock; the
server sends every change to every page (WebSocket `music`, `music_lib`, `music_review`).

## Who picks a stage's music: its performer (2026-11-25)

The product owner: "if an agent is placed on the DJ booth ... the agent is allowed to use the music library as the
source"; a regular resident at the DJ booth plays "the standard MVW album", the lounge "what currently plays"; "a user
wants to request a song ... the agent can go to the music library, pick it out, and play it ... the stage music agents
and the DJs are interactive as well".

- **Who performs** (`music.js performing`): the band member or the DJ at the stage now; an AI agent among them leads. An
  agent posted at a stage's seat (the ⋯ on it) is its musician or DJ, as one working its shifts there is
  (`server/sim/agents.js postDuty`: the stage roles' uses, `shared/nightlife.js ROLE_USE`).
- **What it plays** (`pool`): an AI agent's own set there (any song of the library; its first change starts from what the
  stage plays: `editSet`), else the administrators' playlist, else — at the DJ booth — the club songs of the MVW
  Originals album, else every approved song of the stage's family (the lounge, as before).
- **Requests to an AI agent with a brain** (`agentDecides`): any song of the library, with a word for it (`note`, up to
  `MUSIC.noteMax`); they wait in `asks` (not the queue). Its brain (`server/music/dj.js`, the Mind's `brainOf`) is asked
  with what is on, its queue and the requests, and answers which to play (into the queue) and which to pass on with a
  short reason the player reads (screened; a failed one becomes a kind default), and maybe a line to the room, said out
  loud in its own voice (screened). Unanswered after `MUSIC.askWait` (10 min) a request plays. Without a brain, or with a
  resident on stage: the queue as before (the stage's own music only).
- **Its tools**: in its chats (`server/mind/tools.js`: `stage`, `find_songs`, `find_albums`, `stage_add`,
  `stage_add_album`, `stage_remove`, `stage_play_request`, `stage_pass_request`); connected agents through the act route
  and the MCP tool `stage_music`.
- **The panel** says who picks the music; asking a deciding agent searches the whole library (songs, artists, albums) with
  a word for them; its answers show (played, or passed and why). The deck carries `performer`, `asks`, `answers` (30 min)
  and the agent's `set`.

## Hearing it

In the browser (client/js/audio/nightlife-music.js), a stage whose deck has songs in the library plays the recording
the deck has on, streamed from `/api/music/file/<id>` (byte ranges), at the second the server's clock says, and kept in
step (more than 0.35 s off: it seeks). It is heard as the band always was: on that floor, louder the closer the player
or the camera is, panned to the stage, at **Settings → Sound → Live music**. The DJ's blend fades the next track in
and the last one out. A stage with nothing in the library keeps the synthesised band and DJ.

## The panel

A 🎵 over every stage on the floor being looked into (its bars move while music plays). A click on it or on the stage,
or E next to the stage when walking, opens the panel (client/js/ui/music-panel.js), on the right, or a sheet from the
bottom on a phone:

- **Now playing**: the song, its artist and genre, how far in, who asked for it, whether the band or the DJ is on.
- **Up next**: the requests (yours marked, with Take back), then the playlist's next songs.
- **Request**: the stage's songs, searchable, by genre; Ask for it (signed in, while requests are on).
- **Your songs**: add a song; what became of yours (playing, waiting, not accepted and why); delete one that isn't
  playing.
- **Run** (administrators): requests on or off, the genre tonight, all the music or its own playlist, skip, clear.
- **Review** (administrators): the songs waiting (listen, approve, reject with a reason), the whole library with its
  plays (delete).

## Who may do what

| Capability | Lowest role | Allows |
| --- | --- | --- |
| `world.view` | guest | the library, the decks, the songs' files (approved) |
| `music.request` | member | asking for a song, taking it back |
| `music.upload` | member | adding a song (reviewed), deleting one's own while it isn't approved |
| `music.manage` | admin | running every stage, adding songs straight into the library, review, editing and deleting any song |

For now administrators run every stage; floor owners running their own stages comes later.

## Routes

| Route | Capability | |
| --- | --- | --- |
| `GET /api/music/state` | world.view | the library, every deck, what the viewer may do |
| `GET /api/music/library` | world.view | the library as the viewer sees it |
| `GET /api/music/deck?place=b:f:id` | world.view | one stage's deck (made if it has none) |
| `GET /api/music/file/<id>` | world.view | a song's MP3, with byte ranges |
| `POST /api/music/request` `{ place, track }` | music.request | ask for a song: `{ position, replaced }` |
| `POST /api/music/request/cancel` `{ place, index? }` | music.request | take one's request back (an administrator: any, by index) |
| `POST /api/music/upload?title&artist&genre&explicit&rights` | music.upload | the file as the body |
| `POST /api/music/delete` `{ id }` | music.upload | |
| `POST /api/music/deck` `{ place, requests?, genre?, playlist? }` | music.manage | |
| `POST /api/music/skip`, `/api/music/clear` `{ place }` | music.manage | |
| `POST /api/music/review` `{ id, approve, reason? }` | music.manage | |
| `POST /api/music/track` `{ id, title?, artist?, genre?, explicit? }` | music.manage | |

## Music made with ElevenLabs

The game's soundtrack (26 songs: the lounge's, the club's, the game's own music) was made with ElevenLabs on the
product owner's own account and ships with the game in `server/music/soundtrack/` under
[its own license](../../server/music/soundtrack/LICENSE.md), not the assets' CC BY-NC-SA: the songs may be played only
inside My Virtual World, never offered on their own, as a music library for others to use, remixed, or resold. Players
never generate music through the world's account.

## Checks

- `tests/music.test.mjs`: a stage plays its family's approved songs only while the band or the DJ is there, requests
  first (one each; taken back when the band leaves early), a breath between the band's songs, the DJ's blend, its own
  playlist in order, a genre night, skip, a deleted song leaves every list, a stage taken away takes its deck; decks and
  the library outlast a restart; an MP3's length from its bytes.
- `tests/music-http.test.mjs`: uploads (an administrator's approved, a player's reviewed, the rights, junk refused, a WAV
  converted), who sees and streams what (byte ranges), the review, deleting; a lounge's deck, requests and taking them
  back, running a stage (administrators only).
- `tests/soundtrack.test.mjs`: every soundtrack song is there (an MP3 of a library song's length, a known genre, its own
  key, loop points inside it) with its license; the songs go in once, approved, as they are; a deleted one stays
  deleted; one already imported is not added twice; a broken file is skipped; a later version's new songs come next
  start; the server adds them at start (`MVW_SOUNDTRACK` on), the tests' servers leave the library alone.
- Lab `tools-bin/music-panel-check.mjs`: on a throwaway server with the soundtrack's songs, at a lounge and a club in the
  evening: the 🎵 moves, the page streams the deck's recording at the server's second, the panel shows it, a request
  goes in line and plays after a skip; the phone's sheet.
