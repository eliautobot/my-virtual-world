# Release flow (native install with systemd)

Live runs a read-only release folder built from a git tag. Its data lives outside the code, and every deploy is
tested and backed up, and rolls back by itself if anything fails.

```
$MVW_LIVE_ROOT/
  releases/<tag>/     read-only: code at the tag + production dependencies + release.json
  current -> releases/<tag>     what the service runs
  previous -> releases/<tag>    what rollback.sh goes back to
  data/               world, residents and clock (the service's MVW_DATA)
  backups/<time>-<reason>/{data/, manifest.json}
  logs/               server log
  promotions.log      one line per promotion, rollback and restore
```

## Setup
1. Copy `deploy.env.example` to `~/.config/mvw-next/deploy.env` (or set `MVW_DEPLOY_ENV`) and fill in the paths.
2. Give the service unit `WorkingDirectory=$MVW_LIVE_ROOT/current`, `Environment=MVW_DATA=$MVW_LIVE_ROOT/data` and a
   log file under `$MVW_LIVE_ROOT/logs`.
3. Build and link the first release: `tools/deploy/build-release.sh <tag>`, then
   `ln -s releases/<tag> $MVW_LIVE_ROOT/current`, then start the service.

## Commands
Run them from a checkout of the repository (usually `$MVW_REPO`).

| Command | What it does |
|---|---|
| `tools/deploy/build-release.sh <tag>` | Exports the tag into `releases/<tag>`, runs `npm ci --omit=dev`, writes release.json and makes the folder read-only. |
| `tools/deploy/promote.sh <tag>` | 1. Runs the release's tests.<br>2. Stops live (the server saves on stop) and backs up the data.<br>3. Switches `current` and starts live.<br>4. Smoke-tests it against the backup's counts and checks that the process runs the new folder.<br>If anything fails, it restores the backup and the previous release. A release that keeps crashing is caught within seconds. With `MVW_PROMOTE_UITEST=1` the release must also pass the real-browser UI test (on a throwaway server with a copy of the live data) before live is touched.<br>Before it stops live it checks the key for stored secrets with the live unit's environment (`keycheck.mjs`): a key that cannot open every stored secret stops the promotion before anything changes.<br>Then the new release's `configcheck.mjs` checks the live unit's settings the way the new release reads them: a setting it rejects stops the promotion before anything changes. |
| `tools/deploy/rollback.sh [<tag>] [--restore-accounts]` | Goes back to `previous` (or the named tag) with the same backup and checks. It rolls back code, not the world data. The accounts database is made to suit the older release: when every newer schema change only added things its schema number is lowered (nothing lost, `dbschema.mjs`); otherwise the rollback stops, and `--restore-accounts` restores it from the backup taken before the current release was promoted. |
| `tools/deploy/backup.sh [<reason>]` | Hot backup of the data folder. The accounts database (`next.db`) is copied with SQLite's online backup (`dbcopy.mjs`), so the copy is complete even while the server writes. |
| `tools/deploy/restore.sh <backup>` | Stops live, keeps the current data as a backup, copies the backup in, starts and checks. First it checks that live's key opens the backup's stored secrets (backups up to one key rotation old do); otherwise it changes nothing and says how to restore without them. |
| `tools/deploy/staging-refresh.sh` | Copies live's data into the staging copy and restarts it. Accounts come along, but every session is cleared; staging uses its own session cookie name (`MVW_COOKIE_NAME`) because it shares live's host name. Staging keeps a key of its own: the two-factor secrets and the recovery-code key are sealed again with it, every other stored secret is deleted from the copy (`reseal-copy.mjs`), and live's key never goes to staging. |
| `tools/deploy/rehearse.sh --data <folder> --port <port> --from <tag> --to <tag>` | Rehearses the whole flow on a throwaway systemd unit with a copy of a data folder: promote, rollback, a release that crashes on start, one that damages the data, one whose tests fail, backup, restore and pruning. Live is never touched; the unit and its folder are removed afterwards. `--uitest` adds the UI-test gate and a release whose client is broken, which only the browser test can catch. The throwaway unit gets a key file of its own. |
| `tools/deploy/keycheck.mjs --data <folder> [--unit <unit>]` | Checks the key for stored secrets as a unit's service has it (or as this shell has it): set up as the server needs it, and able to open every stored secret. It never migrates the database and never prints a key. |
| `tools/deploy/configcheck.mjs [--unit <unit>]` | Checks a configuration (a unit's, or this shell's) the way this release's server reads it, listing every problem at once. It starts nothing, creates nothing and never prints a key. |
| `tools/deploy/reseal-copy.mjs --data <copy> --from-unit <unit> --to-unit <unit>` | Prepares the stored secrets of a staging copy (used by `staging-refresh.sh`, DECISIONS C99). |
| `tools/deploy/dbschema.mjs version|release-schema|downgrade` | The accounts database's schema number, and lowering it for a rollback when the newer changes only added things (DECISIONS C84). |
| `node tools/smoke.mjs --url <base> [--expect-tag <tag>] [--baseline <manifest.json>]` | Read-only smoke test of any running server. |

Tags are cut from the main branch after the tests pass (`npm test`); CHANGELOG.md lists what each one contains.
