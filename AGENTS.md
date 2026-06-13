# My Virtual World Agent Instructions

These instructions are for AI coding agents working in this repository.

## Start Here

Read these files before changing code:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/WORLD-DATA.md`
- `docs/AGENT-INTEGRATION.md`
- `docs/UPDATES-AND-PERSISTENCE.md`
- `docs/SECURITY.md`

Agent-ready workflow skills live in `docs/skills/`.

## Safety Rules

- Do not commit `.env`, runtime data, Docker volumes, local backups, generated screenshots, local memories, or agent workspace state.
- Do not print or store full License Keys, API keys, gateway tokens, Twilio credentials, private hostnames, private IPs, or private local usernames.
- Use placeholders such as `<license-key>`, `<gateway-token>`, `<agent-id>`, and `<private-host>`.
- Do not bypass, remove, weaken, or explain how to bypass demo limits, license checks, activation, or feature locks.
- Do not delete or reset Docker volumes unless the user explicitly asks for a destructive reset.
- Do not push, tag, publish, or create GitHub releases unless the user explicitly approves that action.

## Development Flow

1. Work in the product source checkout first.
2. Use `rg` to find code and docs quickly.
3. Keep changes scoped to the requested behavior.
4. Run `npm test` before handing work back.
5. For Python changes, also run a syntax check or targeted server test.
6. For UI or 3D behavior changes, verify in a browser against the local product port.

The default product port is `8590`. Docker users can map a different outside port with `VW_HOST_PORT`, but most source validation should still treat `8590` as the product baseline.

## Persistence Rules

Saved world data lives under `VW_DATA_DIR`, normally the Docker `vw-data` volume. Updating code with `git pull` and `docker compose up --build -d` must not wipe the saved world.

Starter world creation is only for fresh, uninitialized data. If users delete or customize buildings, agents should preserve that user state.

## Useful References

- API endpoints: `docs/API.md`
- Saved data model: `docs/WORLD-DATA.md`
- Agent communication: `docs/AGENT-INTEGRATION.md`
- Update behavior: `docs/UPDATES-AND-PERSISTENCE.md`
- Agent-facing skill index: `docs/SKILLS.md`
