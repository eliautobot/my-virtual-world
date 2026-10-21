// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// OpenClaw's sub-menu, the gateway side (docs/features/agent-providers.md §6): the methods its pages may call — a fixed
// list, reads and changes apart (a change is recorded by the server; the gateway checks its own scopes: operator.admin
// for its settings) — and what leaves the gateway for a page: no secret's value ever. OpenClaw marks its secret settings
// itself (the config schema's uiHints: sensitive, 204 of them in 2026.9); those, and any field named like a key, token or
// password, are shown as set or not, never their value.

/** What the sub-menu reads. */
export const MENU_READ = Object.freeze(['system.info', 'update.status', 'agents.list', 'models.list', 'models.authStatus', 'skills.status', 'tools.effective', 'tools.catalog',
  'plugins.list', 'plugins.inspect', 'cron.list', 'exec.approvals.get', 'exec.approval.list', 'exec.approval.grants.list', 'sessions.list', 'config.get', 'config.schema.lookup',
  'settings.outline']);
/** What it changes. */
export const MENU_WRITE = Object.freeze(['agents.create', 'agents.update', 'agents.delete', 'skills.update', 'plugins.setEnabled', 'cron.update', 'cron.run', 'cron.remove',
  'exec.approvals.set', 'exec.approval.resolve', 'exec.approval.grants.revoke', 'sessions.patch', 'sessions.delete', 'config.patch']);

const NAMED_SECRET = /(token|secret|password|passphrase|apikey|api_key|privatekey|private_key|credential)s?$/i;
/** A hint path ("models.providers.*.apiKey") as a matcher of concrete paths. */
const matcher = p => new RegExp(`^${p.split('.').map(s => (s === '*' ? '[^.]+' : s.replace(/[[\]{}()^$+?|\\]/g, '\\$&'))).join('\\.')}$`);

/** Every value the gateway marks secret (or that is named like one) replaced by { secret: true, set }. */
export function redact(value, sensitive = [], path = '') {
  const key = path.split('.').pop();
  const secret = path && (sensitive.some(r => r.test(path)) || NAMED_SECRET.test(key));
  if (secret && value !== undefined && value !== null && typeof value !== 'number' && typeof value !== 'boolean') return { secret: true, set: value !== '' };
  if (Array.isArray(value)) return value.slice(0, 500).map((v, i) => redact(v, sensitive, path ? `${path}.${i}` : String(i)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 2000).map(([k, v]) => [k, redact(v, sensitive, path ? `${path}.${k}` : k)]));
  return value;
}

/** The menu's call to the gateway: only a listed method; what it answers, without a secret's value. */
export async function menuCall(link, method, params = {}) {
  if (!MENU_READ.includes(method) && !MENU_WRITE.includes(method)) throw Object.assign(new Error(`${method} is not in OpenClaw's sub-menu`), { code: 'unsupported' });
  if (method === 'settings.outline') return outline(link);
  const out = await link.request(method, params || {}, { timeoutMs: 30000 });
  if (method === 'config.schema.lookup') return out;   // (a schema: its words, no values)
  if (method === 'plugins.inspect') return inspected(out);
  if (method === 'config.get') {
    const s = await sensitivePaths(link);
    return { config: redact(out && out.config, s), hash: out && out.hash, valid: out && out.valid, issues: out && out.issues, warnings: out && out.warnings, path: out && out.path };
  }
  return redact(out, []);
}

/** A plugin as switching it on needs it: what it declares (its tools, providers, channels, hooks, MCP servers…) and is
 *  granted, which credentials it needs (set or not, never their value), and OpenClaw's review token — not a credential:
 *  it names this inspection, so switching on agrees to exactly what was shown (the gateway checks it against a fresh one).
 *  Nothing else (its readme, its files). */
function inspected(out) {
  const o = out || {};
  return { plugin: redact(o.plugin), declared: redact(o.declared), grants: redact(o.grants), components: redact(o.components),
    credentials: (Array.isArray(o.credentials) ? o.credentials : []).slice(0, 50).map(c => ({ label: String(c.label || ''), status: c.status, required: !!c.requiresCredential })),
    reviewToken: typeof o.reviewToken === 'string' ? o.reviewToken.slice(0, 256) : null };
}

/** The settings' sections (OpenClaw's own: label, group, order, help, documentation), and its secret paths — read once
 *  per gateway version from its config schema. */
async function outline(link) {
  const s = await schema(link);
  const sections = Object.entries(s.hints).filter(([k]) => !k.includes('.') && (s.top.includes(k)))
    .map(([key, h]) => ({ key, label: h.label || key, group: h.group || h.label || key, order: Number.isFinite(h.order) ? h.order : 1000, help: h.help || '', docsUrl: h.docsUrl || '', advanced: !!h.advanced }));
  for (const key of s.top) if (!sections.some(x => x.key === key)) sections.push({ key, label: key.replace(/^\w/, c => c.toUpperCase()), group: 'Other', order: 2000, help: '', docsUrl: '', advanced: true });
  return { sections: sections.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)), sensitive: s.sensitive };
}
async function sensitivePaths(link) { return (await schema(link)).matchers; }
async function schema(link) {
  const v = link.hello && link.hello.server && link.hello.server.version;
  if (link.schemaCache && link.schemaCache.v === v) return link.schemaCache;
  const r = await link.request('config.schema', {}, { timeoutMs: 30000 });
  const hints = (r && r.uiHints) || {};
  const sensitive = Object.entries(hints).filter(([, h]) => h && h.sensitive).map(([k]) => k);
  link.schemaCache = { v, hints, sensitive, matchers: sensitive.map(matcher), top: Object.keys((r && r.schema && r.schema.properties) || {}) };
  return link.schemaCache;
}
