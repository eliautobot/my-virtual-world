// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent buying at venues stays within its owner's limits (server/economy/households.js agentMayBuy; 2026-10-11): an
// outside AI told to go back to someone's café again and again can't spend past its owner's daily cap, buys nothing while
// its owner has paused it or not allowed buying, and residents (not agents) are untouched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Households } from '../../server/economy/households.js';

function fixture(limits) {
  let now = 1_000_000_000;
  const h = Object.create(Households.prototype);
  h.agentVenue = new Map();
  h.e = {
    now: () => now,
    personSubject: p => (p.agentId ? { kind: 'agent', id: p.agentId } : { kind: 'person', id: p.id }),
    parts: { agents: { limitsOf: () => ({ scopes: ['work', 'buy'], dailyCap: 10000, spent24h: 0, paused: false, ...limits() }) } },
  };
  return { h, later: ms => { now += ms; } };
}
const agent = { id: 7, vip: true, agentId: 42 }, resident = { id: 8 };

test('venue purchases count against the daily cap, with what it paid in other ways; a day later there is room again', () => {
  let L = { spent24h: 2000 };
  const { h, later } = fixture(() => L);
  assert.equal(h.agentMayBuy(agent, 3000), true);
  assert.equal(h.agentMayBuy(agent, 3000), true);
  assert.equal(h.agentMayBuy(agent, 3000), false, '2000 paid + 6000 at venues + 3000 would pass 10000');
  assert.equal(h.agentMayBuy(agent, 2000), true, 'exactly up to the cap is fine');
  assert.equal(h.agentMayBuy(agent, 1), false);
  later(86400000 + 1);
  L = { spent24h: 0 };
  assert.equal(h.agentMayBuy(agent, 3000), true, 'the window moved on');
});

test('paused, or not allowed to buy: nothing — and a resident is not an agent', () => {
  let L = { paused: true };
  const { h } = fixture(() => L);
  assert.equal(h.agentMayBuy(agent, 100), false);
  L = { scopes: ['work'] };
  assert.equal(h.agentMayBuy(agent, 100), false);
  L = { dailyCap: 0 };
  assert.equal(h.agentMayBuy(agent, 100), false, 'a cap of 0 stops all spending');
  assert.equal(h.agentMayBuy(resident, 1e9), true, 'residents follow their wallets only');
});
