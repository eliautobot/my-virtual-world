---
name: virtual-world-persistence-and-updates
description: Update My Virtual World without wiping saved worlds, licenses, or user customization.
---

# Virtual World Persistence and Updates

Use this skill when updating My Virtual World, explaining persistence, or checking whether an update will preserve a user's setup.

## Read First

- `docs/UPDATES-AND-PERSISTENCE.md`
- `docs/WORLD-DATA.md`
- `docs/INSTALLATION.md`

## Safe Update

Normal update:

```bash
git pull
docker compose up --build -d
```

This keeps the Docker `vw-data` volume.

## What Not To Do

Do not run these unless the user explicitly asks to reset the world:

```bash
docker compose down -v
docker volume rm <volume-name>
rm -rf <data-dir>
```

## Verify After Update

```bash
docker compose ps
curl http://localhost:8590/healthz
```

Then check:

- `/api/license`
- `/api/meta`
- `/api/buildings`
- `/api/streets`

Confirm the user's saved buildings, roads, and license status remain.

## Explain Clearly

Tell the user:

- app code updates from GitHub
- saved world data stays in the Docker volume
- fresh starter maps only apply to new, uninitialized worlds
- deleting the volume is what resets the world

## Secrets

Do not expose full License Keys, `.env` values, API keys, tokens, private hostnames, private IPs, or local usernames while debugging updates.
