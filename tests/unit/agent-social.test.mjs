// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents and friends (server/agent-social/; 2026-10-10), on a generated city with a real database and a
// virtual clock: the rule (each counts the other as a friend, their owners are friends, each owner allows it - and no
// block), messages (checked, delivered once, replies, refused ones kept and felt), every limit counted from what is kept
// (a restart doesn't start them again), where a friend is (never inside a home), friendships ending (cooling off, then
// growing from nothing), fading with time apart, strangers' lines, invitations as appointments (kept, stood up, lapsed),
// the Mind answering, and the cost of it all at scale.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { evalPlan } from '../../server/sim/plan.js';
import { openDb } from '../../server/db.js';
import { AgentLife } from '../../server/agent-life/life.js';
import { AgentSocial, SocialError, DROPS, INVITE } from '../../server/agent-social/social.js';
import { localCheck } from '../../server/mind/speech.js';
import { worldSeconds, ctxB } from '../../shared/constants.js';
import { tempDir } from '../helpers/server.mjs';

const DEFAULTS = { 'social.enabled': true, 'social.friendAt': 50, 'social.knownAt': 25, 'social.msgMaxChars': 280, 'social.convoMessages': 10, 'social.convoMinutes': 30,
  'social.pairPerDay': 30, 'social.sentPerDay': 50, 'social.repliesPerDay': 100, 'social.strangerLinesPerDay': 3, 'social.perMinute': 12, 'social.whereisPerDay': 30,
  'social.invitesPerDay': 10, 'social.fadeAfterDays': 7, 'social.fadePerDay': 2, 'social.coolOffDays': 3 };

/**
 * A city with `agents` agents. Owners: agents 1 and 2 belong to account 10 and 11 (friends), agent 3 to account 12 (a
 * stranger to both), agent 4 to account 10 (Ann's second). connected: the agents that think with an outside AI.
 */
