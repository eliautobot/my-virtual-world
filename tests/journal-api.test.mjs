// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The edit journal over HTTP and the live stream (PLAN WP1.8, DECISIONS C35, C116) with two admins, a member and a
// guest: each account undoes only its own edits, a later change by someone else refuses the undo with the reason,
// admins revert any edit from the activity log (asking for the password when that removes a building), members read
// the log but change nothing, guests see neither, and the journal survives a restart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { normalizeSpec, checkBuilding } from '../shared/edit.js';
import { makeGrid } from '../shared/city.js';
import { startServer, ownerSession, userSession, httpClient } from './helpers/server.mjs';

let s, owner, ada, ben, mia;
before(async () => {
  s = await startServer({ population: 200 });
  owner = await ownerSession(s);
  ada = await userSession(s, owner, { login: 'ada', displayName: 'Ada', role: 'admin' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'admin' });
  mia = await userSession(s, owner, { login: 'mia', displayName: 'Mia', role: 'member' });
});
after(async () => { await s?.stop(); });

const world = async (c = owner) => (await c.get('/api/world')).json.world;
const bldg = async b => (await world()).buildings[b];
const edit = (c, ops) => c.post('/api/edit', { ops });
const used = new Set();
/** A standing building no other test touched. */
async function pick(pred = () => true) {
  const B = (await world()).buildings.find(b => b && !b.gone && b.type !== 'hq' && b.type !== 'park' && !used.has(b.idx) && pred(b));
  used.add(B.idx);
  return B;
}
function freeLot(w) {
  const g = makeGrid(w.grid);
  for (let z = g.minZ + 10; z < g.maxZ - 10; z += 2) for (let x = g.minX + 10; x < g.maxX - 10; x += 2) {
    const spec = normalizeSpec({ type: 'cafe', w: 12, d: 14, floors: 1, style: 'modern', rot: 0, x, z });
    if (!checkBuilding(w, spec)) return spec;
  }
  return null;
}
/** Makes the account's last password entry older than 10 minutes (as tests/auth.test.mjs does). */
function age(login) {
  const db = new DatabaseSync(path.join(s.data, 'next.db'), { timeout: 5000 });
  try { db.prepare('UPDATE sessions SET auth_at = auth_at - 660000 WHERE account_id = (SELECT id FROM accounts WHERE login = ?)').run(login); }
  finally { db.close(); }
}
async function waitFor(fn, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise(r => setTimeout(r, 40));
  }
}
/** A live-stream connection with the client's cookie (none for a guest); collects its text messages. */
function openWs(client) {
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', client && client.cookie ? { headers: { cookie: client.cookie } } : undefined);
  ws.binaryType = 'arraybuffer';
  const msgs = [];
  ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('WebSocket error')); });
  return { ws, msgs, opened, next: (pred, ms) => waitFor(() => msgs.find(pred), ms) };
}

test('undo and redo are each account\'s own; a later change by another admin refuses the undo and names it (I3.8)', async () => {
  const B = await pick(), n0 = B.name;
  const a1 = await edit(ada, [{ op: 'bld.set', b: B.idx, name: 'Ada Place' }]);
  assert.equal(a1.status, 200, a1.text);
  assert.ok(Number.isInteger(a1.json.edit), 'the answer names the journal entry');
  assert.equal(a1.json.history.undo.summary, `Renamed ${n0} to Ada Place`);
  const none = await ben.post('/api/undo');
  assert.deepEqual([none.status, none.json.code], [409, 'nothing_to_undo'], 'Ben has nothing of his own to undo');
  assert.equal((await edit(ben, [{ op: 'bld.set', b: B.idx, name: 'Ben Place' }])).status, 200);
  const refused = await ada.post('/api/undo');
  assert.deepEqual([refused.status, refused.json.code], [409, 'undo_refused']);
  assert.match(refused.json.error, /Ben changed it later \(renamed Ada Place to Ben Place\)/);
  assert.equal((await bldg(B.idx)).name, 'Ben Place', 'nothing changed');
  assert.equal((await ben.post('/api/undo')).status, 200);
  assert.equal((await bldg(B.idx)).name, 'Ada Place');
  const u = await ada.post('/api/undo');
  assert.equal(u.status, 200, u.text);
  assert.equal(u.json.undone.summary, `Renamed ${n0} to Ada Place`);
  assert.equal((await bldg(B.idx)).name, n0);
  assert.equal((await ada.get('/api/history')).json.redo.summary, u.json.undone.summary);
  assert.equal((await ada.post('/api/redo')).status, 200);
  assert.equal((await bldg(B.idx)).name, 'Ada Place');
});

