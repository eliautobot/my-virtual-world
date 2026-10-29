// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's life (docs/features/FREE-WILL.md §5): it only watches — a city with it attached plans exactly what one
// without it plans — and turns what agents do into an activity log, memories and relationships; the owner's profile
// and plans are checked and kept small; body traits change the resident's routine; Free Will is told who the agent is.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { openDb } from '../../server/db.js';
import { AgentLife, SHORT_DAYS } from '../../server/agent-life/life.js';
import { traitsOf, applyBody, traitWords, TRAITS } from '../../server/agent-life/traits.js';
import { FreeWill } from '../../server/free-will/free-will.js';
import mockDecisions from '../../server/providers/decisions-mock.js';
import { tempDir } from '../helpers/server.mjs';

function city({ pop = 500, agents = 16, seed = 'life-unit' } = {}) {
  const world = generateWorld({ seed, population: pop });
  const roster = Array.from({ length: agents }, (_, k) => ({ agentId: `life-agent-${k + 1}`, name: `Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
  const people = generatePopulation(world, new WorldIndex(world), { population: pop, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 6 * 3600, dayScale: 16 };
  return { world, people, sim, advance: dt => { T += dt; }, t: () => T };
}
function lifeOn(c, { saved = [] } = {}) {
  const dir = tempDir('mvw-life-');
  const dbs = openDb(dir);
  const records = c.people.filter(p => p.vip).map((p, k) => ({ id: k + 1, key: p.agentId, ownerId: null, enabled: true, name: p.name, role: p.role, emoji: '', bodyRef: `person:${p.id}` }));
  const agents = { list: () => records, get: id => records.find(a => a.id === Number(id)) || null, listeners: new Set(),
    resolver: { resolveBody: ref => c.people.findIndex(p => `person:${p.id}` === ref) }, isOwner: () => true, canManage: () => true };
  const life = new AgentLife({ dbs, agents, sim: () => c.sim, savePerson: i => saved.push(i) });
  return { life, dbs, records, agents, close: () => { life.stop(); dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
async function run(c, worldHours, fw = null) {
  const end = c.t() + worldHours * 3600 / 16;
  while (c.t() < end) { c.advance(0.5); c.sim.tick(); fw?.tick(); c.sim.flush(); if (fw && fw.inFlight) await new Promise(r => setImmediate(r)); }
}

test('it only watches: a city with every agent\'s life recorded plans exactly what one without it plans', async () => {
  const digest = async attach => {
    const c = city({ seed: 'life-parity', pop: 400 });
    const h = attach ? lifeOn(c) : null;
    if (h) h.life.attach();
    const hash = crypto.createHash('sha256');
    c.sim.listeners.add(b => hash.update(Buffer.from(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength)));
    c.sim.start();
    await run(c, 30);
    if (h) { assert.ok(h.life.activity(1).length > 0, 'and it did record'); h.close(); }
    return hash.digest('hex');
  };
  assert.equal(await digest(true), await digest(false));
});

test('the activity log: one line per activity (a shift with its breaks is one), places, chats, nothing trivial', async () => {
  const c = city();
  const h = lifeOn(c);
  h.life.attach();
  c.sim.start();
  await run(c, 40);
  h.life.flush();
  const all = h.dbs.db.prepare('SELECT * FROM agent_activity').all();
  assert.ok(all.length > 16 * 8, `lines were written (${all.length})`);
  const kinds = new Set(all.map(r => r.kind));
  for (const k of ['sleep', 'work', 'meal']) assert.ok(kinds.has(k), `${k} is logged (${[...kinds]})`);
  for (const r of all) { assert.ok(r.label && r.world_time && r.minutes >= 0); assert.ok(!/undefined|null/.test(r.label), r.label); }
  // the stretches of a shift between coffee breaks are one line: a new work line only comes after something else
  // (lunch, a chat, a meeting) — never right after another work line at the same place
  const byAgent = new Map();
  for (const r of all) { if (!byAgent.has(r.agent_id)) byAgent.set(r.agent_id, []); byAgent.get(r.agent_id).push(r); }
  for (const rows of byAgent.values()) {
    for (let k = 1; k < rows.length; k++) {
      const x = rows[k - 1], y = rows[k];
      assert.ok(!(x.kind === y.kind && x.place === y.place && x.world_day === y.world_day && x.kind !== 'chat'), `merged: ${x.label} / ${y.label}`);
    }
  }
  const live = h.life.activity(1);
  assert.ok(live.length >= 1 && live[0].when, 'the line in progress is shown first');
  assert.equal(c.sim.errorCount, 0);
  h.close();
});

test('memories write themselves from real events; relationships grow with every chat; private agents data is pruned when they go', async () => {
  const c = city({ agents: 24 });
  const h = lifeOn(c);
  h.life.attach();
  c.sim.start();
  await run(c, 40);
  h.life.flush();
  const mems = h.dbs.db.prepare('SELECT * FROM agent_memories').all();
  assert.ok(mems.some(m => m.kind === 'place' && /^First time at /.test(m.text)), 'first visits are remembered');
  const perDay = new Map();
  for (const m of mems) { const k = `${m.agent_id}|${m.world_day}`; perDay.set(k, (perDay.get(k) || 0) + 1); }
  assert.ok([...perDay.values()].every(n => n <= 20), 'at most 20 a world day each');
  const rels = h.dbs.db.prepare('SELECT * FROM agent_relations').all();
  if (rels.length) {
    for (const r of rels) { assert.ok(r.interactions >= 1 && r.affinity > 0 && r.affinity <= 1 && r.trust > 0 && r.trust <= 1); }
    assert.ok(mems.some(m => m.kind === 'person' && /^Met /.test(m.text)), 'meeting someone is remembered');
    // (co-workers know each other without a word: "Works with me at ..."; any other relation came from a chat)
    if (rels.some(r => !/^Works with me/.test(r.note || ''))) assert.ok(h.dbs.db.prepare("SELECT COUNT(*) AS n FROM agent_activity WHERE kind = 'chat' AND with_name IS NOT NULL").get().n >= 1);
  }
  // short-term memories fade after SHORT_DAYS world days
  const day = h.life.today();
  h.dbs.db.prepare("UPDATE agent_memories SET world_day = ? WHERE id = (SELECT MIN(id) FROM agent_memories WHERE term = 'short')").run(day - SHORT_DAYS - 1);
  const before = h.dbs.db.prepare("SELECT COUNT(*) AS n FROM agent_memories WHERE term = 'short'").get().n;
  h.life.purge();
  assert.equal(h.dbs.db.prepare("SELECT COUNT(*) AS n FROM agent_memories WHERE term = 'short'").get().n, before - 1);
  // an agent that is removed takes its life with it
  h.records.splice(0, 1);
  h.life.purge();
  for (const t of ['agent_activity', 'agent_memories', 'agent_relations']) assert.equal(h.dbs.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE agent_id = 1`).get().n, 0, t);
  h.close();
});

