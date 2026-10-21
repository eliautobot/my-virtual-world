# Development

Proprietary — see [LICENSE](../LICENSE). Contributors work only with the owner's authorization.

## Layout and conventions

- `server/` (Node.js, ES modules, no framework), `client/` (no build step), `shared/` (runs on both).
- Every source file starts with the copyright notice; keep it. New routes name a capability; member routes check
  ownership inside; new settings go in `server/settings.js` with the capability that may change them.
- Database changes are new numbered migrations in `server/db.js`, additive; bump the schema tests with them.
- Comments explain *why*; user-facing text is plain and short.

## Tests

```bash
npm test                      # the whole suite (units, HTTP against real servers, security sweeps)
node --test tests/x.test.mjs  # one file
```

HTTP tests start throwaway servers (`tools/lib/testserver.mjs`) on temporary data. Tests that edit the world run
licensed: they import an activated release 1 receipt from `~/.config/mvw-next/test-licence.json` (or the file named by
`MVW_TEST_LICENCE_FILE`) and validate it with Lemon Squeezy, so they need the network; without one, start the server
with `{ demo: true }`.

## Tools

| Tool | What it does |
|---|---|
| `tools/smoke.mjs` | Starts a server and checks the main pages and routes |
| `tools/uitest.cjs` | A browser walk through the main windows (Playwright) |
| `tools/simbench.mjs`, `tools/sim-digest.mjs`, `tools/simhealth.mjs` | Simulation speed, determinism and health |
| `tools/voice-stress.mjs`, `tools/freewill-stress.mjs`, … | Stress runs of the AI paths |
| `tools/admin.mjs` | Account and key administration ([operations](operations.md)) |
| `tools/deploy/` | Backups, restores, release builds and promotion for a native install |
| `tools/chars/`, `tools/brand/`, `tools/wp4/` | Asset pipelines and world-building tools |
