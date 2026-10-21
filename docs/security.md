# Security

## Roles

**guest** (not signed in: watches, if the installation allows) · **member** (a player: their own character, lots and
flats, agents, chats, wallet) · **admin** (runs the world: public land, residents, the clock, the economy's policy,
accounts below their own role) · **owner** (the installation: settings, connections, permissions, infrastructure,
ownership transfer).

## Capabilities

Every HTTP route and WebSocket message names one capability; the router refuses anyone whose role is below its lowest
role, and refuses to start with a route that names none. The owner may raise or lower a capability's lowest role in
Settings → Permissions, except the fixed ones. All of them: [reference/capabilities.md](reference/capabilities.md);
every route and its capability: [reference/routes.md](reference/routes.md), also served live to administrators by
`GET /api/routes`.

## Ownership

A member-level route also checks that the record is the caller's, or shared with them:

- **Agents**: its owner, or an account it is shared with, to *use* (chat with it, see it work) or to *manage*
  (everything but removing it or sharing it, which are its owner's alone). A role share gives use only. Connected
  agents are managed only from Settings → Third-party agents.
- **Lots and buildings**: building and furnishing need the lot's title or a delegation of that right; administrators
  run the public land. Flats: their owner, buyer or tenants. Any edit operation without rights of its own is the
  administrators' (fail closed).
- **Chats, attachments, projects, notifications, wallets, orders**: the account's own; another's answers "not found".
- **Visitors**: anyone may talk with another's agent only through the limited conversation (messages, characters and
  time the administrators set), privately; its owner reads every conversation and blocks whom they choose.

## Accounts and sessions

Passwords are hashed with Argon2id and checked against a list of common passwords; sign-in is rate-limited and locks after
repeated failures; two-factor sign-in (TOTP, recovery codes) can be required for the owner and administrators.
Sessions are HTTP-only, `__Host-` cookies over HTTPS; every state-changing request carries a CSRF token and passes an
Origin check; destructive and sensitive actions need the password entered within the last 10 minutes. Roles change only
below one's own role, to roles below one's own, never one's own account.

## Secrets

Provider keys, two-factor secrets and other secrets are sealed with AES-256-GCM under the installation key, never returned to
a browser, never logged, and opened only in the provider helper process per call ([SECRETS.md](SECRETS.md)).

## Proof

`tests/authz-sweep-http.test.mjs` runs on real servers: a member is refused every administrator and owner route the
server answers (read from its own route table, so new routes are swept too), can't raise their role, run the world,
or touch anyone else's agents, connections, chats or private records; an administrator is refused the owner's
controls. Other suites cover the economy under attack, lot rights, invites and roles, demo mode's locks, and the agent API.

## Reporting

See [SECURITY.md](../SECURITY.md).
