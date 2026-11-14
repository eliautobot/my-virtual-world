# Configuration

The server reads environment variables at start (`server/config.js`) and refuses to start on an invalid one, saying
which. Everything else (what administrators change while it runs) lives in **Settings** (stored in the database,
listed in [reference/settings.md](reference/settings.md)). `.env.example` has every variable with comments.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8570` | HTTP port |
| `HOST` | `0.0.0.0` | Address to listen on; set `127.0.0.1` behind a proxy on the same machine |
| `MVW_DATA` | `./data` | The data folder |
| `MVW_ASSET_CACHE` | the system temp folder | Where the compressed copies of the characters' files are kept (about 0.5 GB, rebuilt after a restart; skipped when that disk has under 1 GB free). The animals' and fish models' copies (about 60 MB) go beside it, in `<folder>-fauna` and `<folder>-fish` |
| `MVW_KEY_FILE` | (none) | Absolute path of the key file (outside the data folder); or `MVW_SECRET_KEY` |
| `MVW_SECRET_KEY` | (none) | The key itself, base64 (instead of a file) |
| `MVW_SECRET_KEY_PREVIOUS` | (none) | The previous key during a rotation (with `MVW_SECRET_KEY`) |
| `MVW_KEY_POLL_MS` | `2000` | How often a changed key file is noticed |
| `MVW_PUBLIC_URL` | the request's | The public address(es), comma-separated: links in invites, push, outside AIs |
| `MVW_TRUSTED_PROXIES` | `none` | Proxies whose `X-Forwarded-*` headers are believed (e.g. `127.0.0.1,::1`) |
| `MVW_COOKIE_NAME` | `__Host-mvw-session` | The session cookie's name (distinct per installation on one host) |
| `MVW_POPULATION` | `1000` | How big a generated city is built (its housing); with `MVW_HOUSING=off`, the residents a new world starts with (1–20,000) |
| `MVW_HOUSING` | `on` | `on`: the residents follow the homes: they fill Settings → Residents → Homes filled of the beds, moving in and away by themselves. `off`: the number stays as it is |
| `MVW_STARTER_MAP` | `on` | `on`: a new world opens with the starting map built for new installations (a hand-built city with metro, parks, an airport, a marina and lake docks). `off`: a city generated from `MVW_SEED`, sized by `MVW_POPULATION` |
| `MVW_SOUNDTRACK` | `on` | `on`: the game's soundtrack (`server/music/soundtrack/`) goes into the music library when the server starts, each song once (one an administrator deletes stays deleted). `off`: the library is left alone |
| `MVW_RADIO` | `on` | `on`: MVW Radio's hosts (agents posted at a Radio Station's broadcast desk) write and read their breaks between songs, each with its own AI brain (Settings → Radio). `off`: no breaks are written; the music and the station idents still play |
| `MVW_UPDATE_CHECK` | `on` | `on`: the server asks GitHub for the latest release a minute after it starts and then every 12 hours (a plain request; nothing about this world is sent) and tells the owner when a newer version is out (Settings → About and the notifications). `off`: never. Settings → General turns it off too |
| `MVW_SEED` | `next-city` | The seed a new world is generated from |
| `MVW_HQ_NAME` | `Headquarters` | The headquarters' rooftop sign (at most 28 characters) |
| `MVW_PROBLEM_SCAN_MS` | `15000` | How often agents' problems (rent, money, home, job) are looked for |
| `MVW_WS_PER_ADDRESS` | `20` | WebSocket connections per address |
| `MVW_WS_MAX` | `1000` | WebSocket connections in all |
| `MVW_PROVIDER_MEDIA_CACHE_MB` | `1024` | Disk space kept for the images, video and audio of agent providers' answers (Agent Providers); the least recently used go first |
| `MVW_GATEWAY_IS_LOCAL` | off | Lets host-process connections reach a gateway on this machine |
| `MVW_PROVIDER_TEST` | off | Test only: lets providers reach local addresses |
| `MVW_PROVIDER_RUN_TIMEOUT_MS` | none | A cap on any one provider run |
| `NODE_ENV` | (none) | `production` in services |

## Settings

Settings → General shows every installation setting the account may change, with who may change it (each names a
capability). Account settings (theme, voice, notifications) are each account's own. Secrets entered in Settings are
sealed with the key and never shown again.