test('the profile: traits 0..1, body traits go onto the resident (its routine changes too), texts are cleaned and bounded', async () => {
  const c = city();
  const saved = [];
  const h = lifeOn(c, { saved });
  h.life.attach();
  const p0 = h.life.profile(1);
  assert.deepEqual(Object.keys(p0.traits), TRAITS.map(t => t.key));
  assert.ok(Object.values(p0.traits).every(v => v >= 0 && v <= 1));
  assert.equal(p0.traits.spontaneity, 0.5);
  const p = h.life.setProfile(1, { traits: { sociability: 1, curiosity: 0.9 }, flags: { nightOwl: true }, bio: 'Line one\u0007 <b>two</b>', likes: ['jazz', '', 'x'.repeat(200)], purpose: 'Run the best café', locked: ['curiosity'] }, { id: 1 });
  assert.equal(p.traits.sociability, 1); assert.equal(p.traits.curiosity, 0.9); assert.equal(p.flags.nightOwl, true);
  assert.ok(p.bio.startsWith('Line one') && !/[<>\u0007]/.test(p.bio), `no markup or control characters (${p.bio})`);
  assert.deepEqual(p.likes.map(x => x.length), [4, 60], 'empty items dropped, long ones cut');
  const i = h.life.byAgent.get(1);
  assert.equal(c.people[i].tr.soc, 1, 'sociability is the resident\'s own trait');
  assert.equal(c.people[i].tr.night, 1);
  assert.deepEqual(saved, [i], 'the resident is saved');
  for (const bad of [{ traits: { curiosity: 2 } }, { traits: { madeUp: 0.5 } }, { flags: { nightOwl: 'yes' } }, { locked: ['nope'] }, { likes: 'jazz' }, { bio: 5 }]) {
    assert.throws(() => h.life.setProfile(1, bad, { id: 1 }), e => e.status === 400 && /^bad_/.test(e.code), JSON.stringify(bad));
  }
  assert.deepEqual(traitWords({ ...p.traits, ambition: 0.5 }, { nightOwl: true }).slice(-1), ['a night owl']);
  h.close();
});