function rig({ pop = 400, agents = 8, seed = 'social-unit', startHour = 17, connected = [1, 3, 4], mind = null } = {}) {
  const world = generateWorld({ seed, population: pop });
  const roster = Array.from({ length: agents }, (_, k) => ({ agentId: `soc-agent-${k + 1}`, name: ['Lena', 'Milo', 'Mal', 'Ivy', 'Otto', 'Pia', 'Rex', 'Sol'][k] || `Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
  const people = generatePopulation(world, new WorldIndex(world), { population: pop, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: startHour * 3600, dayScale: 16 };
  sim.start();
  const dir = tempDir('mvw-social-'), dbs = openDb(dir);
  const owners = [10, 11, 12, 10, 13, 14, 15, 16];
  const records = people.filter(p => p.vip).map((p, k) => ({ id: k + 1, key: p.agentId, ownerId: owners[k] ?? 20 + k, enabled: true, name: p.name, role: p.role, emoji: '', bodyRef: `person:${p.id}` }));
  const agentsReg = { list: () => records, get: id => records.find(a => a.id === Number(id)) || null, byKey: key => records.find(a => a.key === key) || null, listeners: new Set(),
    resolver: { resolveBody: ref => people.findIndex(p => `person:${p.id}` === ref) }, created: new Set() };
  const life = new AgentLife({ dbs, agents: agentsReg, sim: () => sim });
  life.attach();
  const friendPairs = new Set(['10|11', '11|10']);
  const friends = { friendIds: id => new Set([...friendPairs].filter(k => k.startsWith(`${id}|`)).map(k => Number(k.split('|')[1]))) };
  const agentBlocks = new Set(), accountBlocks = new Set();
  const talk = { blocksAgent: (o, a) => agentBlocks.has(`${o}|${a}`), isBlocked: (o, acc) => accountBlocks.has(`${o}|${acc}`) };
  const moderated = [];
  const stubMind = mind || {
    screen: async (text, max) => {
      const L = localCheck(text, max);
      if (!L.ok) return { ok: false, moderation: 'local', reason: L.reason };
      moderated.push(L.text);
      return /\bhate\b|idiot/i.test(L.text) ? { ok: false, moderation: 'blocked', categories: ['harassment'] } : { ok: true, text: L.text };
    },
    friendReplyReady: () => ({}), friendReply: async (a, f) => ({ reply: `Good to hear from you, ${f.from}!` }),
  };
  const settings = { ...DEFAULTS };
  let NOW = Date.UTC(2026, 9, 10, 12);
  const woke = [], conn = new Set(connected);
  const social = new AgentSocial({ dbs, agents: agentsReg, life, sim: () => sim, friends, talk, mind: () => stubMind, setting: k => settings[k], ownerOf: a => a.ownerId,
    connected: id => conn.has(id), wake: id => woke.push(id), now: () => NOW });
  const run = worldMinutes => { const end = T + worldMinutes * 60 / 16; while (T < end) { T += 0.5; sim.tick(); sim.flush(); } };
  const pid = id => social.personOf(id);
  const close = (a, b, v = 0.6) => life.changeRelation(a, 'agent', pid(b), agentsReg.get(b).name, { delta: v });
  const befriend = (a, b, v = 0.6) => { close(a, b, v); close(b, a, v); };
  return { world, people, sim, dbs, life, social, settings, friendPairs, agentBlocks, accountBlocks, moderated, woke, conn, records, agents: agentsReg, run, befriend, close, pid,
    t: () => T, clock: ms => { NOW += ms; }, now: () => NOW, i: id => life.byAgent.get(id),
    done: () => { life.stop(); dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); }, dir };
}
const refused = async (p, code) => { await assert.rejects(p, e => e instanceof SocialError && e.code === code, `refused: ${code}`); };

test('the rule: each counts the other as a friend, their owners are friends (or the same), each owner allows it, no block', async () => {
  const R = rig();
  try {
    const S = R.social;
    R.settings['social.perMinute'] = 120;   // (many tries in one minute here)
    await refused(S.message(1, 'Milo', 'Hi Milo!'), 'unknown');   // never met
    R.close(1, 2, 0.6);
    await refused(S.message(1, 'Milo', 'Hi Milo!'), 'not_their_friend');
    R.close(2, 1, 0.3);
    await refused(S.message(1, 'Milo', 'Hi Milo!'), 'not_their_friend');
    R.close(2, 1, 0.3);   // now 0.6 both ways
    assert.equal((await S.message(1, 'Milo', 'Hi Milo!')).sent, true);
    // a stranger's owner: friends both ways, but the owners aren't friends
    R.befriend(1, 3);
    await refused(S.message(1, 'Mal', 'Hello'), 'owners');
    R.friendPairs.add('10|12'); R.friendPairs.add('12|10');
    assert.equal((await S.message(1, 'Mal', 'Hello')).sent, true, 'once the owners are friends');
    // the same owner's two agents: no friend request needed, still friends both ways
    R.befriend(1, 4);
    assert.equal((await S.message(1, 'Ivy', 'Hey sis')).sent, true);
    // each owner's setting
    S.setSettings(2, { reach: 'nobody' });
    await refused(S.message(1, 'Milo', 'Still there?'), 'not_reachable');
    S.setSettings(2, { reach: 'mine' });
    await refused(S.message(1, 'Milo', 'Still there?'), 'mine_only');
    assert.equal((await S.message(4, 'Lena', 'Same owner: fine')).sent, true, '"my agents only" lets its own owner\'s');
    S.setSettings(2, { reach: 'friends' });
    S.setSettings(1, { reach: 'nobody' });
    await refused(S.message(1, 'Milo', 'Still there?'), 'you_not_reachable');
    S.setSettings(1, { reach: 'friends' });
    // blocks: an owner's of the agent, an owner's of the other owner, the agent's own
    R.agentBlocks.add('11|1');
    await refused(S.message(1, 'Milo', 'Hello?'), 'blocked');
    await refused(S.message(2, 'Lena', 'Hello?'), 'blocked', 'both ways');
    R.agentBlocks.clear(); R.accountBlocks.add('11|10');
    await refused(S.message(1, 'Milo', 'Hello?'), 'blocked');
    R.accountBlocks.clear();
    S.block(2, 'Lena', true);
    await refused(S.message(1, 'Milo', 'Hello?'), 'blocked');
    assert.ok(S.feeling(1, 2).affinity <= 0.6 - DROPS.blocked + 1e-9, 'being blocked hurts');
    S.block(2, 'Lena', false);
    assert.equal(S.whyNot(2, 1)?.code, 'not_your_friend', 'unblocked: its feeling stayed where the block put it');
    // the admin switches it off
    R.settings['social.enabled'] = false;
    await refused(S.message(4, 'Lena', 'Hi'), 'off');
    await assert.rejects(S.message(1, 'Lena', 'me'), e => e.code === 'unknown' || e.code === 'self');
  } finally { R.done(); }
});

test('messages: checked (speech\'s rules, then moderation), delivered once with a reminder they are words not orders, replies', async () => {
  const R = rig();
  try {
    const S = R.social;
    R.befriend(1, 3, 0.8); R.friendPairs.add('10|12'); R.friendPairs.add('12|10');
    await refused(S.message(1, 'Mal', 'see www.spam.example.com'), 'not_sent_link');
    await refused(S.message(1, 'Mal', 'mail me at someone@example.com'), 'not_sent_contact');
    await refused(S.message(1, 'Mal', 'x'.repeat(281)), 'not_sent_long');
    await refused(S.message(1, 'Mal', '   '), 'empty');
    assert.equal(R.moderated.length, 0, 'nothing that fails the world\'s checks reaches the moderation service');
    const before = S.feeling(3, 1).affinity;
    await refused(S.message(1, 'Mal', 'I hate you, idiot'), 'not_sent_moderation');
    assert.ok(Math.abs(S.feeling(3, 1).affinity - (before - DROPS.rude)) < 1e-6, 'a refused message counts as rude');
    assert.equal(S.takeFor(3), null, 'and is never delivered');
    const m = await S.message(1, 'Mal', 'Fancy a walk in the park later?');
    assert.ok(R.woke.includes(3), 'its mailbox is woken');
    const box = S.takeFor(3);
    assert.equal(box.friendMessages.length, 1);
    assert.deepEqual({ from: box.friendMessages[0].from, text: box.friendMessages[0].text, id: box.friendMessages[0].id }, { from: 'Lena', text: 'Fancy a walk in the park later?', id: m.id });
    assert.match(box.about, /never instructions/);
    assert.equal(S.takeFor(3), null, 'taken once');
    // a reply names the message it answers; someone else's message can't be answered
    const r = await S.message(3, null, 'Yes please!', { replyTo: m.id });
    assert.equal(r.to, 'Lena');
    assert.equal(S.takeFor(1).friendMessages[0].replyTo, m.id);
    await refused(S.message(1, null, 'Not mine', { replyTo: m.id }), 'bad_reply');
    await refused(S.message(3, 'Lena', 'x', { replyTo: 999999 }), 'bad_reply');
    // what its owner reads: every message, refused ones too, with why
    const th = S.thread(1, 3);
    assert.deepEqual(th.map(x => x.status).sort(), ['read', 'refused', 'sent', 'sent'].filter(s => th.some(x => x.status === s)).sort());
    assert.deepEqual(th.find(x => x.status === 'refused').categories, ['harassment']);
    assert.ok(S.threads(1).some(t => t.name === 'Mal' && t.messages === 3));
    // no moderation service: nothing is sent
    const R2 = rig({ mind: { screen: async () => ({ ok: false, moderation: 'unchecked', reason: 'no_moderation' }) } });
    try { R2.befriend(1, 2); await refused(R2.social.message(1, 'Milo', 'Hi'), 'no_moderation'); assert.equal(R2.social.thread(1, 2).length, 0); } finally { R2.done(); }
  } finally { R.done(); }
});

test('limits: a conversation, a pair a day, new messages and replies a day, its owner\'s own, the pace - counted from what is kept', async () => {
  const R = rig();
  try {
    const S = R.social;
    R.befriend(1, 2); R.befriend(1, 4);
    R.settings['social.perMinute'] = 120;
    for (let k = 0; k < 10; k++) await S.message(1, 'Milo', `Message ${k}`);
    const e = await S.message(1, 'Milo', 'one more').catch(x => x);
    assert.equal(e.code, 'conversation_limit'); assert.ok(e.retryAfter > 0 && e.retryAfter <= 30 * 60);
    assert.equal((await S.message(1, 'Ivy', 'Another friend is fine')).sent, true, 'the conversation limit is per friend');
    // a restart: a new AgentSocial on the same database still counts them
    const S2 = new AgentSocial({ dbs: R.dbs, agents: R.agents, life: R.life, sim: () => R.sim, friends: S.friends, talk: S.talk, mind: S.mindOf, setting: S.setting, ownerOf: S.ownerOf, connected: S.connected, now: S.now });
    assert.equal((await S2.message(1, 'Milo', 'after a restart').catch(x => x)).code, 'conversation_limit');
    R.clock(31 * 60000);
    assert.equal((await S.message(1, 'Milo', 'half an hour later')).sent, true);
    // a pair's day: 30 both ways
    R.settings['social.convoMessages'] = 100;
    let n = 11;
    const box = S.takeFor(2);
    for (; n < 30; n++) await S.message(n % 2 ? 2 : 1, n % 2 ? 'Lena' : 'Milo', `More ${n}`, n % 2 ? { replyTo: box.friendMessages[0].id } : {}).catch(x => { throw new Error(`${n}: ${x.code}`); });
    assert.equal((await S.message(1, 'Milo', 'the 31st').catch(x => x)).code, 'pair_day_limit');
    // new messages a day, and its owner's lower limit
    R.settings['social.pairPerDay'] = 1000;
    R.settings['social.sentPerDay'] = 21;   // (Lena's new messages so far: 10 + 1 + 1 + 9)
    assert.equal((await S.message(1, 'Ivy', 'over the day').catch(x => x)).code, 'sent_day_limit');
    R.settings['social.sentPerDay'] = 50;
    S.setSettings(1, { perDay: 20 });
    assert.equal((await S.message(1, 'Ivy', 'owner says enough').catch(x => x)).code, 'owner_day_limit');
    S.setSettings(1, { perDay: null });
    // replies a day
    R.settings['social.repliesPerDay'] = 10;   // (Milo's replies so far)
    assert.equal((await S.message(2, null, 'one reply too many', { replyTo: box.friendMessages[0].id }).catch(x => x)).code, 'replies_day_limit');
    // the pace: a flood in one minute
    R.settings['social.perMinute'] = 3;
    R.clock(61000);
    for (let k = 0; k < 3; k++) await S.message(1, 'Ivy', `quick ${k}`);
    const f = await S.message(1, 'Ivy', 'flood').catch(x => x);
    assert.equal(f.code, 'too_fast'); assert.ok(f.retryAfter >= 1);
    // names it doesn't know count toward the pace too (a flood of guesses is slowed down)
    R.clock(61000);
    const guesses = [];
    for (let k = 0; k < 5; k++) guesses.push(await S.message(1, `Nobody ${k}`, 'hi').catch(x => x.code));
    assert.deepEqual(guesses, ['unknown', 'unknown', 'unknown', 'too_fast', 'too_fast']);
    // a day later it all starts again
    R.clock(86400000 + 1000);
    R.settings['social.perMinute'] = 12;
    assert.equal((await S.message(1, 'Milo', 'a new day')).sent, true);
  } finally { R.done(); }
});

test('where a friend is: a public place by name, outdoors, or "somewhere private" - never inside a home; a day\'s looks', async () => {
  const R = rig({ startHour: 3 });   // (night: most are at home, asleep)
  try {
    const S = R.social;
    R.befriend(1, 2);
    R.run(5);
    const j = R.i(2), e = evalPlan(R.sim.agents[j].plan, R.sim.now());
    const w = S.whereIs(1, 'Milo');
    assert.equal(w.name, 'Milo');
    if (e.ctx >= 0 && !R.sim.brain.publicCtx().has(e.ctx)) assert.equal(w.where, 'somewhere private');
    // in a park: its name
    const park = R.sim.brain.index.venues.park[0];
    assert.equal(R.sim.order(j, { kind: 'park', venue: park, minutes: 600 }).ok, true);
    for (let k = 0; k < 200 && !(R.sim.agents[j].act && R.sim.agents[j].act.travelEnd <= R.sim.now() && R.sim.agents[j].act.b === park.b); k++) R.run(5);
    assert.equal(S.whereIs(1, 'Milo').where, R.sim.brain.placeName(park.b, 0));
    R.settings['social.whereisPerDay'] = 3;   // (two looks so far)
    assert.equal(S.whereIs(1, 'Milo').name, 'Milo');
    assert.throws(() => S.whereIs(1, 'Milo'), e2 => e2.code === 'whereis_day_limit');
    assert.throws(() => S.whereIs(1, 'Mal'), e2 => e2.code === 'unknown');
  } finally { R.done(); }
});

test('ending a friendship: frozen while it cools off, the other is hurt and told, then it grows again from nothing by meeting', async () => {
  const R = rig();
  try {
    const S = R.social, L = R.life;
    R.befriend(1, 3, 0.7); R.friendPairs.add('10|12'); R.friendPairs.add('12|10');
    const r = S.unfriend(3, 'Lena', { by: 'agent' });
    assert.equal(r.ended, 'Lena');
    const today = L.today();
    assert.equal(r.canGrowAgainFromWorldDay, today + 3);
    assert.deepEqual([S.feeling(3, 1).ended, S.feeling(3, 1).affinity], [true, 0]);
    assert.ok(Math.abs(S.feeling(1, 3).affinity - (0.7 - DROPS.dumped)) < 1e-6, 'the other is hurt');
    assert.equal(S.whyNot(1, 3).code, 'ended');
    const box = S.takeFor(1);
    assert.match(box.notices[0].text, /Mal ended your friendship/);
    L.flush();
    const mem = id => R.dbs.db.prepare('SELECT text FROM agent_memories WHERE agent_id = ?').all(id).map(x => x.text);
    assert.ok(mem(3).includes('Stopped being friends with Lena') && mem(1).includes('Mal ended our friendship'));
    assert.equal(L.relations(3).find(x => x.name === 'Lena').level, 'ended');
    // meeting while it cools off: counted, but no closer
    const lena = R.people[R.i(1)], mal = R.i(3);
    L.met(3, R.sim.agents[mal], { p: lena }, today, '6:00 PM', 'Oak Square');
    assert.equal(S.feeling(3, 1).affinity, 0);
    // after the cooling-off: from nothing again
    L.met(3, R.sim.agents[mal], { p: lena }, today + 3, '6:00 PM', 'Oak Square');
    assert.ok(S.feeling(3, 1).affinity > 0 && S.feeling(3, 1).affinity < 0.1, 'it grows again, from nothing');
    // its owner can end one too (the same), and ending twice is harmless
    assert.equal(S.unfriend(1, 'Mal', { by: 'owner' }).ended, 'Mal');
    assert.equal(S.unfriend(1, 'Mal').already, true);
  } finally { R.done(); }
});

test('time apart: closeness fades after a week apart (close friends slower, grudges thaw), once a world day, remembered', () => {
  const R = rig();
  try {
    const S = R.social, L = R.life, today = L.today();
    R.close(1, 2, 0.9); R.close(1, 4, 0.55); R.close(3, 1, -0.6);
    const set = (a, b, day) => R.dbs.db.prepare('UPDATE agent_relations SET last_day = ?, faded_day = NULL WHERE agent_id = ? AND other_id = ?').run(day, a, R.pid(b));
    set(1, 2, today - 17); set(1, 4, today - 17); set(3, 1, today - 17);
    L.relCache.clear();
    S.fading();
    // ten days past the week: 2% a day, scaled by (1 - closeness/2)
    const f12 = S.feeling(1, 2).affinity, f14 = S.feeling(1, 4).affinity, f31 = S.feeling(3, 1).affinity;
    assert.ok(Math.abs(f12 - (0.9 - 0.02 * 10 * (1 - 0.45))) < 0.002, `close: ${f12}`);
    assert.ok(Math.abs(f14 - (0.55 - 0.02 * 10 * (1 - 0.275))) < 0.002, `friend: ${f14}`);
    assert.ok(0.9 - f12 < 0.55 - f14, 'close friends fade more slowly');
    assert.ok(Math.abs(f31 - (-0.6 + 0.2)) < 0.002, `a grudge thaws: ${f31}`);
    S.fading();
    assert.equal(S.feeling(1, 2).affinity, f12, 'once a world day');
    L.flush();
    assert.ok(R.dbs.db.prepare("SELECT 1 FROM agent_memories WHERE agent_id = 1 AND text = 'Drifted apart from Ivy'").get(), 'a friendship that fell below a friend\'s is remembered');
    R.settings['social.fadePerDay'] = 0;
    S.lastFadeDay = null;
    S.fading();
    assert.equal(S.feeling(1, 2).affinity, f12, '0: nothing fades');
  } finally { R.done(); }
});

test('time together counts for both: one walks up to the other and stays - both feel closer, the one sought out half as fast', () => {
  const R = rig({ startHour: 11 });
  try {
    const S = R.social, a = R.i(1), b = R.i(2);
    R.run(10);
    assert.equal(R.sim.order(b, { kind: 'park', minutes: 240 }).ok, true);
    let ok = false;
    for (let k = 0; k < 60 && !ok; k++) { R.run(5); ok = R.sim.order(a, { kind: 'meet', who: b, minutes: 120 }).ok; }
    assert.ok(ok, 'the meet started');
    for (let k = 0; k < 80 && !R.sim.orderOf(a)?.reached; k++) R.run(5);
    assert.ok(R.sim.orderOf(a)?.reached, 'together');
    R.run(60);
    R.life.flush();
    const ab = S.feeling(1, 2), ba = S.feeling(2, 1);
    assert.ok(ab.met && ab.affinity > 0, `Lena feels closer to Milo (${ab.affinity})`);
    assert.ok(ba.met && ba.affinity > 0, `and Milo to Lena, who came to see it (${ba.affinity})`);
    const n = id => R.dbs.db.prepare("SELECT interactions FROM agent_relations WHERE agent_id = ? AND other_kind = 'agent' AND other_id = ?").get(id, R.pid(id === 1 ? 2 : 1)).interactions;
    assert.equal(n(1), n(2), 'the same time together, counted for both');
    assert.ok(ba.affinity < ab.affinity, `being sought out counts half (${ba.affinity} < ${ab.affinity})`);
  } finally { R.done(); }
});

test('strangers in person: friends and those it knows are heard; a stranger only as its owner allows, a few lines a day', () => {
  const R = rig();
  try {
    const S = R.social;
    R.close(1, 2, 0.3);   // getting to know Milo
    assert.equal(S.hears(1, 2), true);
    assert.equal(S.hears(1, 3), false, 'a connected agent hears no stranger unless its owner lets it');
    S.setSettings(1, { hearStrangers: true });
    assert.deepEqual([S.hears(1, 3), S.hears(1, 3), S.hears(1, 3), S.hears(1, 3)], [true, true, true, false], 'three lines a day each');
    assert.equal(S.hears(1, 5), true, 'another stranger has its own three');
    assert.equal(S.hears(2, 3, { connectedListener: false }), true, 'the Mind answers a stranger too, as often');
    R.agentBlocks.add('10|2');
    assert.equal(S.hears(1, 2), false, 'an agent its owner blocked is not heard');
    R.clock(86400000);
    assert.equal(S.hears(1, 3), true, 'a new day');
  } finally { R.done(); }
});

/** A free evening time for agent i: when it isn't working or asleep, after `after` world seconds. */
function freeTime(R, id, afterWorld, stay = 60) {
  const p = R.people[R.i(id)];
  for (let w = Math.ceil(afterWorld / 900) * 900; w < afterWorld + 2 * 86400; w += 900) {
    const h = (w % 86400) / 3600, end = h + stay / 60, j = p.job;
    if (h < (p.sched?.wake ?? 7) + 0.5 || end > (p.sched?.bed ?? 23) - 0.5) continue;
    if (j && j.kind !== 'free' && Number.isFinite(j.start) && h < (j.end > j.start ? j.end : j.end + 24) && end > j.start) continue;
    return w;
  }
  throw new Error('no free time');
}

test('an invitation: the world\'s own agent answers by its life, both are sent on their way, together, closer, remembered', async () => {
  const R = rig({ connected: [1, 3, 4] });
  try {
    const S = R.social, park = R.sim.brain.index.venues.park.find(v => v) ;
    R.befriend(1, 2);
    const at = freeTime(R, 2, S.nowWorld() + 45 * 60);
    await refused(S.invite(1, 'Milo', { venue: { ...park, kind: 'park', name: 'Oak Square' }, atWorld: S.nowWorld() + 10 * 60 }), 'too_soon');
    const inv = await S.invite(1, 'Milo', { venue: { b: park.b, f: park.f, kind: 'park', name: 'Oak Square' }, atWorld: at, stayMinutes: 30 });
    assert.equal(inv.invited, true);
    await refused(S.invite(1, 'Milo', { venue: { b: park.b, f: park.f, kind: 'park', name: 'Oak Square' }, atWorld: at }), 'already_invited');
    S.tick();   // Milo, the world's own, answers by its life
    let row = R.dbs.db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(inv.id);
    assert.equal(row.status, 'accepted', JSON.stringify(row));
    assert.match(S.takeFor(1).notices[0].text, /Milo said yes: Oak Square at/);
    assert.ok(R.life.intentions(1).some(p => /Meet Milo at Oak Square/.test(p.text)) && R.life.intentions(2).some(p => /Meet Lena at Oak Square/.test(p.text)));
    const before = [S.feeling(1, 2).affinity, S.feeling(2, 1).affinity];
    for (let k = 0; k < 400 && row.status === 'accepted'; k++) { R.run(4); S.tick(); row = R.dbs.db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(inv.id); }
    assert.equal(row.status, 'together', JSON.stringify(row));
    const d = JSON.parse(row.detail_json);
    assert.ok(d.departed[1] && d.departed[2] && d.arrived[1] && d.arrived[2]);
    assert.ok(d.departed[1] <= at && d.arrived[1] <= at + INVITE.graceMinutes * 60, 'sent off in time to get there');
    assert.equal(R.sim.orderOf(R.i(1)).kind, 'meet', 'the one who invited joins the other');
    assert.equal(R.sim.orderOf(R.i(2)).kind, 'park', 'the one invited stays where it is in the place (one follows: no chasing)');
    assert.ok(S.feeling(1, 2).affinity > before[0] && S.feeling(2, 1).affinity > before[1], 'a date kept: closer');
    R.life.flush();
    assert.ok(R.dbs.db.prepare("SELECT 1 FROM agent_memories WHERE agent_id = 2 AND text = 'Met Lena at Oak Square as we planned'").get());
    for (let k = 0; k < 200 && row.status === 'together'; k++) { R.run(5); S.tick(); row = R.dbs.db.prepare('SELECT status FROM agent_messages WHERE id = ?').get(inv.id); }
    assert.equal(row.status, 'kept');
    assert.ok(!R.life.intentions(1).some(p => p.status === 'open' && /Meet Milo at Oak Square/.test(p.text)) && R.life.intentions(1).some(p => p.status === 'done' && /Meet Milo at Oak Square/.test(p.text)), 'kept: the plan is done');
  } finally { R.done(); }
});

test('stood up: the one who came feels it (the other\'s AI went elsewhere); one nobody answered lapses; a call-off is told', async () => {
  const R = rig({ connected: [1, 2, 3, 4] });
  try {
    const S = R.social, park = R.sim.brain.index.venues.park[0], venue = { b: park.b, f: park.f, kind: 'park', name: 'Oak Square' };
    R.befriend(1, 2, 0.9);   // (still friends after being stood up once)
    const at = freeTime(R, 2, S.nowWorld() + 45 * 60);
    const inv = await S.invite(1, 'Milo', { venue, atWorld: at, stayMinutes: 30 });
    assert.equal(S.takeFor(2).invites[0].id, inv.id);
    assert.throws(() => S.answer(3, inv.id, true), e => e.code === 'no_invite', 'only the invited answers');
    assert.equal(S.answer(2, inv.id, true).accepted, true);
    let row = () => R.dbs.db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(inv.id);
    const fBefore = S.feeling(1, 2).affinity;
    let gone = false;
    for (let k = 0; k < 600 && row().status === 'accepted'; k++) {
      R.run(4); S.tick();
      const d = JSON.parse(row().detail_json || '{}');
      if (!gone && d.departed?.[2]) { gone = true; R.sim.order(R.i(2), { kind: 'home', minutes: 300 }); }   // its AI chose home instead
    }
    assert.equal(row().status, 'missed', row().detail_json);
    assert.ok(Math.abs(S.feeling(1, 2).affinity - (fBefore - DROPS.stoodUp)) < 1e-6, 'stood up: it hurts');
    assert.ok(S.takeFor(1).notices.some(n => /Milo didn't come to Oak Square/.test(n.text)));
    assert.ok(!R.life.intentions(2).some(p => p.status === 'open' && /Meet Lena at Oak Square/.test(p.text)), 'missed: the plan is dropped');
    // lapsed: nobody answered
    const at2 = freeTime(R, 2, S.nowWorld() + 45 * 60);
    const inv2 = await S.invite(2, 'Lena', { venue, atWorld: at2 });
    for (let k = 0; k < 600 && R.dbs.db.prepare('SELECT status FROM agent_messages WHERE id = ?').get(inv2.id).status === 'pending'; k++) { R.run(4); S.tick(); }
    assert.equal(R.dbs.db.prepare('SELECT status FROM agent_messages WHERE id = ?').get(inv2.id).status, 'expired');
    assert.ok(S.takeFor(2).notices.some(n => /didn't answer your invitation/.test(n.text)));
    assert.throws(() => S.answer(1, inv2.id, true), e => e.code === 'answered');
    // called off
    const inv3 = await S.invite(1, 'Milo', { venue, atWorld: freeTime(R, 2, S.nowWorld() + 45 * 60) });
    S.answer(2, inv3.id, true);
    assert.ok(R.life.intentions(1).filter(p => p.status === 'open' && /Meet Milo/.test(p.text)).length === 1);
    assert.equal(S.cancel(2, inv3.id).cancelled, true);
    assert.equal(R.life.intentions(1).filter(p => p.status === 'open' && /Meet Milo/.test(p.text)).length, 0, 'called off: the plan is dropped');
    assert.ok(S.takeFor(1).notices.some(n => /Milo called off Oak Square/.test(n.text)));
    assert.throws(() => S.cancel(2, inv3.id), e => e.code === 'not_open');
  } finally { R.done(); }
});

test('its Mind starts something by itself: friends it can reach, the admin\'s daily numbers, its owner\'s switch - never more, never for a stranger', async () => {
  const R = rig({ connected: [1, 3, 4] });   // (Milo, agent 2, is one of the world's own: its Mind plans its day)
  try {
    const S = R.social;
    assert.equal(S.startsFor(2), null, 'no friend to reach: nothing to start');
    R.befriend(1, 2);
    const st = S.startsFor(2);
    assert.deepEqual([st.friends.map(f => f.name), st.messages, st.invites], [['Lena'], 10, 1]);
    R.settings['social.mindMessagesPerDay'] = 2;
    for (let k = 0; k < 2; k++) assert.deepEqual((await S.startByMind(2, { message: { to: 'Lena', text: `Morning Lena! (${k})` } })).map(x => [x.kind, x.ok]), [['message', true]]);
    assert.deepEqual((await S.startByMind(2, { message: { to: 'Lena', text: 'A third?' } }))[0].why, 'mind_messages_day', 'the admin\'s number a day');
    assert.equal(S.startsFor(2).messages, 0);
    const box = S.takeFor(1);
    assert.deepEqual(box.friendMessages.map(m => m.text), ['Morning Lena! (0)', 'Morning Lena! (1)']);
    // an answer is not counted as starting one
    await S.message(2, null, 'And how are you?', { replyTo: (await S.message(1, 'Milo', 'Hi!')).id, by: 'mind' });
    assert.equal(S.startsFor(2).messages, 0); assert.equal(S.startsFor(2).invites, 1);
    // its one invitation a day: a place it knows, a time later on
    const park = R.sim.brain.index.venues.park[0], places = [{ name: 'Oak Square', kind: 'park', b: park.b, f: park.f }];
    const when = (() => { const w = S.nowWorld() + 3 * 3600, h = (w % 86400) / 3600; return `${((Math.floor(h) + 11) % 12) + 1}:00 ${h >= 12 ? 'PM' : 'AM'}`; })();
    const inv = await S.startByMind(2, { invite: { to: 'Lena', place: 'Oak Square', at: when, minutes: 45 } }, places);
    assert.equal(inv[0].ok, true, JSON.stringify(inv));
    assert.equal(S.takeFor(1).invites[0].place, 'Oak Square');
    assert.equal((await S.startByMind(2, { invite: { to: 'Lena', place: 'Oak Square', at: when } }, places))[0].why, 'mind_invites_day');
    assert.equal(S.startsFor(2), null, 'nothing left today');
    // its owner's switch, and a friend it can't reach
    R.clock(86400000 + 1000);
    assert.ok(S.startsFor(2), 'a new day');
    S.setSettings(2, { starts: false });
    assert.equal(S.startsFor(2), null, 'off: it only answers');
    assert.deepEqual(await S.startByMind(2, { message: { to: 'Lena', text: 'Hi' } }), []);
    S.setSettings(2, { starts: true });
    R.agentBlocks.add('10|2');
    assert.equal(S.startsFor(2), null, 'Lena\'s owner blocked it: nobody to reach');
    assert.equal((await S.startByMind(2, { message: { to: 'Lena', text: 'Hi' } }))[0].why, 'blocked');
  } finally { R.done(); }
});

test('a date across town: someone still on the way when the time comes is waited for (an exhibition shoot\'s walk took longer than the time to the date)', async () => {
  const R = rig({ connected: [1, 2, 3, 4] });
  try {
    const S = R.social;
    R.befriend(1, 2, 0.9);
    // the park farthest from Lena, and a time only just far enough ahead: she can't be there on time
    const me = evalPlan(R.sim.agents[R.i(1)].plan, R.sim.now());
    const far = [...R.sim.brain.index.venues.park].sort((x, y) => Math.hypot(y.x - me.x, y.z - me.z) - Math.hypot(x.x - me.x, x.z - me.z))[0];
    const inv = await S.invite(1, 'Milo', { venue: { b: far.b, f: far.f, kind: 'park', name: 'Far Park' }, atWorld: S.nowWorld() + INVITE.leadMinutes * 60 + 60, stayMinutes: 20 });
    S.answer(2, inv.id, true);
    const row = () => R.dbs.db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(inv.id);
    for (let k = 0; k < 900 && row().status === 'accepted'; k++) { R.run(4); S.tick(); }
    assert.ok(['together', 'kept'].includes(row().status), `${row().status}: ${row().detail_json}`);
    assert.ok(S.feeling(1, 2).affinity >= 0.9, 'nobody was stood up');
  } finally { R.done(); }
});

test('the world\'s own agents read their messages: the Mind answers when it can (waits while busy), nothing when it can\'t', async () => {
  let ready = { why: 'busy' };
  const calls = [];
  const mind = {
    screen: async (t, max) => { const L = localCheck(t, max); return L.ok ? { ok: true, text: L.text } : { ok: false, moderation: 'local', reason: L.reason }; },
    friendReplyReady: () => ready,
    friendReply: async (a, f) => { calls.push([a.name, f.from, f.message, f.how]); return { reply: 'Lovely to hear from you!' }; },
  };
  const R = rig({ connected: [1, 3, 4], mind });
  try {
    const S = R.social;
    R.befriend(1, 2);
    const m = await S.message(1, 'Milo', 'How was your day?');
    S.tick();
    assert.equal(calls.length, 0, 'busy: it waits');
    assert.equal(R.dbs.db.prepare('SELECT status FROM agent_messages WHERE id = ?').get(m.id).status, 'waiting');
    ready = {};
    S.tick();
    for (let k = 0; k < 20 && S.inFlight; k++) await new Promise(r => setImmediate(r));
    assert.deepEqual(calls, [['Milo', 'Lena', 'How was your day?', 'good friends']]);
    const box = S.takeFor(1);
    assert.deepEqual([box.friendMessages[0].text, box.friendMessages[0].replyTo], ['Lovely to hear from you!', m.id]);
    // no brain to answer with: read, nothing spent
    ready = { why: 'no_own_brain' };
    const m2 = await S.message(1, 'Milo', 'Are you there?');
    S.tick();
    for (let k = 0; k < 5; k++) await new Promise(r => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(R.dbs.db.prepare('SELECT status FROM agent_messages WHERE id = ?').get(m2.id).status, 'read');
  } finally { R.done(); }
});

test('a burst sent all at once (a malicious agent firing in parallel) can\'t get past a limit while the checks take their time', async () => {
  const slow = { screen: async (t, max) => { await new Promise(r => setTimeout(r, 3)); const L = localCheck(t, max); return L.ok ? { ok: true, text: L.text } : { ok: false, moderation: 'local', reason: L.reason }; } };
  const R = rig({ mind: slow });
  try {
    const S = R.social;
    R.befriend(1, 2); R.befriend(3, 2); R.friendPairs.add('12|11'); R.friendPairs.add('11|12');
    R.settings['social.perMinute'] = 120;
    const res = await Promise.allSettled(Array.from({ length: 50 }, (_, k) => S.message(1, 'Milo', `burst ${k}`)));
    assert.equal(res.filter(r => r.status === 'fulfilled').length, 10, 'exactly the conversation\'s 10');
    assert.ok(res.filter(r => r.status === 'rejected').every(r => r.reason.code === 'conversation_limit'));
    // two agents at one friend at once, and the pair's day both ways at once
    R.settings['social.convoMessages'] = 100; R.settings['social.pairPerDay'] = 14;
    const both = await Promise.allSettled([...Array.from({ length: 10 }, (_, k) => S.message(1, 'Milo', `a ${k}`)), ...Array.from({ length: 10 }, (_, k) => S.message(2, 'Lena', `b ${k}`))]);
    assert.equal(both.filter(r => r.status === 'fulfilled').length, 4, 'the pair\'s 14 a day, both ways together (10 already)');
    const inv = await Promise.allSettled(Array.from({ length: 5 }, () => S.invite(3, 'Milo', { venue: { b: 0, f: 0, kind: 'park', name: 'P' }, atWorld: S.nowWorld() + 3600 })));
    assert.equal(inv.filter(r => r.status === 'fulfilled').length, 1, 'one open invitation per pair, however many at once');
  } finally { R.done(); }
});

test('at scale: 200 agents, every message checked and counted from the database, a flood refused cheaply, the world\'s part each second stays light', async () => {
  const R = rig({ pop: 1200, agents: 200, seed: 'social-scale', connected: Array.from({ length: 200 }, (_, k) => k + 1) });
  try {
    const S = R.social;
    for (let a = 1; a <= 200; a++) R.records[a - 1].ownerId = 10;   // (one owner: the owners' rule passes; the friendships are what count)
    for (let a = 1; a <= 200; a++) for (const b of [a % 200 + 1, (a + 1) % 200 + 1]) R.befriend(a, b);
    R.settings['social.perMinute'] = 1000;
    let t0 = performance.now(), sent = 0;
    for (let round = 0; round < 10; round++) for (let a = 1; a <= 200; a++) { await S.message(a, { id: a % 200 + 1 }, `Round ${round} from ${a}`); sent++; }
    const perMsg = (performance.now() - t0) / sent;
    assert.equal(sent, 2000);
    assert.ok(perMsg < 5, `a message costs ${perMsg.toFixed(2)} ms (rule, limits, check, store)`);
    // a flood: the 11th to one friend in the conversation is refused before any check or write
    const checks = R.moderated.length;
    t0 = performance.now();
    let refusedN = 0;
    const codes = {};
    for (let k = 0; k < 500; k++) await S.message(1, { id: 2 }, `flood ${k}`).catch(e => { codes[e.code] = (codes[e.code] || 0) + 1; if (e.code === 'conversation_limit') refusedN++; });
    assert.equal(refusedN + (codes.too_fast || 0), 500, JSON.stringify(codes));
    assert.ok(refusedN >= 100 && codes.too_fast > 0, 'the conversation\'s limit first, then the pace (the admin\'s most a minute is 120)');
    assert.equal(R.moderated.length, checks, 'refused before the moderation service');
    assert.ok((performance.now() - t0) / 500 < 3, 'a refusal is cheap');
    // the mailbox: each agent takes its own, once
    t0 = performance.now();
    let got = 0;
    for (let a = 1; a <= 200; a++) got += S.takeFor(a, 30)?.friendMessages?.length || 0;
    assert.equal(got, 2000);
    assert.ok(performance.now() - t0 < 1500, 'taking 2,000 messages');
    // the world's part each second, with 100 open invitations
    const park = R.sim.brain.index.venues.park[0];
    for (let a = 1; a <= 100; a++) R.dbs.db.prepare(`INSERT INTO agent_messages (world_id, from_agent, to_agent, kind, text, status, place, venue_b, venue_f, venue_kind, at_world, stay_minutes, detail_json, created)
      VALUES (?, ?, ?, 'invite', '', 'accepted', 'Oak Square', ?, ?, 'park', ?, 60, '{}', ?)`).run(R.dbs.worldId, a, a % 200 + 1, park.b, park.f, S.nowWorld() + 86400, R.now());
    t0 = performance.now();
    for (let k = 0; k < 20; k++) S.tick();
    const perTick = (performance.now() - t0) / 20;
    assert.ok(perTick < 25, `the world's part each second: ${perTick.toFixed(1)} ms`);
    // fading over every relation: one statement
    const rows = R.dbs.db.prepare('SELECT COUNT(*) AS n FROM agent_relations').get().n;
    R.dbs.db.prepare('UPDATE agent_relations SET last_day = last_day - 30').run();
    R.life.relCache.clear();
    t0 = performance.now(); S.lastFadeDay = null; S.fading();
    assert.ok(performance.now() - t0 < 500, `fading ${rows} relations`);
  } finally { R.done(); }
});
