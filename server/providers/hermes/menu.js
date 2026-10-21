// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Hermes' sub-menu in Agent Providers (docs/features/agent-providers.md §9): a fixed list of calls, each one of Hermes'
// own - its gateway JSON-RPC or its dashboard's REST, as its dashboard and Desktop settings use them. The changing ones are
// the manifest's menuWrite (a test keeps the two the same). No secret's value leaves Hermes for a page: its secrets
// (/api/env) are never read, and a setting named like a key, token or password comes back as { secret, set }.
const fail = (code, message) => Object.assign(new Error(message), { code });
const SECRET_KEY = /(^|[._-])(api[_-]?key|key|token|secret|password|passwd|credential|auth[_-]?token|private[_-]?key|client[_-]?secret|cookie|bearer)s?$/i;
const name = v => { const s = String(v || '').trim(); if (!/^[\w.@:+-]{1,128}$/.test(s)) throw fail('bad_request', 'That is not a name Hermes takes'); return s; };
const profileOf = p => (p && p.profile ? name(p.profile) : undefined);
const seg = v => encodeURIComponent(name(v));

/** A settings tree with every secret-like value replaced by whether it is set. */
export function redact(v, key = '') {
  if (SECRET_KEY.test(key) && v !== null && typeof v !== 'object' && v !== false) return { secret: true, set: v !== '' && v !== undefined };
  if (Array.isArray(v)) return v.map(x => redact(x, ''));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x, k)]));
  return v;
}
const at = (o, path) => path.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), o);
const nest = (path, value) => path.split('.').reduceRight((v, k) => ({ [k]: v }), value);
function merge(a, b) { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v; return a; }
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

const rest = (l, method, path, p, extra = {}) => l.rest(method, path, { query: { profile: profileOf(p) }, ...extra });

/** What the sub-menu reads. */
export const MENU_READ = Object.freeze({
  'status': l => l.rest('GET', '/api/status'),
  'analytics': (l, p) => l.rest('GET', '/api/analytics/usage', { query: { days: Math.min(90, Math.max(1, Number(p.days) || 30)), profile: profileOf(p) } }),
  'profiles.list': l => l.request('profiles.list', {}),
  'profiles.describe': (l, p) => l.request('profiles.describe', { name: name(p.name) }),
  'models.options': (l, p) => l.request('model.options', { profile: profileOf(p) }, { timeoutMs: 45000 }),
  'config.get': async (l, p) => ({ config: redact(await rest(l, 'GET', '/api/config', p)) }),
  'config.schema': (l, p) => rest(l, 'GET', '/api/config/schema', p),
  'toolsets.list': (l, p) => rest(l, 'GET', '/api/tools/toolsets', p),
  'skills.list': (l, p) => rest(l, 'GET', '/api/skills', p),
  'cron.list': (l, p) => rest(l, 'GET', '/api/cron/jobs', p),
  'mcp.list': (l, p) => rest(l, 'GET', '/api/mcp/servers', p),
  'sessions.list': (l, p) => l.rest('GET', '/api/sessions', { query: { profile: profileOf(p), limit: Math.min(200, Number(p.limit) || 100), offset: Math.max(0, Number(p.offset) || 0) } }),
});

/** What the sub-menu changes (each needs the person's recent password and is recorded - server/agent-providers.js). */
export const MENU_WRITE = Object.freeze({
  'profiles.create': (l, p) => l.request('profiles.create', { name: name(p.name), ...(p.description ? { description: String(p.description).slice(0, 500) } : {}),
    ...(p.clone_from ? { clone_from: name(p.clone_from) } : {}) }, { timeoutMs: 60000 }),
  'model.default': (l, p) => {
    if (typeof p.model !== 'string' || !p.model || typeof p.provider !== 'string' || !p.provider) throw fail('bad_request', 'Which model?');
    return rest(l, 'POST', '/api/model/set', p, { body: { scope: 'main', provider: p.provider, model: p.model, profile: profileOf(p), ...(p.confirm ? { confirm_expensive_model: true } : {}) } });
  },
  'toolsets.set': (l, p) => rest(l, 'PUT', `/api/tools/toolsets/${seg(p.name)}`, p, { body: { enabled: p.enabled === true, profile: profileOf(p) } }),
  'skills.set': (l, p) => rest(l, 'PUT', '/api/skills/toggle', p, { body: { name: name(p.name), enabled: p.enabled === true, profile: profileOf(p) } }),
  'mcp.set': (l, p) => rest(l, 'PUT', `/api/mcp/servers/${seg(p.name)}/enabled`, p, { body: { enabled: p.enabled === true, profile: profileOf(p) } }),
  'cron.pause': (l, p) => rest(l, 'POST', `/api/cron/jobs/${seg(p.id)}/pause`, p, { body: {} }),
  'cron.resume': (l, p) => rest(l, 'POST', `/api/cron/jobs/${seg(p.id)}/resume`, p, { body: {} }),
  'cron.run': (l, p) => rest(l, 'POST', `/api/cron/jobs/${seg(p.id)}/trigger`, p, { body: {} }),
  'cron.remove': (l, p) => rest(l, 'DELETE', `/api/cron/jobs/${seg(p.id)}`, p),
  'sessions.delete': (l, p) => rest(l, 'DELETE', `/api/sessions/${seg(p.id)}`, p),
  /**
   * Settings changed: { profile, changes: { path: value }, base: { path: the value shown } }. Hermes has no revision to
   * send with a change, so it is read again first: a setting changed elsewhere since the page read it refuses the whole
   * change (the page reads them again). Only the changed settings are sent (Hermes merges them into its settings file).
   */
  'config.patch': async (l, p) => {
    const changes = p.changes && typeof p.changes === 'object' && !Array.isArray(p.changes) ? p.changes : null;
    if (!changes || !Object.keys(changes).length) throw fail('bad_request', 'Nothing to change');
    const now = redact(await rest(l, 'GET', '/api/config', p));
    const base = p.base && typeof p.base === 'object' ? p.base : {};
    for (const path of Object.keys(changes)) {
      if (!/^[\w-]+(\.[\w-]+)*$/.test(path) || path.length > 200) throw fail('bad_request', 'That is not a setting');
      if (Object.hasOwn(base, path) && !same(at(now, path), base[path])) throw fail('conflict', 'Hermes\' settings were changed elsewhere meanwhile');
    }
    const patch = {};
    for (const [path, v] of Object.entries(changes)) merge(patch, nest(path, v));
    return rest(l, 'PUT', '/api/config', p, { body: { config: patch, profile: profileOf(p) } });
  },
});

export async function menuCall(link, method, params = {}) {
  const fn = MENU_READ[method] || MENU_WRITE[method];
  if (!fn) throw fail('unsupported', `The Hermes sub-menu has no call ${method}`);
  await link.whenConnected();
  return fn(link, params || {});
}
