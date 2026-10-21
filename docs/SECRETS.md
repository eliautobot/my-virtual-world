# Stored secrets and settings

Some settings are credentials. From the next release on these include provider tokens, speech keys and SMS
accounts; today they are the two-factor secrets of accounts and the key behind their recovery codes. They are stored
encrypted in `<data folder>/next.db` and never shown again: screens and APIs only say whether one is set.

## The key

Secrets are encrypted with AES-256-GCM under one 32-byte key. The key lives outside the data folder, so backups and
copies of the data do not contain it. Set exactly one of these:

| Variable | Meaning |
|---|---|
| `MVW_KEY_FILE` | The absolute path of the key file, outside the data folder. If the file does not exist and nothing is stored encrypted yet, the server creates it, readable only by its user. |
| `MVW_SECRET_KEY` | The key itself, in base64 (44 characters). Other programs of the same user, the service manager and `docker inspect` can read environment variables, so the server warns at every start. Prefer a key file; with Docker, a secret file. |
| `MVW_SECRET_KEY_PREVIOUS` | Only with `MVW_SECRET_KEY`: the previous key, during a rotation. |

The Docker image keeps the key in a volume of its own (`MVW_KEY_FILE=/keys/secret.key`), and the native example unit in
`/var/lib/my-virtual-world/keys/secret.key`. [INSTALL.md](INSTALL.md) shows how to back it up in each.

The server refuses to start in any of these cases:
- neither variable is set, or both are;
- `MVW_KEY_FILE` is a relative path, or lies inside the data folder;
- stored secrets cannot be opened with the key.

If the key file is readable by other users and the server owns it, the server makes it readable only by its owner.
If the server does not own it (for example a read-only Docker secret), it warns instead.

`node tools/admin.mjs new-key <file>` writes a new key file. Its content also works as `MVW_SECRET_KEY`.

**Back up the key separately from the data.** Without it every stored secret is lost: people set up two-factor
sign-in again, and credentials have to be entered again. Accounts and the world are not affected. To restore a backup
on another machine, you need its key as well.

The admin Settings screen shows the key's fingerprint and any problem the server has with it. The fingerprint is a
short public name for the key, not the key.

## Rotating the key

Run `node tools/admin.mjs rotate-key --data <folder> --key-file <key file>`. It writes a new key file that holds the
new key and the previous one, then seals every stored secret again with the new key. A running server switches within
seconds.

The previous key stays until the next rotation, so backups up to one rotation old stay readable. After a leak, add
`--forget`: the old key is dropped at once and the two-factor recovery codes are deleted. People then create new
recovery codes in Account settings.

To rotate a key that comes from `MVW_SECRET_KEY`:
1. Write a new key with `new-key`.
2. Set `MVW_SECRET_KEY_PREVIOUS` to the old key and `MVW_SECRET_KEY` to the new one.
3. Restart the server. It seals everything again at start.
4. Remove `MVW_SECRET_KEY_PREVIOUS` at the next rotation, or at once after a leak.

Suppose the key file changes to a key that cannot open the stored secrets while the server runs. The server then keeps
the keys it already has, logs an error every minute and shows the problem to admins, until the file is fixed. The
release flow checks the key before it stops the server (`tools/deploy/keycheck.mjs`), and refuses to promote until the
key works.

## Secrets that cannot be opened

When the key that sealed some secrets is gone, the server does not start, and it names the missing key's fingerprint.
You can either point `MVW_KEY_FILE` (or `MVW_SECRET_KEY`) at the right key, or delete what cannot be opened:

`node tools/admin.mjs forget-secrets --unreadable --data <folder> --key-file <key file>`

`forget-secrets --all --yes` deletes every stored secret. An account whose two-factor secret was deleted signs in
with its password alone until it sets two-factor sign-in up again.

## Staging copies

`tools/deploy/staging-refresh.sh` copies live's data into staging. Staging keeps a key of its own:
- the two-factor secrets and the recovery-code key are sealed again with staging's key
  (`tools/deploy/reseal-copy.mjs`), so people sign in to staging the same way as on live;
- every other stored secret (service credentials) is deleted from the copy.

Live's key never goes to staging.

## Settings

Settings come in three tiers:

| Tier | What | Changing it needs |
|---|---|---|
| 0 Preferences | Harmless choices, such as an account's display preferences | the account itself, or the setting's role |
| 1 Secrets | Credentials, shown only as set / not set | the setting's role and a password entry within the last 10 minutes |
| 2 Infrastructure | How the installation runs and who may do what: require sign-in, open registration, two-factor for admins, audit retention | the setting's role and a password entry within the last 10 minutes |

- `GET /api/settings` (admins) lists the installation settings, with their tier and whether the caller may change
  each one. `POST /api/settings` with `{ "values": { "<name>": value } }` changes them. For a secret, an empty text
  keeps the stored value and `null` clears it.
- `GET /api/account/settings` and `POST /api/account/settings` cover the own account's settings. Display preferences
  (name labels, interior walls, the folded people list, the controls tip) follow the account to every device.
  Graphics quality stays with each device.
- A setting whose name ends like a credential (token, secret, password, apiKey, …) is always a tier 1 secret.
- Log lines and settings answers pass through one redaction helper: fields named like credentials, and every secret
  value the server has handled, become `[redacted]`.
- The audit log records changes to tier 1 and 2 settings and to an account's own secrets. It says "set" or "cleared",
  never the value.
