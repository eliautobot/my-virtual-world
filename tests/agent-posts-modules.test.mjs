// Agents on post in a world module's own building (server/agent-posts/posts.js mayPost; 2026-10-27, the product owner:
// a radio studio's hosts are "admin assigned AI agents, the same way we can already place an agent on a post"): in a
// world of lots, a world module's building (a Radio Station's studio: on no lot) is its administrators' to post their
// agents at; a building on no lot that is not a module stays no one's; a member never.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Posts } from '../server/agent-posts/posts.js';

test('administrators post agents in a world module\'s building; not elsewhere off their lots, not members', () => {
  const W = { buildings: [
    { idx: 0, floors: 1, lv: [0], module: 'wm1', radio: true },   // a Radio Station's studio (on no lot)
    { idx: 1, floors: 1, lv: [1] },                               // a city building on no lot
  ], levels: [{ items: [{ id: 1, t: 'broadcast_desk' }] }, { items: [{ id: 1, t: 'reception' }] }] };
  const P = new Posts({ sim: () => ({ people: [] }), world: () => W, agents: { list: () => [] }, perms: {}, property: { get: () => null, heldBy: () => [] }, rights: { active: true }, roleOf: () => null, save: () => {} });
  const owner = P.actorOf({ id: 1, role: 'owner' }), admin = P.actorOf({ id: 2, role: 'admin' }), member = P.actorOf({ id: 3, role: 'member' });
  assert.equal(P.mayPost(owner, 0, 0, 1), true, 'the world\'s owner, in a module\'s building');
  assert.equal(P.mayPost(admin, 0, 0, 1), true, 'an administrator too');
  assert.equal(P.mayPost(member, 0, 0, 1), false, 'not a member');
  assert.equal(P.mayPost(owner, 1, 0, 1), false, 'not a building off their lots that is no module');
});
