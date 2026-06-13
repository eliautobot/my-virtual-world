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

## What Changes

The update changes:

- source code
- client JavaScript and CSS
- server code
- docs
- Docker image contents
- default starter-world code for future fresh installs

Existing user data remains unless a migration or narrow repair intentionally updates compatible metadata.

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
