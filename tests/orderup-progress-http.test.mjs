// Order Up's Rushes that count, over HTTP (PLAN-RESTAURANT-GAME.md "Progression", 2026-10-28): a Rush started in a
// kitchen is laid out by the server (its stations in their order, the place's menu, a seed); played (here by the coach,
// beat by beat, as the page plays) and reported as a log; the server plays it again and records it: experience, the
// Order Up level, the first badges, the Cookbook (its dishes), the next Rush level open. A made-up log counts for what it
// really plays; a Rush outside a kitchen is refused.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, tempDir } from './helpers/server.mjs';
import { interiorBounds } from '../shared/edit.js';
import { normalizeModule, checkModule } from '../shared/interior-kinds.js';
import { newRush, interact, work, step } from '../shared/orderup/rules.js';
import { nextStep } from '../shared/orderup/guide.js';
import { BEAT, COURSES, courseParams } from '../shared/orderup/module.js';

let s, owner, B = null, f = 0;
const edit = ops => owner.post('/api/edit', { ops });
before(async () => {
  s = await startServer({ data: tempDir('mvw-ouprog-'), population: 60 });
  owner = await ownerSession(s);
  const w = (await owner.get('/api/world')).json.world;
  B = w.buildings.filter(b => b && !b.gone && b.type === 'restaurant' && b.w >= 14 && b.d >= 12).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  assert.ok(B, 'a restaurant');
  f = B.floors > 1 ? 1 : 0;
  assert.equal((await edit([{ op: 'lvl.clear', b: B.idx, f }])).status, 200);
  const ib = interiorBounds(B), L = (await owner.get('/api/world')).json.world.levels[B.lv[f]];
  let mod = null;
  for (let k = 0; k < 40 && !mod; k++) {
    const cx = (ib.x0 + ib.x1) / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
    const r = normalizeModule({ kind: 'kitchen', x0: cx - 4.25, z0: ib.z0, x1: cx + 4.25, z1: ib.z0 + 5, face: 0 });
    if (!checkModule(B, f, L, r)) mod = r;
  }
  assert.ok(mod, 'a clear place for a kitchen');
  const r = await edit([{ op: 'imod.add', b: B.idx, f, mod }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
});
after(() => s?.stop());

/** The Rush the server laid out, played by the coach as the page plays it: → the log the page would send. */
function play(data, course) {
  const S = newRush(data.stations, { seed: data.seed, dur: course.dur, kitchen: data.kitchen || undefined, menu: data.menu || undefined, course: courseParams(course) }), log = [];
  const sid = t => data.stations.find(x => x.t === t)?.id;
  let wait = 0, f0 = null;
  for (let n = 0; !S.over && n < 20000; n++) {
    let worked = null;
    if (wait > 0) wait--;
    else {
      const g = nextStep(S);
      if (g.act === 'E' && sid(g.t)) { interact(S, 'you', sid(g.t), g.pick ? { pick: g.pick } : {}); log.push([n, 'E', sid(g.t), ...(g.pick ? [g.pick] : [])]); wait = 10; }
      else if (g.act === 'F' && sid(g.t)) worked = sid(g.t);
    }
    if (worked) { work(S, 'you', worked, BEAT); if (f0 && f0[2] === worked && f0[0] + f0[3] === n) f0[3]++; else { f0 = [n, 'F', worked, 1]; log.push(f0); } }
    step(S, BEAT);
  }
  return { S, log };
}

const pause = () => new Promise(r => setTimeout(r, 1600));   // (one start every 1.5 s)
test('a Rush that counts: laid out by the server from its kitchen, played, checked against the clock; none outside a kitchen', async () => {
  const where = { b: B.idx, f }, warm = COURSES[0];
  assert.equal((await owner.post('/api/play/start', { module: 'orderup', course: 'lunch', where })).status, 403, 'Lunch is not open yet');
  const st = await owner.post('/api/play/start', { module: 'orderup', course: 'warmup', where });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const d = st.json.data;
  assert.ok(d.stations.length >= 8 && d.stations.some(x => x.t === 'ou_pass') && typeof d.seed === 'string', 'its stations and seed');
  assert.ok(d.menu === null || Array.isArray(d.menu), 'its place\'s menu, when it has one');
  const { S, log } = play(d, warm);
  assert.ok(S.served.length >= 4, `served ${S.served.length}`);
  // (two minutes played in no time: the server saw the Rush take less than it played)
  const fin = await owner.post('/api/play/finish', { run: st.json.run, report: { log, score: S.score } });
  assert.equal(fin.json.ok, false); assert.match(fin.json.why, /quicker than the clock/);
  await pause();
  const r = await owner.post('/api/play/start', { module: 'orderup', course: 'warmup', where: { b: B.idx, f: f + 5 } });
  assert.equal(r.status, 409, JSON.stringify(r.json));
});