test('admins revert any edit from the activity log and undo the revert; members read the log but change nothing; guests see neither', async () => {
  const B = await pick(), n0 = B.name;
  assert.equal((await edit(ada, [{ op: 'bld.set', b: B.idx, name: 'Ada Corner' }])).status, 200);
  const log = await mia.get('/api/activity');
  assert.equal(log.status, 200, log.text);
  const line = log.json.items.find(i => i.text === `Renamed ${n0} to Ada Corner`);
  assert.ok(line, 'the member reads the edit in the activity log');
  assert.deepEqual(line.actor, { name: 'Ada' }, 'names only: account ids stay on the server');
  assert.equal(line.status, 'done');
  assert.equal((await fetch(s.url + '/api/activity')).status, 401, 'guests do not see the log');
  const mu = await mia.post('/api/undo');
  assert.equal(mu.status, 409, 'members undo only their own edits (E25), and Mia has none');
  assert.equal(mu.json.code, 'nothing_to_undo');
  assert.equal((await mia.post('/api/revert', { id: line.n })).status, 403);
  assert.deepEqual((await mia.get('/api/history')).json.undoCount ?? 0, 0, 'a member sees only an empty history of their own (E25: holders edit their own lots)');
  const r = await ben.post('/api/revert', { id: line.n });
  assert.equal(r.status, 200, r.text);
  assert.equal((await bldg(B.idx)).name, n0);
  let items = (await mia.get('/api/activity')).json.items;
  assert.deepEqual([items.find(i => i.n === line.n).status, items.find(i => i.n === line.n).revertedBy], ['reverted', 'Ben']);
  assert.equal(items[0].text, `Reverted Ada’s change: renamed ${n0} to Ada Corner`);
  assert.equal((await ben.post('/api/revert', { id: line.n })).json.code, 'not_in_effect');
  assert.equal((await ada.get('/api/history')).json.undo?.summary === `Renamed ${n0} to Ada Corner`, false, 'a reverted edit leaves its author\'s undo');
  assert.equal((await ben.post('/api/undo')).status, 200, 'Ben undoes his revert like any of his own edits');
  assert.equal((await bldg(B.idx)).name, 'Ada Corner');
  items = (await mia.get('/api/activity')).json.items;
  assert.equal(items.find(i => i.n === line.n).status, 'done', 'the reverted edit is in effect again');
  assert.equal((await ben.post('/api/revert', { id: 'x' })).status, 400);
  assert.equal((await ben.post('/api/revert', { id: 999999 })).status, 404);
});

test('a revert that removes a building needs a recent password; an account\'s own undo and redo never ask (C65, C116)', async () => {
  const lot = freeLot(await world());
  assert.ok(lot, 'a free lot');
  const add = await edit(ada, [{ op: 'bld.add', spec: { ...lot, name: 'Revert Café' } }]);
  assert.equal(add.status, 200, add.text);
  const b = add.json.results[0].b;
  used.add(b);
  age('ada');
  assert.equal((await ada.post('/api/undo')).status, 200, 'undoing her new building removes it without asking');
  assert.equal((await bldg(b)).gone, 1);
  assert.equal((await ada.post('/api/redo')).status, 200, 'and redo brings it back without asking');
  assert.ok(!(await bldg(b)).gone);
  const line = (await ben.get('/api/activity')).json.items.find(i => i.text === 'Placed a new cafe, Revert Café');
  assert.ok(line, 'the new building is in the log');
  age('ben');
  const r = await ben.post('/api/revert', { id: line.n });
  assert.deepEqual([r.status, r.json.code], [403, 'reauth_required']);
  assert.match(r.json.error, /^Removing a building needs your password/);
  assert.equal((await ben.post('/api/auth/reauth', { password: ben.password })).status, 200);
  assert.equal((await ben.post('/api/revert', { id: line.n })).status, 200);
  assert.equal((await bldg(b)).gone, 1);
});

