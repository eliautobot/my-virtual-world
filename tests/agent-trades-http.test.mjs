// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Trading with one's own agents over HTTP (server/economy/trades.js propose, server/companions/agent-trades.js; 2026-11-20,
// the product owner: "trade with companions … give them any inventory item … they should be able to give me an inventory
// item as well … intuitive, easy, and also safe so that no one can steal"): its owner proposes both sides at once — what
// they give, what they would like — and the agent decides for itself a moment later (here its habit: no decision service):
// a gift taken, its owner's fair ask accepted (everything both ways at once), an ask that would leave it much the poorer
// declined with why; nobody else may ask an agent for its things; nothing moves without its yes.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, agent;
const sleep = ms => new Promise(r => setTimeout(r, ms));
before(async () => {
  s = await startServer({ population: 60, agents: 1 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann' });
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  agent = (await owner.get('/api/agents')).json.agents.find(a => a.mine !== false);
  assert.ok(agent, 'an agent of the owner\'s');
});
after(async () => { await s?.stop(); });

const inv = async (agentId = null) => (await owner.get(`/api/inventory${agentId ? `?agent=${agentId}` : ''}`)).json.stacks;
const tradeOf = async id => (await owner.get('/api/inventory/trades')).json.trades.find(t => t.id === id);
/** Waits for the agent's answer (its turn a moment after the proposal). */
async function answer(id) { for (let k = 0; k < 40; k++) { await sleep(150); const t = await tradeOf(id); if (t && t.status !== 'open') return t; if (t?.myOk && t.theirOk) return t; } return tradeOf(id); }

test('its owner\'s proposal: a gift taken; a fair swap accepted, both ways at once; an ask that would leave it much the poorer declined; nobody else may ask', async () => {
  const mine0 = await inv(), its0 = await inv(agent.id);
  const myCoffee = mine0.find(x => x.item === 'food:coffee'), itsGift = its0.find(x => x.item === 'goods:gift'), itsShrimp = its0.find(x => x.item === 'lure:shrimp');
  assert.ok(myCoffee && itsGift, `welcome kits: ${JSON.stringify(mine0.map(x => x.item))} / ${JSON.stringify(its0.map(x => x.item))}`);
  // a gift: one coffee to it, nothing asked
  let r = await owner.post('/api/inventory/trade/propose', { to: { kind: 'agent', id: agent.id }, give: [{ stack: myCoffee.id, qty: 1 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.myOk && !r.json.theirOk, 'proposed: my side accepted, its not yet');
  let t = await answer(r.json.id);
  assert.equal(t.status, 'done', `the gift taken: ${JSON.stringify(t)}`);
  assert.ok((await inv(agent.id)).some(x => x.item === 'food:coffee'), 'the coffee is its now');
  // a swap: a coffee of mine for its gift box (its owner asks; close enough in worth)
  const mine1 = await inv(), coffee2 = mine1.find(x => x.item === 'food:coffee');
  r = await owner.post('/api/inventory/trade/propose', { to: { kind: 'agent', id: agent.id }, give: coffee2 ? [{ stack: coffee2.id, qty: 1 }] : [], vc: coffee2 ? 0 : 100, want: [{ stack: itsGift.id, qty: 1 }], memo: 'Swap?' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  t = await answer(r.json.id);
  assert.equal(t.status, 'done', `the swap: ${JSON.stringify(t)}`);
  assert.ok((await inv()).some(x => x.item === 'goods:gift'), 'the gift box is mine');
  assert.ok(!(await inv(agent.id)).some(x => x.item === 'goods:gift'), 'and no longer its');
  // an ask for a lot of coin for nothing: declined, and why
  const its2 = (await owner.get(`/api/economy/me`)).json;   // (the owner's wallet: unchanged by its no)
  // (a small ask from its owner, nothing given back: a favour — accepted)
  const small = itsShrimp || (await inv(agent.id)).filter(x => x.item !== 'food:coffee').sort((a, b) => (a.value || 0) - (b.value || 0))[0];
  r = await owner.post('/api/inventory/trade/propose', { to: { kind: 'agent', id: agent.id }, want: [{ stack: small.id, qty: 1 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  t = await answer(r.json.id);
  assert.equal(t.status, 'done', 'a small favour for its owner: yes');
  const agentMoney = (await owner.get(`/api/economy/agents/${agent.id}`)).json?.wallet?.available ?? null;
  r = await owner.post('/api/inventory/trade/propose', { to: { kind: 'agent', id: agent.id }, wantVc: 999999 });
  assert.equal(r.status, 409, 'more coin than it has: refused at once');
  void its2; void agentMoney;
  // nobody else may ask an agent for its things
  r = await ann.post('/api/inventory/trade/propose', { to: { kind: 'agent', id: agent.id }, want: [{ stack: (await inv(agent.id))[0].id, qty: 1 }] });
  assert.equal(r.status, 403, 'not her agent');
  r = await ann.post('/api/inventory/trade/propose', { to: { kind: 'account', id: owner.me?.account?.id || 1 }, give: [] });
  assert.equal(r.status, 400, 'a player puts in their own side');
});

test('an ask that would leave it much the poorer: declined, said why — nothing moved', async () => {
  // its money: a grant, then its owner asks for most of it
  const g = await owner.post('/api/economy/admin/grant', { to: { kind: 'agent', id: agent.id }, amount: 20000, memo: 'pocket money' });
  assert.ok(g.status === 200 || g.status === 201, JSON.stringify(g.json));
  const before = await inv(agent.id);
  // (its owner's page: it hears the answer, with why)
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } }), heard = [];
  ws.onmessage = e => { if (typeof e.data === 'string') { const m = JSON.parse(e.data); if (m.t === 'inv' && m.ev === 'trade') heard.push(m); } };
  await new Promise(res => { ws.onopen = res; });
  const r = await owner.post('/api/inventory/trade/propose', { to: { kind: 'agent', id: agent.id }, wantVc: 15000 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t = await answer(r.json.id);
  assert.equal(t.status, 'declined', `declined: ${JSON.stringify(t)}`);
  assert.deepEqual((await inv(agent.id)).map(x => [x.item, x.qty]), before.map(x => [x.item, x.qty]), 'nothing moved');
  await sleep(300);
  const said = heard.find(m => m.what === 'said' && m.trade === r.json.id);
  assert.ok(said && /said no — that's worth 150 VC for 0 VC — too much to give away/.test(said.text), `its answer, with why: ${JSON.stringify(heard)}`);
  ws.close();
});
