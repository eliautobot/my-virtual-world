// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Owners' chats wait for a slot first come, first served (server/mind/mind.js chatSlot; docs/features/CHAT.md §2): a
// slot that frees goes to the oldest waiting chat, never to a newcomer; Stop leaves the line; the count never drifts.
// (A load test found the earlier 200 ms poll let newcomers take freed slots, so unlucky chats starved to "busy".)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../../server/db.js';
import { Mind } from '../../server/mind/mind.js';
import { tempDir } from '../helpers/server.mjs';

const mind = () => new Mind({ dbs: openDb(tempDir('mvw-slots-')), agents: { get: () => null, enabled: () => [] }, connections: { get: () => null }, registry: { implemented: () => true },
  complete: async () => ({}), sim: () => ({}), life: { byAgent: new Map() }, principalFor: () => null, config: () => ({ enabled: true }) });
const tick = () => new Promise(r => setImmediate(r));

test('a freed slot goes to the oldest waiting chat; a newcomer queues behind; Stop leaves the line', async () => {
  const m = mind(), got = [], progress = [];
  for (let k = 0; k < 48; k++) await m.chatSlot({});
  assert.equal(m.chatInFlight, 48);
  const runs = { a: {}, b: {}, c: {} };
  const wait = (name, r) => m.chatSlot(r, e => progress.push(`${name}:${e.text}`)).then(() => got.push(name), e => got.push(`${name}:${e.code}`));
  const pa = wait('a', runs.a), pb = wait('b', runs.b), pc = wait('c', runs.c);
  assert.deepEqual(progress, ['a:Waiting for a free moment', 'b:Waiting for a free moment', 'c:Waiting for a free moment'], 'a waiting chat is told so');
  m.chatSlotFree(); await tick();
  const pd = wait('d', {});   // arrives just as a slot freed: behind b and c
  assert.deepEqual(got, ['a']);
  runs.b.leave(); await tick();
  assert.deepEqual(got, ['a', 'b:stopped'], 'Stop leaves the line at once');
  m.chatSlotFree(); await tick();
  m.chatSlotFree(); await tick();
  await Promise.all([pa, pb, pc, pd]);
  assert.deepEqual(got, ['a', 'b:stopped', 'c', 'd'], 'first come, first served');
  assert.equal(m.chatInFlight, 48, 'a handed-over slot keeps the count'); assert.equal(m.chatQueue.length, 0);
  for (let k = 0; k < 48; k++) m.chatSlotFree();
  assert.equal(m.chatInFlight, 0); m.chatSlotFree(); assert.equal(m.chatInFlight, 0, 'never below zero');
  await assert.rejects(m.chatSlot({ stopped: true }), e => e.code === 'stopped', 'a chat stopped before it waits never takes a slot');
  assert.equal(m.chatInFlight, 0);
  m.stop();
});
