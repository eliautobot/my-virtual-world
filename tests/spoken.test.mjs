// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents' conversations in person (server/senses/spoken.js, the Studio's Conversations tab): a line kept once and for every
// AI agent it concerns (said or heard), grouped into conversations by place and pause, newest first, paged, tidied after
// its days, cleared by its owner; the senses' 'say' and proximity chat feed it (who is within earshot; a line said to
// nobody is not kept); over HTTP only for its owner and its managers.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openDb } from '../server/db.js';
import { SpokenLog, SPOKEN } from '../server/senses/spoken.js';
import { Senses } from '../server/senses/senses.js';
import { Plan } from '../server/sim/plan.js';
import { tempDir, startServer, ownerSession, userSession } from './helpers/server.mjs';

const MIN = 60000;
function store() {
  const dbs = openDb(tempDir('mvw-spoken-')), now = { t: 1_800_000_000_000 };
  return { dbs, now, log: new SpokenLog({ dbs, now: () => now.t }) };
}

test('a line is kept once, for every agent it concerns; conversations by place and pause, newest first, read oldest first', () => {
  const { dbs, now, log } = store();
  try {
    const milo = { kind: 'agent', id: 1, agent: 1, name: 'Milo' }, juno = { kind: 'agent', id: 2, agent: 2, name: 'Juno' };
    log.record({ speaker: milo, text: 'Morning, Juno!', place: 'in «Café 21»', ears: [1, 2], near: [{ kind: 'agent', id: 2, name: 'Juno' }, { kind: 'resident', id: 40, name: 'Mia' }] });
    now.t += MIN;
    log.record({ speaker: juno, text: 'Hey Milo, coffee?', place: 'in «Café 21»', ears: [2, 1], near: [{ kind: 'agent', id: 1, name: 'Milo' }] });
    now.t += SPOKEN.gapMs + MIN;   // (a long pause: a new conversation)
    log.record({ speaker: milo, text: 'See you at the station.', place: 'in «Café 21»', ears: [1], near: [{ kind: 'player', id: 7, name: 'Kim' }] });
    now.t += MIN;
    log.record({ speaker: { kind: 'player', id: 7, name: 'Kim' }, text: 'Bye Milo', place: 'outside at «1st Ave & Main»', ears: [1], near: [] });
    assert.equal(dbs.db.prepare('SELECT COUNT(*) AS n FROM spoken_lines').get().n, 4, 'each line once');
    const r = log.conversations(1);
    assert.equal(r.total, 4);
    assert.deepEqual(r.conversations.map(c => c.place), ['outside at «1st Ave & Main»', 'in «Café 21»', 'in «Café 21»'], 'another place or a pause: another conversation, newest first');
    const first = r.conversations[2];
    assert.deepEqual(first.lines.map(l => [l.speaker.name, l.said]), [['Milo', true], ['Juno', false]], 'a conversation reads oldest first; its own lines marked');
    assert.deepEqual(first.with.map(w => w.name).sort(), ['Juno', 'Mia'], 'who it was with: those who spoke and those near, never itself');
    assert.equal(first.said, 1); assert.equal(first.heard, 1);
    assert.deepEqual(log.conversations(2).conversations.map(c => c.lines.length), [2], 'Juno has only what concerned it');
    assert.equal(log.conversations(3).conversations.length, 0);
    assert.equal(log.record({ speaker: milo, text: '   ', ears: [1] }), null, 'nothing said: nothing kept');
    assert.equal(log.record({ speaker: milo, text: 'Hi', ears: [] }), null, 'no agent concerned: nothing kept');
  } finally { dbs.close?.(); }
});

test('paged by line, a conversation never split across pages; tidied after its days; cleared for one agent only', () => {
  const { dbs, now, log } = store();
  try {
    const a = { kind: 'agent', id: 1, agent: 1, name: 'Milo' };
    for (let k = 0; k < 30; k++) { log.record({ speaker: a, text: `line ${k}`, place: `place ${Math.floor(k / 3)}`, ears: [1, 2], near: [{ kind: 'agent', id: 2, name: 'Juno' }] }); now.t += 1000; }
    const p1 = log.conversations(1, { limit: 20 });
    assert.ok(p1.next, 'more to read');
    assert.ok(p1.conversations.every(c => c.lines.length === 3), 'whole conversations only');
    const p2 = log.conversations(1, { before: p1.next, limit: 20 });
    const seen = [...p1.conversations, ...p2.conversations].flatMap(c => c.lines.map(l => l.text));
    assert.equal(seen.length, 30); assert.equal(new Set(seen).size, 30, 'every line once over the pages');
    assert.equal(p2.next, null);
    assert.equal(log.forget(1), 30);
    assert.equal(log.conversations(1).total, 0, 'its history cleared');
    assert.equal(log.conversations(2).total, 30, 'the other agent keeps what it heard');
    now.t += (SPOKEN.keepDays + 1) * 86400000;
    log.record({ speaker: a, text: 'new', ears: [2] });
    assert.equal(log.tidy(), 30, 'older than its days: gone');
    assert.deepEqual(log.conversations(2).conversations.flatMap(c => c.lines.map(l => l.text)), ['new']);
  } finally { dbs.close?.(); }
});

