# Accounts

Everyone can watch the world without an account. Changing it needs one, and each account has a role:

| Role | Can do (defaults) |
|---|---|
| Guest (not signed in) | Watch the world: residents, buildings, and which agents are working, not what they are working on |
| Member | Also talk to residents, and manage the own account |
| Admin | Also edit the world, direct residents, run the world clock, manage member accounts, change world settings |
| Owner | Everything, including admins, what each role may do, and what agents are working on |

The owner can change the minimum role of most capabilities (`GET/POST /api/permissions`). Capabilities that need a
signed-in account never go to guests. Admins can require sign-in to watch (`POST /api/settings/world`).

## The administrator account (first start)

A new installation has no account. Whoever installed it creates the **administrator** — the world's owner — with their
own username, display name and password:

1. Find the one-time **setup code**. The server prints it when it starts (`Setup code: XXXX-XXXX`), and writes it to
   `<data folder>/setup-code.txt`, readable only by the server's user (mode 0600). Docker:
   `docker compose logs app`; systemd: `journalctl -u my-virtual-world`.
2. Open the world. The **Welcome** dialog asks for the code and the account: username, display name and password (at
   least 12 characters; common passwords are refused).
3. **Create the administrator.** You are signed in as the owner; the code is used up and its file deleted.

The code proves you are the one who installed the server: a page never shows it. Wrong codes lock that address out like
wrong passwords (5 within 15 minutes). Lost it? `node tools/admin.mjs reset-owner` writes a new one.

Account settings (the account chip in the top bar) change the display name, the username (asks for the password)
and the password, list the signed-in devices, and sign out one device or all.

Signing in needs HTTPS, except on `http://localhost` and `http://127.0.0.1`.

## A forgotten password

There are no password emails: an admin resets the password in **Settings → Users** (a temporary password, shown once,
that the person replaces at their next sign-in); for the owner, run `node tools/admin.mjs reset-owner` on the server.

## Managing accounts

Admins open **Settings** (⚙️) from the top bar (the owner sees more):

- **Users**: every account — name, username, role, status, two-factor sign-in and when it was last seen; search by
  name or username. Create accounts (with a temporary password shown once), reset passwords and two-factor sign-in,
  disable and enable, change roles (the owner), delete accounts (their data is deleted or given to another account),
  and hand ownership to an admin (the owner; the former owner becomes an admin). Admins manage only accounts below
  their own role.
- **Invites**: links that let one person create an account with a chosen role (member, or admin when the owner
  invites), valid 1 to 30 days, revocable until used. The link is shown once; its token sits after `#`, which
  browsers never send to a server.
- **Audit log**: sign-ins and failures, account, role, permission, credential, invite and settings changes, host tool
  actions, with the client address. Filter by kind, account and dates; export as CSV or JSON Lines. Nobody can change
  or delete events; the owner can set how long they are kept (forever by default).
- **Settings**: require sign-in to watch; open self-registration (off by default; at most 5 new accounts per address
  per 15 minutes); require two-factor sign-in for admins and the owner (it applies from their next sign-in); audit
  retention (the owner).

## Two-factor sign-in

Account settings → Two-factor sign-in → Set up: scan the QR code with an authenticator app (or type the key), enter one
code, and keep the ten recovery codes (each signs in once). Signing in then asks for a code after the password. A code
works once. Lost the phone and the codes? An admin resets your two-factor sign-in; for the owner, run
`node tools/admin.mjs reset-owner` on the server.

## Your data

Account settings → Your data: **Download my data** (profile, devices, audit events about you, invites you created)
and **Delete my account** (after the password; the owner hands over ownership first). Audit events about a deleted account
are kept as recorded.

## Recovery

All on the server, in the code folder. None of these commands prints a password.

