// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Towns and home bases on a real server, in a city of lots (shared/towns.js, server/towns.js, 2026-10-23): every lot is
// in the world's own town until an administrator puts it in another (a new name makes a new town); everyone sees the
// towns and each lot's; only administrators put lots in towns and rename them; a lot split back stays in its town; an
// account's home base is the lot it chose while it holds it, else the first it came to hold; never someone else's lot.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { MAIN_TOWN, townId, cleanTownName, townName, townColor } from '../shared/towns.js';

let s, owner, ann, bob, lots, worldName;
const lotsNow = async who => new Map((await who.get('/api/property/lots')).json.lots.map(l => [l.id, l]));
const townsNow = async who => (await who.get('/api/towns')).json.towns;
const httpGet = async p => { const { httpClient } = await import('../tools/lib/testserver.mjs'); return httpClient(s.url).get(p); };   // (signed out: anyone)

before(async () => {
  const dir = tempDir('mvw-towns-');
  await (await startServer({ data: dir, population: 120 })).stop({ keepData: true });
  const rb = spawnSync(process.execPath, ['tools/wp4/rebuild-city.mjs', '--data', dir, '--server-stopped', '--nx', '3', '--nz', '2'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(rb.status, 0, rb.stderr);
  s = await startServer({ data: dir, population: 120 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  bob = await userSession(s, owner, { login: 'bob', displayName: 'Bob', role: 'member' });
  lots = [...(await lotsNow(owner)).values()].filter(l => l.holder?.kind === 'municipality').sort((a, b) => a.id.localeCompare(b.id));
  worldName = (await owner.get('/api/world')).json.world.name;
  assert.ok(lots.length >= 8, `city lots (${lots.length})`);
});
after(async () => { await s?.stop(); });

test('names: the world\'s own town is named after the world; a typed name is cleaned; MAIN by its name or id', () => {
  assert.equal(townName(MAIN_TOWN, 'Next City'), 'Next City');
  assert.equal(townName(MAIN_TOWN, ''), 'Main City');
  assert.equal(townName('Claim Town', 'Next City'), 'Claim Town');
  assert.equal(cleanTownName('  Claim \n  Town '), 'Claim Town');
  assert.equal(cleanTownName(''), '');
  assert.equal(cleanTownName('x'.repeat(33)), '');
  assert.equal(cleanTownName('main'), '', 'the world\'s own id is not a name');
  assert.equal(townId('Next City', 'Next City'), MAIN_TOWN);
  assert.equal(townId('main'), MAIN_TOWN);
  assert.equal(townId('<b>Bay</b>'), 'bBay/b');
  assert.equal(townColor('Claim Town'), townColor('Claim Town'), 'a town keeps its colour');
});

test('every lot starts in the world\'s own town; everyone sees the towns', async () => {
  const all = await lotsNow(ann);
  assert.ok([...all.values()].every(l => l.town === MAIN_TOWN));
  const t = await townsNow(ann);
  assert.deepEqual(t.map(x => [x.id, x.name]), [[MAIN_TOWN, worldName || 'Main City']]);
  assert.equal(t[0].lots, all.size);
  assert.ok(t[0].buildings > 0, 'its buildings counted');
});

test('administrators put lots in a town (a new name makes it) and rename it; nobody else may', async () => {
  const ids = lots.slice(0, 4).map(l => l.id);
  assert.equal((await ann.post('/api/property/town', { ids, town: 'Claim Town' })).status, 403, 'a member may not');
  const r = await owner.post('/api/property/town', { ids, town: 'Claim Town' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.ids.length, r.json.town, r.json.name], [4, 'Claim Town', 'Claim Town']);
  assert.equal((await owner.post('/api/property/town', { ids, town: '' })).status, 400, 'a town needs a name');
  const again = await owner.post('/api/property/town', { ids, town: 'Claim Town' });
  assert.deepEqual(again.json.ids, [], 'already there: nothing moves');
  const all = await lotsNow(bob);
  assert.ok(ids.every(id => all.get(id).town === 'Claim Town'), 'anyone sees the lots\' town');
  const t = await townsNow(bob);
  assert.deepEqual(t.find(x => x.id === 'Claim Town')?.lots, 4);
  assert.equal(t[0].id, MAIN_TOWN, 'the world\'s own town first');
  // rename: everything in it moves with it; the world's own is named after the world
  assert.equal((await bob.post('/api/property/town-rename', { from: 'Claim Town', to: 'Claim Village' })).status, 403);
  const rn = await owner.post('/api/property/town-rename', { from: 'Claim Town', to: 'Claim Village' });
  assert.equal(rn.status, 200, rn.text);
  assert.deepEqual(rn.json.ids.sort(), [...ids].sort());
  assert.equal((await owner.post('/api/property/town-rename', { from: MAIN_TOWN, to: 'Elsewhere' })).status, 400);
  assert.equal((await owner.post('/api/property/town-rename', { from: 'Nowhere', to: 'Somewhere' })).status, 404);
  // back to the world's own town, by its name
  const back = await owner.post('/api/property/town', { ids: [ids[3]], town: worldName || 'main' });
  assert.equal(back.json.town, MAIN_TOWN, back.text);
  assert.equal((await lotsNow(owner)).get(ids[3]).town, MAIN_TOWN);
});

test('home base: the first lot an account came to hold, or the one it chose while it holds it; never another\'s', async () => {
  const none = (await ann.get('/api/property/mine')).json.homeBase;
  assert.deepEqual([none.lot, none.town], [null, MAIN_TOWN], 'no property: the world\'s own town');
  const [l1, l2] = [lots[0].id, lots[5].id];   // (l1 in Claim Village, l2 in the world's own town)
  for (const id of [l1, l2]) assert.equal((await owner.post('/api/property/transfer', { id, login: 'ann', reason: 'A test of home bases' })).status, 200);
  let hb = (await ann.get('/api/property/mine')).json.homeBase;
  assert.deepEqual([hb.lot, hb.town, hb.chosen], [l1, 'Claim Village', false], `the first she came to hold (${JSON.stringify(hb)})`);
  const pick = await ann.post('/api/property/home-base', { lot: l2 });
  assert.equal(pick.status, 200, pick.text);
  assert.deepEqual([pick.json.homeBase.lot, pick.json.homeBase.town, pick.json.homeBase.chosen], [l2, MAIN_TOWN, true]);
  assert.equal((await ann.post('/api/property/home-base', { lot: lots[6].id })).status, 403, 'not a lot she holds');
  assert.equal((await bob.post('/api/property/home-base', { lot: l2 })).status, 403, 'not Bob\'s');
  // the chosen lot leaves her: back to the first she holds
  assert.equal((await owner.post('/api/property/transfer', { id: l2, to: 'city', reason: 'Back to the city' })).status, 200);
  hb = (await ann.get('/api/property/mine')).json.homeBase;
  assert.deepEqual([hb.lot, hb.chosen], [l1, false]);
  // cleared: automatic again
  assert.equal((await ann.post('/api/property/home-base', { lot: null })).json.homeBase.lot, l1);
});

test('merged lots keep the town; a merged lot moved to another town and split back: its lots stay in that town', async () => {
  // two city lots side by side (tried in turn: the city's lots that merge)
  const city = [...(await lotsNow(owner)).values()].filter(l => l.holder?.kind === 'municipality').sort((a, b) => a.id.localeCompare(b.id));
  let merged = null, pair = null, why = '';
  for (let i = 0; i < city.length - 1 && !merged; i++) for (let j = i + 1; j < Math.min(city.length, i + 6) && !merged; j++) {
    if (city[i].zoning !== city[j].zoning) continue;
    await owner.post('/api/property/town', { ids: [city[i].id, city[j].id], town: 'Harbor Town' });
    const r = await owner.post('/api/property/merge', { ids: [city[i].id, city[j].id] });
    if (r.status === 200) { merged = r.json.id; pair = [city[i].id, city[j].id]; } else why ||= r.text;
  }
  assert.ok(merged, `two of the city's lots that merge (${why})`);
  let all = await lotsNow(owner);
  assert.equal(all.get(merged).town, 'Harbor Town', 'the merged lot is in their town');
  assert.equal((await owner.post('/api/property/town', { ids: [merged], town: 'Bay Town' })).status, 200);
  const sp = await owner.post('/api/property/unmerge', { id: merged });
  assert.equal(sp.status, 200, sp.text);
  all = await lotsNow(owner);
  assert.deepEqual(pair.map(id => all.get(id).town), ['Bay Town', 'Bay Town'], 'split back: still in Bay Town');
});

test('what each town needs: for everyone, the world and every town (server/town-needs.js)', async () => {
  const r = await httpGet('/api/towns/needs');
  assert.equal(r.status, 200, r.text);
  const ids = (await townsNow(owner)).map(t => t.id).sort();
  assert.deepEqual(r.json.towns.map(t => t.id).sort(), ids, 'every town');
  assert.ok(r.json.world.residents > 0 && Number.isInteger(r.json.world.scores.overall), JSON.stringify(r.json.world.scores));
  for (const t of r.json.towns) assert.ok(Array.isArray(t.issues) && t.name, t.id);
});