test('plans: must and want, at most a dozen open, done or dropped; Free Will hears about them, and about places it has never been', async () => {
  const c = city();
  const h = lifeOn(c);
  h.life.attach();
  h.life.addIntention(1, { kind: 'must', text: 'Pay the rent', today: true });
  h.life.addIntention(1, { kind: 'want', text: 'Try a new café' });
  assert.throws(() => h.life.addIntention(1, { kind: 'maybe', text: 'x' }), /must.*want/);
  assert.throws(() => h.life.addIntention(1, { kind: 'want', text: '   ' }), /Write/);
  for (let k = 0; k < 10; k++) h.life.addIntention(1, { kind: 'want', text: `idea ${k}` });
  assert.throws(() => h.life.addIntention(1, { kind: 'want', text: 'one more' }), /At most/);
  const plans = h.life.intentions(1);
  h.life.setIntention(1, plans.find(x => x.text === 'idea 0').id, 'done');
  h.life.removeIntention(1, plans.find(x => x.text === 'idea 1').id);
  assert.equal(h.life.intentions(1).filter(x => x.status === 'open').length, 10);
  const ctx = h.life.contextFor(1);
  assert.ok(ctx.plans.length <= 3 && ctx.plans[0].startsWith('must'), 'musts first, three at most');

  // Free Will with this life: the question names plans, the personality and how well it knows each place
  const config = { enabled: true, defaultConnection: '7', dailyDecisions: 1e6, agentDailyDecisions: 1e6, keepDays: 7 };
  const conn = { id: 7, kind: 'decisions-mock', label: 'Mock', enabled: true, scope: 'installation', config: { latencyMs: 0, priceInPerMTok: 0.1 } };
  const asked = [];
  const fw = new FreeWill({
    dbs: h.dbs, agents: h.agents, registry: { manifest: () => mockDecisions.manifest, implemented: () => true }, sim: () => c.sim,
    connections: { list: () => [conn], get: () => conn, canUse: () => true }, principalFor: () => ({ account: { id: 1 }, role: 'owner' }), config: () => config,
    context: id => h.life.contextFor(id), spontaneity: { get: id => h.life.traitsFor(id).spontaneity, set: (id, v) => h.life.setProfile(id, { traits: { spontaneity: v } }, { id: 1 }) },
    decide: (cn, request) => { asked.push(request); return mockDecisions.decide({ config: cn.config, request }); },
  }).attach();
  for (const a of h.records) fw.setSettings(a, { enabled: true }, 1);
  fw.setSettings(h.records[0], { spontaneity: 0.9 }, 1);
  assert.equal(h.life.traitsFor(1).spontaneity, 0.9, 'spontaneity is a character trait: one value');
  assert.equal(fw.settingsOf(1).spontaneity, 0.9);
  c.sim.skipTo(17.5);
  c.sim.start();
  await run(c, 10, fw);
  assert.ok(asked.length > 0);
  const text = asked.map(r => r.input).join('\n'), labels = asked.flatMap(r => r.questions[0].choices.map(x => x.description)).join('\n');
  assert.match(text, /Plans: must Pay the rent/);
  assert.match(labels, /never been|been once before|been \d+ times/, 'venues say how well the agent knows them');
  assert.ok(asked.every(r => r.input.length < 1600), 'still small');
  fw.stop();
  h.close();
});

test('traits: body traits read and write the resident on the 0..1 scale', () => {
  const p = { tr: { soc: 0.6, act: 0.1, food: 1.3, home: 0.55, night: 0, phone: 1 } };
  const t = traitsOf('k', p, { curiosity: 0.2 });
  assert.equal(t.sociability, 0.5); assert.equal(t.activity, 0); assert.equal(t.appetite, 1); assert.equal(t.curiosity, 0.2);
  assert.equal(applyBody(p, { activity: 1, appetite: 0 }, { phone: false }), true);
  assert.deepEqual([p.tr.act, p.tr.food, p.tr.phone], [1, 0.5, 0]);
  assert.equal(applyBody(p, { activity: 1 }), false, 'no change, nothing to save');
});
