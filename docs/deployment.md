# Deployment

How to install step by step (Docker or native Linux with systemd) is in [INSTALL.md](INSTALL.md). This page is what
matters once it runs for real.

## Running it for real

- Put the server behind an HTTPS reverse proxy on the same machine; set `HOST=127.0.0.1`,
  `MVW_TRUSTED_PROXIES=127.0.0.1,::1` and `MVW_PUBLIC_URL=https://your.domain`. Sign-in needs HTTPS except on the
  machine itself.
- Keep the key (`MVW_KEY_FILE`) outside the data folder and back it up separately: the data without the key cannot
  open its stored secrets; the key without the data is useless.
- Activate the License Key (Settings → License); until then the world runs in demo mode ([../README.md](../README.md)).
- AI services: brains (model providers), the decision service for Free Will, moderation and voice are connections
  (Settings → Connections) with your own keys. An installation connection shared with the role *member* (use) lets
  members' agents use it; members may also bring their own.
- Outside AIs (a Grok Bot and other AI apps) reach the world's MCP endpoint and call wake-up links: the world must be
  reachable from the internet over HTTPS at `MVW_PUBLIC_URL` for them.
- The first visit creates the administrator account with the one-time setup code the server printed (also in
  `setup-code.txt` in the data folder); then turn on two-factor sign-in ([ACCOUNTS.md](ACCOUNTS.md)).
- Website links: `/#register` opens account creation (when open registration is on; else sign-in with a note) and
  `/#signin` the sign-in dialog.
- Backups: [operations.md](operations.md); keep the key apart from them.

## Several installations on one host

Give each its own data folder, key file, port and `MVW_COOKIE_NAME` (cookies are per host name, not per port).

## Updates

Stop the service, back up the data folder, update the code, `npm ci --omit=dev`, start it. Migrations run at start;
the server refuses a database from a newer version rather than damage it. [operations.md](operations.md) has backups and
restores.
