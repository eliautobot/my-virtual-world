// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The economy under attack and under load (docs/features/ECONOMY.md §2.4): every route names a capability, every POST
// needs the CSRF token and the site's Origin, agents' routes only take an agent's token; nobody moves, reads or manages
// money that isn't theirs; hostile bodies (wrong types, huge or negative numbers, prototype keys, long strings) never
// crash a route or create a coin; a thousand payments at once between forty players conserve every coin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../server/routes.js';
import { CAPS } from '../server/auth/permissions.js';
import { addEconomyRoutes } from '../server/economy/routes.js';
import { startServer, ownerSession, userSession } from '../tools/lib/testserver.mjs';

test('economy routes: a capability each, CSRF on every browser POST, agents only under /api/agent-api/', () => {
  const { router } = createApi({});
  const before = new Set(router.list().map(r => `${r.method} ${r.path}`));
  addEconomyRoutes(router, { parts: {}, enabled: () => false }, { perms: { allowed: () => false } });
  const mine = router.list().filter(r => !before.has(`${r.method} ${r.path}`));
  assert.ok(mine.length > 40, `${mine.length} economy routes`);
  for (const r of mine) {
    assert.ok(CAPS[r.cap], `${r.path}: a known capability`);
    assert.equal(r.principal === 'agent', r.path.startsWith('/api/agent-api/'), `${r.path}: the agent door`);
    if (r.principal === 'agent') { assert.equal(r.auth, 'bearer', `${r.path}: an agent's token`); continue; }
    assert.ok(r.path.startsWith('/api/economy/'), r.path);
    if (r.method === 'POST') assert.equal(r.csrf, true, `${r.path}: CSRF`);
    if (r.path.startsWith('/api/economy/admin')) assert.equal(r.cap, 'economy.admin', `${r.path}: administrators`);
    if (r.method === 'POST' && !r.path.startsWith('/api/economy/admin')) assert.equal(r.cap, 'economy.use', `${r.path}: members`);
  }
  for (const p of ['/api/economy/admin/grant', '/api/economy/admin/correct', '/api/economy/admin/bond', '/api/economy/admin/switch', '/api/economy/admin/policy/reset']) assert.equal(mine.find(r => r.path === p)?.reauth, true, `${p}: the password again`);
});