test('a long conversation in one place (a whole shift side by side) goes on in parts, the pages never repeating a line', () => {
  const { dbs, now, log } = store();
  try {
    const a = { kind: 'agent', id: 1, agent: 1, name: 'Milo' };
    for (let k = 0; k < 1000; k++) { log.record({ speaker: a, text: `line ${k}`, place: 'in «Studio A»', ears: [1, 2], near: [{ kind: 'agent', id: 2, name: 'Juno' }] }); now.t += 20000; }
    const seen = []; let next = null, pages = 0, parts = 0;
    do { const r = log.conversations(1, { before: next }); for (const c of r.conversations) { parts++; assert.ok(c.lines.length <= SPOKEN.maxLines); seen.push(...c.lines.map(l => l.text)); } next = r.next; pages++; } while (next && pages < 50);
    assert.equal(seen.length, 1000); assert.equal(new Set(seen).size, 1000, 'every line once');
    assert.ok(parts >= Math.ceil(1000 / SPOKEN.maxLines), `${parts} parts`);
  } finally { dbs.close?.(); }
});

test('the senses feed it: who is within earshot, a line said to nobody is not kept, proximity chat near an agent', () => {
  const dbs = openDb(tempDir('mvw-spoken-senses-'));
  try {
    const at = (x, z) => ({ plan: new Plan(0, { x, y: 0, z, ctx: -1 }) });
    const sim = {
      now: () => 10, world: { buildings: [], levels: [] }, events: new Set(), clock: { rate: 1 }, hour: () => 9,
      people: [{ name: 'Milo', vip: true }, { name: 'Juno', vip: true }, { name: 'Mia' }, { name: 'Far Away' }, { name: 'Lone', vip: true }],
      agents: [at(0, 0), at(3, 0), at(0, 4), at(200, 0), at(500, 500)],
    };
    const recs = new Map([[1, { id: 1, name: 'Milo' }], [2, { id: 2, name: 'Juno' }], [3, { id: 3, name: 'Lone' }]]);
    const players = { byId: new Map([[7, { id: 7, name: 'Kim', x: 2, z: 2, ctx: -1 }]]) };
    const S = new Senses({ dbs, sim: () => sim, agents: { get: id => recs.get(Number(id)) }, life: () => ({ byAgent: new Map([[1, 0], [2, 1], [3, 4]]) }), players });
    S.spoken = new SpokenLog({ dbs });
    S.heard({ t: 'say', i: 0, text: 'Morning, Juno!' });
    const milo = S.spoken.conversations(1).conversations;
    assert.equal(milo.length, 1);
    assert.deepEqual(milo[0].lines.map(l => [l.speaker.name, l.said, l.text]), [['Milo', true, 'Morning, Juno!']]);
    assert.deepEqual(milo[0].with.map(w => `${w.kind}:${w.name}`).sort(), ['agent:Juno', 'player:Kim', 'resident:Mia'], 'within earshot only (Far Away is 200 m off)');
    assert.equal(S.spoken.conversations(2).conversations[0].lines[0].said, false, 'Juno heard it');
    S.heard({ t: 'say', i: 4, text: 'Nobody here.' });
    assert.equal(S.spoken.conversations(3).total, 0, 'said to nobody: not a conversation');
    S.heard({ t: 'say', i: 2, text: 'Lovely day.' });   // a resident near two agents
    assert.equal(S.spoken.conversations(1).total, 2); assert.equal(S.spoken.conversations(2).total, 2);
    S.heardPlayer(players.byId.get(7), 'Hi both!');
    const last = S.spoken.conversations(2).conversations[0].lines.at(-1);
    assert.deepEqual([last.speaker.kind, last.speaker.name, last.text], ['player', 'Kim', 'Hi both!']);
    assert.equal(dbs.db.prepare('SELECT COUNT(*) AS n FROM spoken_lines').get().n, 3, 'each line kept once');
  } finally { dbs.close?.(); }
});

let s, owner, ann, A;
before(async () => {
  s = await startServer({ population: 60, agents: 1 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  A = (await owner.get('/api/agents')).json.agents[0];
});
after(async () => { await s?.stop(); });

test('over HTTP: its owner reads and clears its conversations; anyone else gets 404', async () => {
  const r = await owner.get(`/api/agent-spoken?agent=${A.id}`);
  assert.equal(r.status, 200, r.text);
  assert.ok(Array.isArray(r.json.conversations));
  assert.equal(r.json.keepDays, SPOKEN.keepDays);
  assert.equal((await ann.get(`/api/agent-spoken?agent=${A.id}`)).status, 404);
  assert.equal((await ann.post('/api/agent-spoken/clear', { agent: A.id })).status, 404);
  assert.equal((await owner.get('/api/agent-spoken?agent=99999')).status, 404);
  const c = await owner.post('/api/agent-spoken/clear', { agent: A.id });
  assert.equal(c.status, 200, c.text);
  assert.equal(typeof c.json.cleared, 'number');
});
