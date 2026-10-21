// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A message doesn't wipe out what an agent was doing (server/sim/agents.js bookmark / resumeValid / resumeActivity;
// 2026-10-12: "the bug itself is that it causes a redo of the decision, dismissing what it had already planned"). The
// message still makes it turn to it (its phone, a laptop, its desk); once dealt with, it goes back to the same seat for
// the rest of its time — no new decision, so Free Will isn't asked; its own AI's order (a request to do something else)
// comes instead; what would have ended by then is let go; a talk in the city is the same.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { openDb } from '../../server/db.js';
import { FreeWill } from '../../server/free-will/free-will.js';
import mockDecisions from '../../server/providers/decisions-mock.js';
import { tempDir } from '../helpers/server.mjs';

function city({ pop = 500, agents = 14, seed = 'msg-resume' } = {}) {
  const world = generateWorld({ seed, population: pop });
  const roster = Array.from({ length: agents }, (_, k) => ({ agentId: `res-agent-${k + 1}`, name: `Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
  const people = generatePopulation(world, new WorldIndex(world), { population: pop, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 6 * 3600, dayScale: 16 };
  const working = new Set();
  sim.presence = { isWorking: key => working.has(key), info: () => null, ok: true };
  return { world, people, sim, working, advance: dt => { T += dt; }, t: () => T };
}
function withFreeWill(c) {
  const dir = tempDir('mvw-resume-');
  const dbs = openDb(dir);
  const records = c.people.filter(p => p.vip).map((p, k) => ({ id: k + 1, key: p.agentId, ownerId: null, enabled: true, name: p.name, role: p.role, emoji: '', bodyRef: `person:${p.id}` }));
  const agents = { list: () => records, get: id => records.find(a => a.id === Number(id)) || null, listeners: new Set(), resolver: { resolveBody: ref => c.people.findIndex(p => `person:${p.id}` === ref) } };
  const conn = { id: 7, kind: 'decisions-mock', label: 'Mock', enabled: true, scope: 'installation', config: { latencyMs: 0, priceInPerMTok: 0.1 } };
  let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const fw = new FreeWill({
    dbs, agents, registry: { manifest: () => mockDecisions.manifest, implemented: () => true }, sim: () => c.sim, rand,
    connections: { list: () => [conn], get: () => conn, canUse: () => true }, principalFor: () => ({ account: { id: 1 }, role: 'owner' }),
    config: () => ({ enabled: true, defaultConnection: '7', dailyDecisions: 1e6, agentDailyDecisions: 1e6, keepDays: 7 }),
    decide: (cn, request) => mockDecisions.decide({ config: cn.config, request }),
  }).attach();
  for (const a of records) fw.setSettings(a, { enabled: true }, 1);
  return { fw, dbs, close: () => { fw.stop(); dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
async function run(c, worldMinutes, fw = null) {
  const end = c.t() + worldMinutes * 60 / 16;
  while (c.t() < end) { c.advance(0.5); c.sim.tick(); fw?.tick(); c.sim.flush(); if (fw && fw.inFlight) await new Promise(r => setImmediate(r)); }
}
const wm = m => m * 60 / 16;
/** An agent in the middle of something it would go back to, at a seat or spot, with at least `left` world minutes of it. */
async function busyWithSomething(c, left = 40, fw = null, screen = false) {
  for (let k = 0; k < 60; k++) {
    const now = c.sim.now();
    const a = c.sim.agents.find(x => x.p.vip && x.act && x.act.b >= 0 && x.act.id >= 0 && x.act.k >= 0 && x.act.holdStart <= now
      && x.act.holdEnd - now > wm(left) && (screen ? c.sim.brain.atScreen(x, now)
        : !c.sim.brain.atScreen(x, now) && !['work', 'sleep', 'idle', 'talk', 'meet', 'chat'].includes(x.act.kind) && !['phone', 'task', 'task_phone', 'greet', 'nap'].includes(x.act.use)));
    if (a) return a;
    await run(c, 5, fw);
  }
  return null;
}
/** What the index does when a message starts and ends (index.mjs presence onChange). */
const message = {
  start: (c, a) => { c.working.add(a.p.agentId); c.sim.brain.workChanged(a, true); },
  end: (c, a) => { c.working.delete(a.p.agentId); c.sim.brain.workChanged(a, false); },
};
const same = (x, y) => [x.kind, x.use, x.b, x.f, x.id, x.k].join('|') === [y.kind, y.use, y.b, y.f, y.id, y.k].join('|');

test('a message: it turns to it, and once it is dealt with goes back to the same seat for the rest of its time', async () => {
  const c = city();
  c.sim.start(); c.sim.skipTo(18.5);
  const a = await busyWithSomething(c);
  assert.ok(a, 'an agent in the middle of something');
  const before = { ...a.act };
  message.start(c, a);
  await run(c, 4);
  assert.ok(/^task/.test(a.act.use), `it works on the message (${a.act.use})`);
  message.end(c, a);
  await run(c, 3);
  assert.ok(same(a.act, before), `back to ${before.label} at ${before.place}, not ${a.act.label} at ${a.act.place}`);
  assert.ok(Math.abs(a.act.holdEnd - before.holdEnd) < 1, 'until it was to end');
  assert.equal(a.resume, null);
  assert.equal(c.sim.errorCount, 0, JSON.stringify(c.sim.errors));
});

test('with Free Will: nothing is decided again after the message — it just goes back', async () => {
  const c = city(), h = withFreeWill(c);
  try {
    c.sim.start(); c.sim.skipTo(18.5);
    await run(c, 10, h.fw);
    const a = await busyWithSomething(c, 40, h.fw);
    assert.ok(a);
    const before = { ...a.act }, t0 = Date.now();
    message.start(c, a);
    await run(c, 4, h.fw);
    message.end(c, a);
    await run(c, 3, h.fw);
    assert.ok(same(a.act, before), `back to ${before.label}, not ${a.act.label}`);
    h.fw.flush();
    const id = c.people.filter(p => p.vip).findIndex(p => p.agentId === a.p.agentId) + 1;
    const leisure = h.dbs.db.prepare("SELECT * FROM agent_decisions WHERE agent_id = ? AND choice = 'leisure' AND outcome = 'chosen' AND at >= ?").all(id, t0);
    assert.equal(leisure.length, 0, 'no new free-time decision');
    assert.ok((h.fw.stats.reasons.resume || 0) >= 1, 'Free Will knew it was going back');
  } finally { h.close(); }
});

test('its own AI asking for something else wins; what would have ended by then is let go', async () => {
  const c = city();
  c.sim.start(); c.sim.skipTo(18.5);
  const a = await busyWithSomething(c);
  assert.ok(a);
  message.start(c, a);
  await run(c, 2);
  const r = c.sim.brain.order(a, { kind: 'jog', minutes: 30 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(a.resume, null, 'the bookmark is gone');
  message.end(c, a);
  await run(c, 3);
  assert.equal(a.act.kind, 'jog', `it does what it was asked (${a.act.label})`);

  const b = await busyWithSomething(c, 12);
  assert.ok(b);
  const before = { ...b.act };
  message.start(c, b);
  await run(c, (before.holdEnd - c.sim.now()) * 16 / 60 + 2);   // it works on it past the time it would have ended
  message.end(c, b);
  await run(c, 3);
  assert.equal(b.resume, null);
  assert.ok(!(same(b.act, before) && Math.abs(b.act.holdEnd - before.holdEnd) < 1), 'not taken up again after its time');
  assert.equal(c.sim.errorCount, 0, JSON.stringify(c.sim.errors));
});

test('a talk in the city is the same: afterwards it goes back to what it was doing', async () => {
  const c = city();
  c.sim.start(); c.sim.skipTo(18.5);
  const a = await busyWithSomething(c);
  assert.ok(a);
  const before = { ...a.act }, e = { x: a.plan.x + 1.5, z: a.plan.z };
  assert.ok(c.sim.hold(a.i, e.x, e.z, wm(4)), 'it stops to talk');
  assert.equal(a.act.kind, 'talk');
  await run(c, 7);
  assert.ok(same(a.act, before), `back to ${before.label}, not ${a.act.label}`);
  assert.equal(c.sim.errorCount, 0, JSON.stringify(c.sim.errors));
});

test('at a screen (its desk, its computer, a laptop): it answers right there and carries on — no phone, no getting up', async () => {
  const c = city();
  c.sim.start(); c.sim.skipTo(10.5);
  const a = await busyWithSomething(c, 30, null, true);
  assert.ok(a, 'an agent at a screen');
  const before = { ...a.act };
  message.start(c, a);
  await run(c, 3);
  assert.ok(same(a.act, before) && a.act.holdStart === before.holdStart, `still ${before.label}, not ${a.act.label} (${a.act.use})`);
  assert.ok(!a.resume, 'nothing to go back to: it never left');
  message.end(c, a);
  await run(c, 2);
  assert.ok(same(a.act, before) && a.act.holdStart === before.holdStart, 'and after it, the same');
  assert.equal(c.sim.errorCount, 0, JSON.stringify(c.sim.errors));
});
