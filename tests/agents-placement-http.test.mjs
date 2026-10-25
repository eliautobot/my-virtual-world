// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Where agents live and work, on a real server in a city of lots (server/sim/placement.js, 2026-10-23: "agents from the
// owner account must either live or work on the owners own buildings"; "not someone elses private business"): a player's
// new agent lives in a flat of their own apartment building and works in their own business; an agent of a player with
// no building there lives and works in the city's buildings of their home town, never on another player's lot; a home
// base moved to a lot with a building of their own: their agent moves in a moment later.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { giveBuilding } from './helpers/own-lot.mjs';

let s, owner, ann, bob, W, lotOf, annApt, annBiz, harbor;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(250); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
const lotsNow = async () => new Map((await owner.get('/api/property/lots')).json.lots.map(l => [l.id, l]));
const make = async (who, name, role) => { const r = await who.post('/api/agents', { name, emoji: '🤖', role }); assert.equal(r.status, 200, r.text); const a = r.json.agent || r.json; return { ...a, i: a.i ?? (await who.get('/api/agents')).json.agents.find(x => x.id === a.id)?.i }; };
const holderOfB = async b => { const L = (await lotsNow()).get(W.buildings[b].lot); return L?.holder?.kind === 'municipality' ? 'city' : `${L?.holder?.kind}:${L?.holder?.id}`; };
const townOfB = async b => (await lotsNow()).get(W.buildings[b].lot)?.town;
/** Whether building B has a 'work' desk or a serving side (from its levels' furniture). */
const hasWork = B => { for (let f = 0; f < B.floors; f++) if ((W.levels[B.lv[f]]?.items || []).some(it => /^(desk|reception|checkout|cafe_counter|fish_counter)/.test(it.t))) return true; return false; };

before(async () => {
  const dir = tempDir('mvw-place-');
  await (await startServer({ data: dir, population: 120 })).stop({ keepData: true });
  const rb = spawnSync(process.execPath, ['tools/wp4/rebuild-city.mjs', '--data', dir, '--server-stopped', '--nx', '3', '--nz', '2'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(rb.status, 0, rb.stderr);
  s = await startServer({ data: dir, population: 120 });
  owner = await ownerSession(s);
  assert.equal((await owner.post('/api/permissions', { cap: 'agents.manage', min: 'member' })).status, 200);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  bob = await userSession(s, owner, { login: 'bob', displayName: 'Bob', role: 'member' });
  W = (await owner.get('/api/world')).json.world;
  // Ann: an apartment building and a business, both hers
  annApt = (await giveBuilding(owner, 'ann', B => B.type === 'apartment')).b;
  annBiz = (await giveBuilding(owner, 'ann', B => B.type !== 'apartment' && B.type !== 'park' && B.type !== 'hq' && hasWork(B))).b;
  // Harbor Town: some of the city's buildings with homes and work, and an empty lot or a park there for Bob
  const lots = await lotsNow(), cityLots = [...lots.values()].filter(l => l.holder?.kind === 'municipality');
  const pick = t => cityLots.find(l => l.buildings.some(b => W.buildings[b]?.type === t) && !l.buildings.includes(annApt) && !l.buildings.includes(annBiz));
  const harborLots = [pick('apartment'), pick('office') || pick('shop') || pick('cafe'), cityLots.find(l => !l.buildings.length || l.buildings.every(b => W.buildings[b]?.type === 'park'))].filter(Boolean);
  assert.equal(harborLots.length, 3, 'an apartment block, a workplace and a park or empty lot of the city');
  assert.equal((await owner.post('/api/property/town', { ids: harborLots.map(l => l.id), town: 'Harbor Town' })).status, 200);
  harbor = { lots: harborLots, park: harborLots[2] };
});
after(async () => { await s?.stop(); });

test('a player\'s new agent lives in their own flat and works in their own business', async () => {
  const nova = await make(ann, 'Nova', 'Shopkeeper');
  const x = await waitFor(async () => { const v = await info(nova.i); return v?.home && v.job?.b >= 0 ? v : null; }, 10000);
  assert.ok(x, `placed (${JSON.stringify((await info(nova.i))?.job)})`);
  const annId = String((await ann.get('/api/auth/me')).json.account.id);
  assert.equal(x.home.b, annApt, `home in her apartment building (${x.home.b} vs ${annApt})`);
  assert.equal(await holderOfB(x.job.b), `account:${annId}`, `work in a business of hers (${W.buildings[x.job.b].name}: ${x.job.title})`);
  assert.match(x.job.title, /^Shopkeeper at /);
});

test('an agent of a player with nothing built: the city\'s buildings in their home town, never another player\'s', async () => {
  // Bob's home base: a park or empty lot in Harbor Town — no homes or work of his own
  assert.equal((await owner.post('/api/property/transfer', { id: harbor.park.id, login: 'bob', reason: 'A test of where agents live' })).status, 200);
  const max = await make(bob, 'Max', 'Data analyst');
  const x = await waitFor(async () => { const v = await info(max.i); return v?.home && v.job?.b >= 0 ? v : null; }, 10000);
  assert.ok(x, 'placed');
  for (const [what, b] of [['home', x.home.b], ['work', x.job.b]]) {
    assert.equal(await holderOfB(b), 'city', `${what}: the city's (${W.buildings[b].name})`);
    assert.equal(await townOfB(b), 'Harbor Town', `${what}: in his home town, Harbor Town (${W.buildings[b].name})`);
    assert.ok(b !== annApt && b !== annBiz, `${what}: never Ann's`);
  }
});

test('a home base moved to a lot with a building of their own: the agent moves in a moment later', async () => {
  const max = (await bob.get('/api/agents')).json.agents.find(a => a.name === 'Max');
  const apt = await giveBuilding(owner, 'bob', B => B.type === 'apartment' && B.idx !== annApt);
  const hb = await bob.post('/api/property/home-base', { lot: apt.lot });
  assert.equal(hb.status, 200, hb.text);
  const x = await waitFor(async () => { const v = await info(max.i); return v?.home?.b === apt.b ? v : null; }, 15000);
  assert.ok(x, `moved into his own apartment building (${(await info(max.i))?.home?.b} vs ${apt.b})`);
});

test('an ordinary resident who works in Harbor Town and needs a home finds one in Harbor Town', async () => {
  const lots = await lotsNow(), townOfIdx = b => lots.get(W.buildings[b]?.lot)?.town;
  const ppl = (await owner.get('/api/people')).json, list = ppl.people || ppl;
  const r = list.find(p => !p.x && !p.ag && p.jb >= 0 && townOfIdx(p.jb) === 'Harbor Town' && p.hb >= 0 && townOfIdx(p.hb) !== 'Harbor Town')
    || list.find(p => !p.x && !p.ag && p.jb >= 0 && townOfIdx(p.jb) === 'Harbor Town');
  assert.ok(r, 'a resident who works in Harbor Town');
  const e = await owner.post('/api/edit', { ops: [{ op: 'person.set', i: r.i, home: 'auto' }] });
  assert.equal(e.status, 200, e.text);
  const x = await waitFor(async () => { const v = await info(r.i); return v?.home ? v : null; }, 8000);
  assert.ok(x, 'a new home');
  assert.equal(townOfIdx(x.home.b), 'Harbor Town', `in the town it works in (${W.buildings[x.home.b].name})`);
});
