// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Free Will decides more than free time (FREE-WILL.md §11.4), and tasks are worked on where the agent is: when its agent
// is working (a message, a scheduled job) an agent's body works at its desk when it is at work, at the computer when it
// is at home, with a laptop at a table where there is one, else on its phone — woken from sleep if need be, and back to
// bed afterwards. With Free Will the agent chooses how; without, or when the answer is late, the routine does the same.
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
import { ctxB } from '../../shared/constants.js';
import { tempDir } from '../helpers/server.mjs';

function city({ pop = 500, agents = 12, seed = 'fw-tasks' } = {}) {
  const world = generateWorld({ seed, population: pop });
  const roster = Array.from({ length: agents }, (_, k) => ({ agentId: `task-agent-${k + 1}`, name: `Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
  const people = generatePopulation(world, new WorldIndex(world), { population: pop, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 6 * 3600, dayScale: 16 };
  const working = new Set();
  sim.presence = { isWorking: key => working.has(key), info: () => null, ok: true };
  return { world, people, sim, working, advance: dt => { T += dt; }, t: () => T };
}
function withFreeWill(c, { cfg = {} } = {}) {
  const dir = tempDir('mvw-fwt-');
  const dbs = openDb(dir);
  const records = c.people.filter(p => p.vip).map((p, k) => ({ id: k + 1, key: p.agentId, ownerId: null, enabled: true, name: p.name, role: p.role, emoji: '', bodyRef: `person:${p.id}` }));
  const agents = { list: () => records, get: id => records.find(a => a.id === Number(id)) || null, listeners: new Set(), resolver: { resolveBody: ref => c.people.findIndex(p => `person:${p.id}` === ref) } };
  const conn = { id: 7, kind: 'decisions-mock', label: 'Mock', enabled: true, scope: 'installation', config: { latencyMs: 0, priceInPerMTok: 0.1 } };
  let seed = 99; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const fw = new FreeWill({
    dbs, agents, registry: { manifest: () => mockDecisions.manifest, implemented: () => true }, sim: () => c.sim, rand,
    connections: { list: () => [conn], get: () => conn, canUse: () => true }, principalFor: () => ({ account: { id: 1 }, role: 'owner' }),
    config: () => ({ enabled: true, defaultConnection: '7', dailyDecisions: 1e6, agentDailyDecisions: 1e6, keepDays: 7, ...cfg }),
    decide: (cn, request) => mockDecisions.decide({ config: cn.config, request }),
  }).attach();
  for (const a of records) fw.setSettings(a, { enabled: true }, 1);
  return { fw, dbs, records, close: () => { fw.stop(); dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
async function run(c, worldMinutes, fw = null) {
  const end = c.t() + worldMinutes * 60 / 16;
  while (c.t() < end) { c.advance(0.5); c.sim.tick(); fw?.tick(); c.sim.flush(); if (fw && fw.inFlight) await new Promise(r => setImmediate(r)); }
}
const vips = c => c.sim.agents.filter(a => a.p.vip);
const onTask = a => !!a.act && (a.act.use === 'task' || a.act.use === 'task_phone');

test('a task wakes an agent at night; it works at home (or on its phone), then goes back to bed', async () => {
  const c = city();
  c.sim.start();
  c.sim.skipTo(3);
  await run(c, 20);
  const a = vips(c).find(x => x.act && x.act.use === 'sleep' && x.p.home);
  assert.ok(a, 'an agent asleep at home at 3 AM');
  c.working.add(a.p.agentId);
  c.sim.brain.interruptSoon(a);
  await run(c, 6);
  assert.ok(onTask(a), `working on the task (${a.act && a.act.use})`);
  assert.ok(a.act.use === 'task_phone' || ctxB(a.act.ctx) === a.p.home.b, 'at home: the computer, a table with the laptop, or the phone');
  c.working.delete(a.p.agentId);
  c.sim.brain.interruptSoon(a);
  await run(c, 10);
  assert.equal(a.act.use, 'sleep', 'back to bed once the task is done');
  assert.equal(c.sim.errorCount, 0, JSON.stringify(c.sim.errors));
});

test('during working hours at work, a task is worked at the desk; away from desks and tables, on the phone', async () => {
  const c = city();
  c.sim.start();
  c.sim.skipTo(11);
  await run(c, 30);
  const atWork = vips(c).find(x => x.act && x.act.kind === 'work' && x.p.job.b !== undefined && ctxB(x.act.ctx) === x.p.job.b);
  assert.ok(atWork, 'an agent at its desk at 11 AM');
  c.working.add(atWork.p.agentId);
  c.sim.brain.interruptSoon(atWork);
  await run(c, 4);
  assert.equal(atWork.act.use, 'task'); assert.equal(ctxB(atWork.act.ctx), atWork.p.job.b, 'at its own desk');
  // someone outdoors with no table near: the phone
  const ways = c.sim.brain.taskWays(atWork, atWork.plan);
  assert.ok(ways.some(w => w.way === 'desk') && ways.at(-1).way === 'phone', 'the phone is always a way');
  c.working.clear();
  assert.equal(c.sim.errorCount, 0);
});

test('with Free Will, an agent chooses how to work on a task (and the log says so), and what to do after a task at night', async () => {
  const c = city();
  const h = withFreeWill(c);
  c.sim.start();
  c.sim.skipTo(3);
  await run(c, 20, h.fw);
  const a = vips(c).find(x => x.act && x.act.use === 'sleep' && x.p.home);
  assert.ok(a);
  c.working.add(a.p.agentId);
  c.sim.brain.interruptSoon(a);
  assert.equal(a.act.use, 'phone', 'it checks its phone while it decides');
  await run(c, 6, h.fw);
  assert.ok(onTask(a), `working on the task (${a.act && a.act.use})`);
  c.working.delete(a.p.agentId);
  c.sim.brain.interruptSoon(a);
  await run(c, 12, h.fw);
  h.fw.flush();
  const rows = h.dbs.db.prepare('SELECT * FROM agent_decisions WHERE agent_id = ? ORDER BY id').all(h.records.find(r => r.key === a.p.agentId).id);
  const task = rows.find(r => r.choice === 'task');
  assert.ok(task, `a task choice was made (${JSON.stringify(rows.map(r => [r.choice, r.outcome, r.reason]))})`);
  assert.equal(task.outcome, 'chosen');
  assert.ok(JSON.parse(task.options_json).some(o => /phone/i.test(o.label)), 'the phone was one of the ways offered');
  const after = rows.find(r => r.choice === 'after_task');
  assert.ok(after && after.outcome === 'chosen', 'and then what to do after it');
  assert.ok(['sleep', 'stay_up'].includes(after.chosen));
  assert.equal(c.sim.errorCount, 0, JSON.stringify(c.sim.errors));
  h.close();
});

test('with Free Will, meals, mornings and the way to work are chosen too; sleep is never asked about', async () => {
  const c = city({ agents: 16 });
  const h = withFreeWill(c);
  c.sim.start();
  await run(c, 26 * 60, h.fw);
  h.fw.flush();
  const rows = h.dbs.db.prepare("SELECT choice, outcome, chosen, options_json FROM agent_decisions").all();
  const chosen = rows.filter(r => r.outcome === 'chosen');
  const kinds = new Set(chosen.map(r => r.choice));
  for (const k of ['leisure', 'meal', 'morning']) assert.ok(kinds.has(k), `${k} chosen (${[...kinds]})`);
  assert.ok(kinds.has('shift') || rows.some(r => r.choice === 'shift'), 'the way to work is asked about');
  for (const r of chosen) assert.ok(JSON.parse(r.options_json).some(o => o.id === r.chosen), `${r.choice}: one of the options`);
  assert.ok(!rows.some(r => r.choice === 'sleep'), 'never about sleeping');
  const perAgentDay = chosen.length / 16 / (26 / 24);
  assert.ok(perAgentDay > 6 && perAgentDay < 40, `about ${perAgentDay.toFixed(1)} choices an agent a world day`);
  assert.equal(c.sim.errorCount, 0, JSON.stringify(c.sim.errors));
  h.close();
});
