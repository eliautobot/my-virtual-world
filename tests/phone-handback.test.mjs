// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The person's take-over of an agent's phone goes back by itself (server/phone/phone.js handBackIdle): after the
// phone's hand-back time without the person's texts - counted from their last text - the conversation (or the whole
// phone) is the agent's again, its owner is told, and the agent is caught up; 0 keeps it until handed back by hand.
// The phone runs here on its own database with a clock the test moves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { openDb } from '../server/db.js';
import { Phone } from '../server/phone/phone.js';
import { tempDir } from './helpers/server.mjs';

const CUSTOMER = '+15552010042';
function setup() {
  const dir = tempDir('mvw-phone-');
  const dbs = openDb(dir);
  let T = Date.UTC(2026, 9, 16, 15, 0, 0);
  const notes = [], runs = [];
  const agent = { id: 52, name: 'Max', emoji: '🔧', enabled: true, ownerId: 1 };
  const phone = new Phone({
    dbs, timers: false, now: () => T,
    agents: { get: id => (id === 52 ? agent : null), isOwner: () => true, canManage: () => true, shares: () => [], listeners: new Set() },
    connections: { get: () => ({ id: 1, kind: 'twilio', enabled: true, config: {} }), canUse: () => true, visible: () => [], secretsFor: () => ({}) },
    host: { call: async () => { throw new Error('no Twilio here'); } },
    chat: { sessions: { create: () => ({ id: 7 }), get: () => ({ id: 7, agentId: 52 }), list: () => [] }, startRun: async (P, o) => { runs.push(o.input); return { runId: `r${runs.length}` }; } },
    notifications: { create: (id, n) => notes.push(n) },
    send: () => {}, principalFor: () => ({ account: { id: 1, login: 'sam', role: 'owner' }, role: 'owner' }), setting: () => 10,
  });
  dbs.db.prepare("INSERT INTO accounts (id, world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated) VALUES (1, ?, 'sam', 'Sam', 'sam', 'owner', 'x', ?, ?, ?)").run(dbs.worldId, T, T, T);
  dbs.db.prepare("INSERT INTO phone_lines (world_id, agent_id, connection_id, number, number_sid, session_id, sync_json, created, updated) VALUES (?, 52, 1, '+18885550100', 'PNx', 7, '{\"imported\":true}', ?, ?)").run(dbs.worldId, T, T);
  const P = { account: { id: 1, login: 'sam', role: 'owner' }, role: 'owner' };
  const text = (dir, body) => dbs.db.prepare(`INSERT INTO phone_messages (world_id, line_id, sid, direction, peer, body, state, origin, author_id, at, created)
    VALUES (?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`).run(dbs.worldId, dir, CUSTOMER, body, dir === 'in' ? 'received' : 'sent', dir === 'in' ? 'twilio' : 'phone', dir === 'in' ? null : 1, T, T);
  return { dbs, dir, phone, P, notes, runs, tick: ms => { T += ms; }, now: () => T, text, done: () => { dbs.db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const settle = () => new Promise(r => setTimeout(r, 200));

test('a conversation goes back to the agent 2 h after the owner\'s last text, and the agent is caught up', async () => {
  const x = setup();
  try {
    await x.phone.takeover(x.P, 52, { peer: CUSTOMER });
    x.tick(90 * 60000);
    x.text('in', 'Is Saturday still on?');
    x.phone.q.touchTakeover.run(x.now(), x.dbs.worldId, 1, CUSTOMER);   // (the owner answered: as deliverText does)
    x.text('out', 'Yes, Saturday at 10.');
    x.tick(60 * 60000);
    x.phone.handBackIdle();
    assert.equal(x.phone.q.takeovers.all(x.dbs.worldId, 1).length, 1, '1 h after the owner\'s last text: still theirs');
    x.tick(61 * 60000);
    x.phone.handBackIdle();
    assert.equal(x.phone.q.takeovers.all(x.dbs.worldId, 1).length, 0, 'back to the agent');
    assert.ok(x.notes.some(n => /Max has its texts with \(555\) 201-0042 back/.test(n.title) && /2 h without your texts/.test(n.body)), JSON.stringify(x.notes));
    await settle();
    const told = x.runs.find(r => /For your information/.test(r));
    assert.ok(told, 'caught up');
    assert.match(told, /Sam handled your texts/);
    assert.match(told, /Is Saturday still on\?/);
    assert.match(told, /] Sam: Yes, Saturday at 10\./);
  } finally { x.done(); }
});

test('the whole phone: back after its time; 0 keeps it until handed back by hand', async () => {
  const x = setup();
  try {
    await x.phone.configure(x.P, 52, { handbackMinutes: 0 });
    await x.phone.control(x.P, 52, { mode: 'human' });
    x.tick(3 * 86400000);
    x.phone.handBackIdle();
    assert.ok(x.phone.lineView(x.phone.q.line.get(x.dbs.worldId, 1)).human, 'kept: no hand-back time');
    await x.phone.configure(x.P, 52, { handbackMinutes: 30 });
    x.phone.handBackIdle();
    assert.equal(x.phone.lineView(x.phone.q.line.get(x.dbs.worldId, 1)).human, null, 'past 30 min: the agent\'s again');
    assert.ok(x.notes.some(n => /Max has its phone back/.test(n.title) && /30 min/.test(n.body)));
  } finally { x.done(); }
});