test('the live stream: each account\'s pages get its own undo and redo, readers get the activity log, guests neither', async () => {
  const a = openWs(ada), g = openWs(null);
  await Promise.all([a.opened, g.opened]);
  assert.ok(await a.next(m => m.t === 'history'), 'a signed-in page learns its undo and redo on connecting');
  const b = openWs(ben);
  await b.opened;
  assert.ok(await a.next(m => m.t === 'activity' && m.item && m.item.text === 'Ben joined'), 'players joining are in the log');
  const B = await pick();
  assert.equal((await edit(ada, [{ op: 'bld.set', b: B.idx, name: 'Live Place' }])).status, 200);
  const text = `Renamed ${B.name} to Live Place`;
  assert.ok(await a.next(m => m.t === 'activity' && m.item && m.item.text === text), 'the edit reaches its author\'s page');
  assert.ok(await a.next(m => m.t === 'history' && m.undo && m.undo.summary === text), 'with the new undo');
  assert.ok(await b.next(m => m.t === 'activity' && m.item && m.item.text === text), 'and every reader');
  assert.equal(b.msgs.some(m => m.t === 'history' && m.undo && m.undo.summary === text), false, 'but not Ada\'s history');
  assert.equal((await ada.post('/api/undo')).status, 200);
  assert.ok(await b.next(m => m.t === 'activity' && m.update && m.update.text === text && m.update.status === 'undone'), 'the line updates live');
  assert.ok(await b.next(m => m.t === 'activity' && m.item && m.item.kind === 'undo' && m.item.text === `Undid “${text}”`), 'and the undo is a line of its own');
  assert.ok(await g.next(m => m.t === 'patch'), 'guests see the world change');
  assert.equal(g.msgs.some(m => m.t === 'activity' || m.t === 'history'), false, 'but get neither the log nor a history');
  for (const x of [a, b, g]) x.ws.close();
});

test('the owner sets how long world edits are kept; admins see the setting but cannot change it', async () => {
  const row = v => v.settings.find(x => x.path === 'activity.retentionDays');
  const a = row((await ada.get('/api/settings')).json);
  assert.deepEqual([a.value, a.canChange, a.why], [null, false, 'Only the owner can change this']);
  assert.equal((await ada.post('/api/settings', { values: { 'activity.retentionDays': 90 } })).status, 403);
  assert.equal(row((await owner.post('/api/settings', { values: { 'activity.retentionDays': 365 } })).json).value, 365);
  assert.equal(row((await owner.post('/api/settings', { values: { 'activity.retentionDays': null } })).json).value, null);
});

test('the journal survives a restart; the data export lists the account\'s edits; a deleted account\'s entries keep its name', async () => {
  const s2 = await startServer({ population: 120 });
  let s3 = null, stopped = false;
  try {
    const o2 = await ownerSession(s2);
    const cy = await userSession(s2, o2, { login: 'cy', displayName: 'Cy', role: 'admin' });
    const B = (await world(o2)).buildings.find(b => b && !b.gone && b.type !== 'hq' && b.type !== 'park'), n0 = B.name;
    assert.equal((await cy.post('/api/edit', { ops: [{ op: 'bld.set', b: B.idx, name: 'Before Restart' }] })).status, 200);
    await s2.stop({ keepData: true });
    stopped = true;
    s3 = await startServer({ data: s2.data });
    const cy3 = Object.assign(httpClient(s3.url), { cookie: cy.cookie, csrf: cy.csrf });
    const o3 = Object.assign(httpClient(s3.url), { cookie: o2.cookie, csrf: o2.csrf });
    assert.equal((await cy3.get('/api/history')).json.undo.summary, `Renamed ${n0} to Before Restart`);
    assert.equal((await cy3.post('/api/undo')).status, 200, 'undo works after a restart');
    assert.equal((await world(o3)).buildings[B.idx].name, n0);
    const x = await cy3.get('/api/account/export');
    assert.equal(x.status, 200, x.text);
    assert.ok(x.json.worldEdits.some(e => e.summary === `Renamed ${n0} to Before Restart` && e.status === 'undone'));
    const del = await o3.post('/api/users/delete', { id: cy.id });
    assert.equal(del.status, 200, del.text);
    const items = (await o3.get('/api/activity')).json.items;
    assert.equal(items.find(i => i.text === `Renamed ${n0} to Before Restart`).actor.name, 'Cy', 'the entry keeps the name');
  } finally {
    if (s3) await s3.stop();
    else if (!stopped) await s2.stop();
    fs.rmSync(s2.data, { recursive: true, force: true });
    fs.rmSync(`${s2.data}.key`, { force: true });
  }
});