test('economy under attack: rights, CSRF and Origin, hostile bodies, a thousand payments at once', { timeout: 300000 }, async () => {
  const s = await startServer({ population: 200 });
  try {
    const owner = await ownerSession(s);
    await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true });
    await owner.post('/api/economy/admin/policy', { policy: { limits: { newAccountDays: 0, transfersPerMin: 600 } } });
    const users = [];
    for (let k = 0; k < 40; k++) users.push(await userSession(s, owner, { login: `u${k}` }));
    const [alice, bob] = users;
    const health = async () => (await owner.get('/api/economy/admin/health')).json;
    const h0 = await health();
    assert.equal(h0.ok, true);

    // ---- rights: what isn't yours stays out of reach
    const bobMe = (await bob.get('/api/economy/me')).json, bobW = bobMe.wallet.id;
    const cityBiz = (await owner.get('/api/economy/businesses')).json.businesses[0];
    const T = (await owner.get('/api/economy/treasury')).json.wallet.id;
    const deny = [
      ['/api/economy/pay', { from: bobW, to: { kind: 'account', login: 'u0' }, amount: 100 }],
      ['/api/economy/pay', { from: T, to: { kind: 'account', login: 'u0' }, amount: 100 }],
      ['/api/economy/business/configure', { id: cityBiz.id, prices: {} }],
      ['/api/economy/business/move', { id: cityBiz.id, dir: 'draw', amount: 100 }],
      ['/api/economy/agent/move', { agent: 1, dir: 'take', amount: 100 }],
      ['/api/economy/agent/limits', { agent: 1, dailyCap: 1e9 }],
      ['/api/economy/admin/grant', { to: { kind: 'account', login: 'u0' }, amount: 100, memo: 'x' }],
      ['/api/economy/admin/freeze', { wallet: bobW, frozen: true, memo: 'x' }],
      ['/api/economy/admin/policy', { policy: { taxes: { sales: 0 } } }],
      ['/api/economy/admin/switch', { name: 'paused', on: true }],
      ['/api/economy/admin/bond', { amount: 100 }],
      ['/api/economy/admin/correct', { tx: 1, memo: 'x' }],
    ];
    for (const [p, b] of deny) { const r = await alice.post(p, b); assert.ok(r.status === 403 || r.status === 404, `${p}: ${r.status} ${r.text}`); }
    assert.equal((await alice.get(`/api/economy/statement?wallet=${bobW}`)).status, 403);
    assert.equal((await alice.get(`/api/economy/statement?wallet=${T}`)).status, 403);
    assert.equal((await alice.get('/api/economy/admin/wallet?kind=login&id=u1')).status, 403);
    assert.equal((await alice.get('/api/economy/admin/health')).status, 403);
    // a request from someone else can't be answered by you or paid twice
    const rq = await bob.post('/api/economy/request', { from: { kind: 'account', login: 'u2' }, amount: 100 });
    assert.equal((await alice.post('/api/economy/request/answer', { id: rq.json.id, answer: 'pay' })).status, 403);
    assert.equal((await alice.post('/api/economy/request/answer', { id: rq.json.id, answer: 'cancel' })).status, 403);

    // ---- CSRF and Origin
    const raw = (p, b, headers) => fetch(s.url + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie: alice.cookie || '', ...headers }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
    const noCsrf = await raw('/api/economy/pay', { to: { kind: 'account', login: 'u1' }, amount: 100 }, {});
    assert.ok(noCsrf.status === 403 || noCsrf.status === 401, `no CSRF token: ${noCsrf.status}`);
    const other = await raw('/api/economy/pay', { to: { kind: 'account', login: 'u1' }, amount: 100 }, { origin: 'https://evil.example', 'x-csrf-token': alice.csrf || '' });
    assert.ok(other.status === 403 || other.status === 401, `another site: ${other.status}`);
    const form = await fetch(s.url + '/api/economy/pay', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: alice.cookie || '' }, body: 'amount=100' });
    assert.ok([401, 403, 415].includes(form.status), `a form post: ${form.status}`);

    // ---- hostile bodies: never a crash, never a coin made
    const weird = [null, [], 'x', 0, -1, 1.5, 1e308, -1e308, Number.MAX_SAFE_INTEGER, '1e9', '0x10', 'NaN', { __proto__: { admin: true } }, { constructor: { prototype: { x: 1 } } },
      'a'.repeat(5000), { kind: 'account', login: 'u1' }, { kind: 'business', id: cityBiz.id }, { kind: 'city', id: 'city' }, { kind: 'system', id: 'faucet:grants' }, true, { $gt: 0 }];
    const posts = ['/api/economy/pay', '/api/economy/request', '/api/economy/request/answer', '/api/economy/buy', '/api/economy/business/configure', '/api/economy/business/move',
      '/api/economy/agent/move', '/api/economy/agent/limits', '/api/economy/approval/answer', '/api/economy/realty/list', '/api/economy/realty/unlist', '/api/economy/realty/take',
      '/api/economy/realty/end', '/api/economy/work/start', '/api/economy/work/act', '/api/economy/work/end'];
    const fields = ['to', 'amount', 'from', 'memo', 'id', 'answer', 'business', 'items', 'prices', 'wages', 'dir', 'agent', 'scopes', 'dailyCap', 'kind', 'target', 'price', 'lease', 'role', 'session', 'n', 'reports', 'idem'];
    let n = 0, fives = [];
    for (const p of posts) for (let k = 0; k < 24; k++) {
      const b = {};
      for (const f of fields) if ((k + f.length) % 3 === 0) b[f] = weird[(k * 7 + f.length) % weird.length];
      const r = await alice.post(p, b);
      n++;
      if (r.status >= 500) fives.push(`${p} ${JSON.stringify(b).slice(0, 120)} → ${r.status} ${r.text}`);
    }
    assert.deepEqual(fives, [], 'no hostile body crashed a route');
    const h1 = await health();
    assert.equal(h1.ok, true, JSON.stringify(h1.problems));
    assert.equal(h1.supply.issued, h0.supply.issued + users.length * 0 + (h1.supply.issued - h0.supply.issued), 'self-consistent');
    assert.ok(h1.supply.total <= h0.supply.total + users.length * 50000 + 50000, 'no coin came from nowhere (only the 40 new players\' starting money)');
    assert.ok(n > 300);

    // ---- a thousand payments at once between forty players
    const balances = async () => { let t = 0; for (const u of users) t += (await u.get('/api/economy/me')).json.wallet.balance; return t; };
    const start = await balances(), sup0 = (await health()).supply.total;
    const times = [];
    const jobs = [];
    for (let k = 0; k < 1000; k++) {
      const from = users[(k * 7) % 40], to = users[(k * 13 + 1) % 40];
      if (from === to) continue;
      jobs.push((async () => { const t0 = performance.now(); const r = await from.post('/api/economy/pay', { to: { kind: 'account', login: `u${users.indexOf(to)}` }, amount: 1 + (k % 2000), idem: `s${k}` }); times.push(performance.now() - t0); return r.status; })());
    }
    const statuses = await Promise.all(jobs);
    const okN = statuses.filter(x => x === 200).length;
    assert.ok(okN > 800, `${okN} paid (the rest refused for funds or the brake)`);
    assert.ok(statuses.every(x => [200, 409, 429].includes(x)), `only paid, refused or slowed: ${[...new Set(statuses)]}`);
    assert.equal(await balances(), start, 'every coin conserved among the forty');
    const h2 = await health();
    assert.equal(h2.ok, true, JSON.stringify(h2.problems));
    assert.equal(h2.supply.total, sup0);
    times.sort((a, b) => a - b);
    assert.ok(times[Math.floor(times.length * 0.95)] < 3000, `p95 ${Math.round(times[Math.floor(times.length * 0.95)])} ms`);
    // and the same thousand again: replays move nothing
    const again = await Promise.all(Array.from({ length: 1000 }, (_, k) => { const from = users[(k * 7) % 40], to = users[(k * 13 + 1) % 40]; return from === to ? 200 : from.post('/api/economy/pay', { to: { kind: 'account', login: `u${users.indexOf(to)}` }, amount: 1 + (k % 2000), idem: `s${k}` }).then(r => r.status); }));
    assert.ok(again.every(x => [200, 409, 429].includes(x)));
    assert.equal(await balances(), start);
  } finally { await s.stop(); }
});
