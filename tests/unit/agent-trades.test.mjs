// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions trading of their own accord (server/economy/trades.js proposeFrom, server/companions/agent-trades.js; 2026-11-20,
// the product owner: "companions should trade themselves too"): an agent proposes to its owner (or to its owner's other
// agents) — by things' names, its own acceptance with it; nobody else may be asked; nothing moves until they accept. A
// companion out with its owner on a fishing trip with no bait of its own asks for some — when its decision service says
// so, offering the bait's worth when it has the coin — at most once in a while; another agent of its owner's decides such
// a proposal for itself; the brain's offer_trade tool proposes from a chat.
import assert from 'node:assert/strict';
import test from 'node:test';
import { economyModel } from '../helpers/econ-model.mjs';
import { Inventory } from '../../server/economy/inventory.js';
import { Trades } from '../../server/economy/trades.js';
import { subj } from '../../server/economy/economy.js';
import { AgentTrades, IDEA_AGAIN_MS } from '../../server/companions/agent-trades.js';
import { toolbox } from '../../server/mind/tools.js';

const OWNER = 7, LARA = 1, SAM = 2, OTHER = 9;
function rig() {
  const recs = [{ id: LARA, key: 'k-lara', name: 'Lara', enabled: true, ownerId: OWNER }, { id: SAM, key: 'k-sam', name: 'Sam', enabled: true, ownerId: OWNER }];
  const agents = { enabled: () => recs, byId: id => recs.find(r => r.id === Number(id)) || null, get: id => recs.find(r => r.id === Number(id)) || null };
  const T0 = { ms: 1.8e12 }, E = economyModel({ population: 40, seed: 'agent-trades', agents, now: () => T0.ms });
  const econ = E.econ; econ.parts.inventory = new Inventory(econ); econ.parts.trades = new Trades(econ, econ.parts.inventory);
  E.account(OWNER); E.account(OTHER);
  const inv = econ.parts.inventory;
  for (const w of [subj('account', OWNER), subj('agent', LARA), subj('agent', SAM)]) inv.welcome(w);
  econ.ledger.transfer(econ.faucet('grants').id, econ.walletFor(subj('agent', LARA)).id, 2000, { kind: 'grant', actor: 'system:test', memo: 'pocket money' });
  const told = [], notes = [], remarks = [];
  econ.d.notify = (id, m) => told.push({ id, ...m });
  const run = (action, payload, agentId, approved) => {   // (the economy's runAgentAction, as server/economy/index.js has it)
    if (action === 'tradeAccept') return { status: 'done', trade: econ.parts.trades.accept({ kind: 'agent', id: agentId }, { trade: payload.trade }, approved) };
    if (action === 'tradePropose') return { status: 'done', trade: econ.parts.trades.proposeFrom(agentId, { ...payload, to: payload.to === 'owner' ? { kind: 'account', id: econ.agentOwner(agentId) } : payload.to }, approved) };
    throw new Error(action);
  };
  return { E, econ, inv, recs, told, notes, remarks, run, T0, close: () => E.close() };
}
const held = (R, who, item) => R.inv.list(who).filter(s => s.item === item).reduce((a, s) => a + s.qty, 0);

