# Updates and Persistence

Status: product reference  
Scope: Docker updates, saved world data, and non-destructive maintenance

## Main Rule

Updating My Virtual World should update code, not wipe user worlds.

Normal update:

```bash
git pull
docker compose up --build -d
```

This keeps the Docker `vw-data` volume.

## What Is Preserved

The Docker volume preserves:

- world metadata
- buildings
- furniture
- roads and chunks
- decorations
- agent assignments
- agent profiles
- license receipt
- local app settings
- runtime communication history
- Live Agent durable goal/task/step ledgers

## What Changes

The update changes:

- source code
- client JavaScript and CSS
- server code
- docs
- Docker image contents
- default starter-world code for future fresh installs

Existing user data remains unless a migration or narrow repair intentionally updates compatible metadata.

`world-meta.json` uses atomic compact writes. Identical saves do not rewrite the file, stale abandoned temp files are cleaned after a configurable age, and the last-known-good backup is throttled separately from primary writes. Live Agent and world-action histories are compacted within configurable byte budgets while preserving active state and the newest retained records.

Live Agent storage separates cognitive memory from operational telemetry. Resident Profile memories are consolidated into durable semantic experiences before short-term records age out. Terminal move paths, event diagnostics, and planner scaffolding are compacted independently, so storage control does not depend on erasing identity, relationships, lessons, or important failures.

Live Agent durable goals are orchestration state stored in `world-meta.json`. Normal rebuilds and restarts preserve goal/task/step dependencies, retries, and verified outcomes. The selected-agent Live Mode reset is the explicit operation that clears one resident's ledger.

## Live Agent Storage Migration

Preview the deterministic migration against an existing Docker volume:

```bash
docker compose exec virtual-world python3 /app/scripts/migrate-live-agent-storage.py --data-dir /data
```

Apply it while the app service is stopped:

```bash
docker compose stop virtual-world
docker compose run --rm --no-deps virtual-world python3 /app/scripts/migrate-live-agent-storage.py --data-dir /data --apply
docker compose start virtual-world
```

The apply step creates one compressed pre-migration archive in `/data/storage-migration-backups`, rewrites changed files atomically, refreshes the normal compact `world-meta.json.bak`, and records `live-agent-storage-v2` in world metadata. Re-running the migration is a no-op. It does not open or modify provider-owned chat transcripts, workspaces, or framework memory.

Verify the compaction behavior with:

```bash
python3 scripts/verify-live-agent-storage-limits.py
```

## Fresh Install vs Existing Install

Fresh install:

- no saved world exists
- starter world can be seeded
- `world-meta.json` gets `initialized: true`

Existing install:

- saved world data already exists
- starter world should not be recreated
- user deletions and customizations should remain

## What Wipes Data

These actions can reset or delete saved data:

```bash
docker compose down -v
docker volume rm <volume-name>
rm -rf <data-dir>
```

Do not run these unless the user explicitly asks to reset data.

## Before Risky Changes

For user-owned installs, make a backup before migrations or destructive operations:

```bash
docker compose stop virtual-world
docker run --rm -v my-virtual-world_vw-data:/data -v "$PWD":/backup alpine tar czf /backup/vw-data-backup.tgz -C /data .
docker compose start virtual-world
```

The volume name may differ by Compose project. Use `docker volume ls` to confirm it.

## Starter Repairs

The server may include narrow compatibility repairs for known starter-world metadata issues. Repairs should follow these rules:

- only target known starter records
- verify expected object ids/types/positions before changing data
- preserve user customization
- do not recreate deleted user objects
- do not replace the whole world

## Testing an Update

Recommended local verification:

```bash
npm test
docker compose up --build -d
curl http://localhost:8590/healthz
```

Then open the app and confirm:

- saved world still appears
- license status is unchanged
- buildings and roads are still present
- agent connections still work if configured

## GitHub Release Flow

For product release work:

1. Change and verify the source product checkout first.
2. Confirm the local `8590` product version works.
3. Push to GitHub only after owner approval.
4. Rebuild a separate install from GitHub for install verification.
5. Publish a release only after the GitHub install passes checks.
