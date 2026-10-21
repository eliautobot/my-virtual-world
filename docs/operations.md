# Operations

## Health

- `GET /api/health`: up, version, world version, libraries (administrators also see counters and errors).
- `GET /api/ready`: 200 when ready to serve, 503 while starting or stopping.
- The server logs to standard output; services append it to a log file.

## Backups and restores

- A consistent copy: stop the service and copy the data folder, or copy `next.db` live with SQLite's backup
  (`sqlite3 next.db ".backup copy.db"`) together with the world files. `tools/deploy/backup.sh` and `restore.sh` do it
  for a native install.
- Settings → Data (administrators): download a world backup; restore one or reset the residents (the server restarts
  to load it; lots and titles are never touched).
- Back up the key file separately.

## The admin tool

`node tools/admin.mjs <command>` works on the data folder directly (also while the server runs):
`status`, `reset-owner` (a new temporary owner password in the data folder, or before the administrator account exists a new setup code), `create-account`, `sessions-clear`
(signs everyone out), `unlock`, `list-admins`, `new-key`, `rotate-key`, `forget-secrets`, `backup`, `licence-status` and `licence-import`
(a release 1 licence: its `license.json` or its data folder). It never prints a secret.

## Keeping it healthy

- Agents' AI spending is bounded per agent, per account (plans) and per installation (Settings → Free Will & Mind).
- Visitors' conversations are limited and cleared after a few minutes (Settings → General → talk).
- The audit log (Settings → Audit log) records sign-ins, role changes, settings, connections and money actions.
