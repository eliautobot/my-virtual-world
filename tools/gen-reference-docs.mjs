#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Writes docs/reference/{capabilities,settings,routes}.md from the code itself, so the reference never drifts:
// capabilities from server/auth/permissions.js, settings from server/settings.js, routes from a throwaway server's own
// GET /api/routes. Run before a release: node tools/gen-reference-docs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'reference');
fs.mkdirSync(OUT, { recursive: true });
const { CAPS } = await import(path.join(ROOT, 'server/auth/permissions.js'));
const { SETTINGS } = await import(path.join(ROOT, 'server/settings.js'));
const cell = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const HEAD = title => `# ${title}\n\nGenerated from the code by \`tools/gen-reference-docs.mjs\` - do not edit by hand. Proprietary - see [LICENSE](../../LICENSE).\n\n`;

// capabilities
let caps = HEAD('Capabilities') + 'Roles, low to high: guest, member, admin, owner. *Fixed*: the owner cannot change its lowest role. *Identity*: needs a signed-in account.\n\n| Capability | Lowest role | Fixed | Identity | What it allows |\n|---|---|---|---|---|\n';
for (const [k, c] of Object.entries(CAPS)) caps += `| \`${k}\` | ${c.min} | ${c.fixed ? 'yes' : ''} | ${c.identity ? 'yes' : ''} | ${cell(c.desc)} |\n`;
fs.writeFileSync(path.join(OUT, 'capabilities.md'), caps);

// settings
let st = HEAD('Settings') + 'Changed in Settings by an account holding the capability named; *install* settings are the installation\'s, *account* settings each account\'s own.\n\n| Setting | Scope | Type | Default | Who may change it | What it is |\n|---|---|---|---|---|---|\n';
for (const s of SETTINGS) {
  const def = s.secret ? '(secret)' : typeof s.default === 'object' ? JSON.stringify(s.default) : s.default;
  st += `| \`${s.path}\` | ${s.scope} | ${s.type}${s.options ? ` (${s.options.map(o => o.value ?? o).join(', ')})` : ''} | ${cell(def)} | \`${s.cap || ''}\` | ${cell(s.label)}${s.help ? ` - ${cell(s.help)}` : ''} |\n`;
}
fs.writeFileSync(path.join(OUT, 'settings.md'), st);

// routes, from a running server's own table
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const s = await startServer({ population: 120, agents: 1, demo: true });
try {
  const owner = await ownerSession(s);
  const routes = (await owner.get('/api/routes')).json.routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  let r = HEAD('HTTP routes') + `${routes.length} routes. Each names one capability (see [capabilities](capabilities.md)); *Re-auth*: the password entered within the last 10 minutes. Routes for connected agents (\`/api/agent-api/\`) authenticate with their own bearer token or signature.\n\n| Method | Path | Capability | Lowest role | Re-auth |\n|---|---|---|---|---|\n`;
  for (const x of routes) r += `| ${x.method} | \`${x.path}\` | \`${x.cap}\` | ${x.min} | ${x.reauth ? 'yes' : ''} |\n`;
  fs.writeFileSync(path.join(OUT, 'routes.md'), r);
  console.log(`docs/reference: ${Object.keys(CAPS).length} capabilities, ${SETTINGS.length} settings, ${routes.length} routes`);
} finally { await s.stop(); }