test('an agent proposes to its owner by names — its side accepted, theirs to accept; to anyone else: no; nothing moves until they do', () => {
  const R = rig();
  try {
    const T = R.econ.parts.trades;
    const v = T.proposeFrom(LARA, { to: { kind: 'account', id: OWNER }, give: [{ item: 'Bunch of flowers', qty: 1 }], want: [{ item: 'Live Shrimp', qty: 5 }], memo: 'For the trip' });
    assert.ok(v.myOk && !v.theirOk && v.status === 'open', 'proposed: its side accepted');
    assert.deepEqual([v.me.items[0].name, v.them.items[0].name, v.them.items[0].qty], ['Bunch of flowers', 'Live Shrimp', 5]);
    assert.ok(R.told.some(m => m.id === OWNER && m.what === 'proposed' && m.from === 'Lara'), 'its owner is told (their page: Look / Accept / Decline)');
    assert.equal(held(R, subj('account', OWNER), 'lure:shrimp'), 10, 'nothing moved yet');
    assert.throws(() => T.proposeFrom(LARA, { to: { kind: 'account', id: OTHER }, want: [{ item: 'Americano', qty: 1 }] }), /my owner or to their other agents/, 'a stranger: no');
    assert.throws(() => T.proposeFrom(LARA, { to: { kind: 'account', id: OWNER }, want: [{ item: 'Golden Marlin', qty: 1 }] }), /doesn't hold/);
    // its owner accepts: both ways at once
    const done = T.accept({ kind: 'account', id: OWNER }, { trade: v.id });
    assert.equal(done.status, 'done');
    assert.equal(held(R, subj('agent', LARA), 'lure:shrimp'), 5); assert.equal(held(R, subj('account', OWNER), 'goods:flowers'), 1);
  } finally { R.close(); }
});

test('a companion with no bait of its own on its owner\'s fishing trip asks for some — its decision service decides, it offers the worth, once in a while; its sibling decides a proposal for itself', async () => {
  const R = rig();
  try {
    const asked = [];
    let say = 'ask';
    const fw = { decideNow: async (id, req, o) => { asked.push({ id, req, o }); return { answers: [{ type: 'choice', name: o.type === 'trade_idea' ? 'ask' : 'answer', choice: o.type === 'trade_idea' ? say : 'accept', confidence: 0.9 }] }; } };
    const bodies = [{ i: 4, order: { kind: 'follow' } }, { i: 5 }];
    const C = { live: () => [{ a: { i: 4 }, o: { kind: 'follow', lead: { kind: 'player', id: OWNER } } }], agentRecOf: i => (i === 4 ? R.recs[0] : i === 5 ? R.recs[1] : null), decides: () => true, remark: (i, text) => R.remarks.push({ i, text }), bodyOf: id => ({ i: id === LARA ? 4 : 5 }) };
    const A = new AgentTrades({ economy: () => ({ econ: R.econ, runAgentAction: R.run }), agents: { get: id => R.recs.find(r => r.id === id) }, freeWill: () => fw, companions: () => C,
      note: (id, text) => R.notes.push({ id, text }), fishingWith: acc => acc === OWNER, needs: () => ({ hunger: 0.8 }), now: () => R.T0.ms, timers: { set: (fn) => { fn(); return null; }, clear: () => {} } });
    void bodies;
    // (Lara's welcome kit has no bait: out fishing with its owner, it wants some)
    assert.equal(await A.think(R.T0.ms), 1, 'it proposed');
    const t = R.econ.parts.trades.list(subj('account', OWNER)).find(x => x.status === 'open');
    assert.ok(t, 'a proposal to its owner');
    assert.equal(t.them.who.name, 'Lara'); assert.match(t.me.items[0].name, /Live Shrimp|Nightcrawlers/);
    assert.ok(t.them.vc > 0 && t.them.vc === t.me.items[0].worth, `it offers the bait's worth (${t.them.vc})`);
    assert.equal(t.memo, 'I have no bait of my own for the trip');
    assert.ok(R.notes.some(n => n.id === LARA && /^Proposed a trade to /.test(n.text)), 'its diary');
    assert.ok(R.remarks.some(r => r.i === 4 && /asked .* for/.test(r.text)), 'a word about it (its brain)');
    assert.equal(asked.filter(x => x.o.type === 'trade_idea').length, 1, 'its decision service was asked');
    // not again soon
    R.T0.ms += 120e3; assert.equal(await A.think(R.T0.ms), 0, 'not again so soon');
    // its decision service says not now: nothing proposed
    R.econ.parts.trades.decline({ kind: 'account', id: OWNER }, { trade: t.id });
    R.T0.ms += IDEA_AGAIN_MS + 1000; say = 'no';
    assert.equal(await A.think(R.T0.ms), 0, 'its own choice: not now');
    // to its sibling: Sam decides for himself (here: accepts) — both ways at once
    const v = R.econ.parts.trades.proposeFrom(LARA, { to: { kind: 'agent', id: SAM }, vc: 100, want: [{ item: 'Americano', qty: 1 }] });
    A.onTrade(v.id, 'proposed', { kind: 'agent', id: SAM });
    await new Promise(r => setTimeout(r, 30));
    assert.equal(R.econ.parts.trades.list(subj('agent', LARA)).find(x => x.id === v.id).status, 'done', 'Sam accepted');
    assert.equal(held(R, subj('agent', LARA), 'food:coffee'), 3);
  } finally { R.close(); }
});

test('the brain\'s offer_trade: to its owner by default, or to one of its owner\'s agents; by names; refused for anyone else', () => {
  const calls = [];
  const money = { offerTrade: (id, p) => { calls.push({ id, p }); return { status: 'done' }; }, ownerOf: () => OWNER, menu: () => null };
  const wallet = { rules: { scopes: [], paused: false } };
  const T = toolbox({ agent: { id: LARA }, kind: 'chat', ctx: { places: [], peopleRefs: [{ id: '5', name: 'Sam', kind: 'agent' }], ownerName: 'Kim' }, money, wallet, people: { 5: { agentId: SAM } }, idem: 'x' });
  assert.ok(T.names.includes('offer_trade'), 'always offered in a chat');
  let [r] = T.run([{ tool: 'offer_trade', give: [{ item: 'Bunch of flowers', n: 1 }], want: [{ item: 'Live Shrimp', n: 5 }], note: 'for the trip' }]);
  assert.equal(r.ok, true, r.text);
  assert.deepEqual(calls[0].p, { to: 'owner', give: [{ item: 'Bunch of flowers', qty: 1 }], want: [{ item: 'Live Shrimp', qty: 5 }], vc: 0, wantVc: 0, memo: 'for the trip' });
  [r] = T.run([{ tool: 'offer_trade', to: 'Sam', want: [{ item: 'Americano', n: 1 }], vc: 1 }]);
  assert.equal(r.ok, true); assert.deepEqual(calls[1].p.to, { kind: 'agent', id: SAM }); assert.equal(calls[1].p.vc, 100);
  const T2 = toolbox({ agent: { id: LARA }, kind: 'chat', ctx: { places: [], peopleRefs: [], ownerName: 'Kim' }, money, wallet, people: {}, idem: 'y' });
  [r] = T2.run([{ tool: 'offer_trade', to: 'Bob', want: [{ item: 'Americano', n: 1 }] }]);
  assert.equal(r.ok, false); assert.match(r.text, /my owner or their other agents/);
});