| Command | What it does |
|---|---|
| `node tools/admin.mjs status --data <folder>` | The owner's state, account and session counts |
| `node tools/admin.mjs reset-owner --data <folder>` | Before the administrator account exists: a new setup code in `setup-code.txt`. After: a new temporary owner password in `first-owner-password.txt` (72 hours); unlocks and re-enables the owner and signs it out everywhere |
| `node tools/admin.mjs create-account --login <name> --name <display name> --role member\|admin --password-stdin --data <folder>` | Creates an account; the password is read from standard input (typed without echo on a terminal) |
| `node tools/admin.mjs sessions-clear --data <folder>` | Signs everyone out |
| `node tools/admin.mjs unlock <login> --data <folder>` | Clears an account's sign-in failure locks |
| `node tools/admin.mjs list-admins --data <folder>` | The owner and the admins |

`--data` defaults to `$MVW_DATA`, else `./data`. The commands work while the server runs; it notices sign-outs made
here within a minute. Each command is recorded in the audit log as a host action; `reset-owner` also turns off the
owner's two-factor sign-in. The key commands (`new-key`, `rotate-key`, `forget-secrets`) are described in
[SECRETS.md](SECRETS.md); commands that open stored secrets take `--key-file <file>`, the file the server's `MVW_KEY_FILE` names.

## Security

- Passwords: Argon2id (19 MiB, 2 passes); 12 to 1,024 characters; not the sign-in or display name; not on a list of
  46,129 common passwords (SecLists, MIT; see `server/auth/common-passwords.README.md`).
- Sign-in: 5 wrong passwords for one account from one address lock that address out of the account for 15 minutes;
  50 from any addresses lock the account for everyone for 15 minutes; 20 failures from one address block that address
  for 15 minutes. Password confirmations count the same way. The counters are kept across restarts. Unknown sign-in
  names answer exactly like wrong passwords, and take as long.
- Sessions: an HttpOnly, Secure, SameSite=Strict `__Host-` cookie; the server stores only a SHA-256 hash of the token.
  A session ends after 30 days without use, or 90 days after sign-in. Changing the password signs out the other
  devices. Account settings list the signed-in devices; each can be signed out, or all at once.
- Every change needs the session's CSRF token, a same-site `Origin` and a JSON body. Creating or changing accounts,
  changing the own username, permissions and world settings, demolishing buildings and removing floors also need
  the password within the last 10 minutes.
- Display names must be unique; names that only differ by look-alike characters (`0`/`o`, `1`/`l`, Cyrillic or Greek
  letters, `rn`/`m`, separators) count as the same.
- The live world stream accepts at most 20 connections per client address and 1,000 in total.
- Temporary passwords (first owner, admin resets) expire after 72 hours and must be replaced at the first sign-in.

## Configuration

Every setting of an installation is described in [.env.example](../.env.example) and [INSTALL.md](INSTALL.md). The ones
that concern accounts:

| Variable | Default | Meaning |
|---|---|---|
| `MVW_TRUSTED_PROXIES` | `none` | Addresses or subnets of reverse proxies whose `X-Forwarded-For` / `X-Forwarded-Proto` are believed. Behind a proxy on the same machine (Caddy, nginx): `127.0.0.1,::1`. Without it, sign-in through the proxy is refused, because the server cannot tell that the visitor uses HTTPS. |
| `MVW_PUBLIC_URL` | (unset) | The address(es) people open, comma-separated, e.g. `https://world.example.org`. When set, only these origins (and loopback) may change things. |
| `MVW_COOKIE_NAME` | `__Host-mvw-session` | The session cookie's name. Two installations under one host name (on different ports) need different names. |
| `MVW_PRESENCE_POLL_MS` | `20000` | How often agent presence is polled. |
| `MVW_WS_PER_ADDRESS` / `MVW_WS_MAX` | `20` / `1000` | Live world stream connections per client address, and in total. |
| `MVW_KEY_FILE` / `MVW_SECRET_KEY` | required, exactly one | The key for stored secrets (two-factor secrets and the recovery-code key; later tokens and speech keys): the absolute path of a key file outside the data folder, created readable only by the server's user at the first start, or the key itself. Back it up separately from the data. See [SECRETS.md](SECRETS.md). |

The accounts and the audit log live in `<data folder>/next.db` (SQLite). Back it up with `node tools/admin.mjs backup` (the world and the
accounts in one file; [INSTALL.md](INSTALL.md)), `tools/deploy/backup.sh` or `node tools/deploy/dbcopy.mjs`, never with a
plain file copy while the server runs.
