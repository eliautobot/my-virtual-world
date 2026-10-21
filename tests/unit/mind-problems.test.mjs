// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Mind's problems and money tools on their own (docs/features/FREE-WILL.md §11.11): what opens a problem and what
// resolves it (twice in a row; money with a margin; rent says more than money; a retired body has no job to lose), what
// the agent remembers and its owner is told; the tools a thought may use, their limits, references and refusals; what a
// problem's answer may do; the problem's prompt.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { openDb } from '../../server/db.js';
import { Problems, openWords } from '../../server/mind/problems.js';
import { toolbox, resultsText, MAX_DO, MAX_PER_ROUND } from '../../server/mind/tools.js';
import { readActions } from '../../server/mind/actions.js';
import { problemText } from '../../server/mind/prompt.js';
import { LedgerError } from '../../server/economy/ledger.js';
import { snapshotText } from '../../server/free-will/prompt.js';
import { tempDir } from '../helpers/server.mjs';

const VC = n => n * 100;

function rig() {
  const dir = tempDir('mvw-problems-');
  const dbs = openDb(dir);
  const people = [
    { id: 0, name: 'Adam', vip: 1, agentId: 1, home: { b: 0, f: 1, u: 0, bed: [1, 0] }, job: { kind: 'vip', title: 'Engineer at HQ', b: 1 } },
    { id: 1, name: 'Bea', vip: 1, agentId: 2, home: { b: 0, f: 1, u: 1, bed: [2, 0] }, job: { kind: 'free', title: 'Retired', retired: 1 } },
  ];
  const sim = { people, world: { buildings: [{ name: 'Elm Court' }, { name: 'HQ' }] }, now: () => 1000 };
  const memories = [], told = [];
  const life = { byAgent: new Map([[1, 0], [2, 1]]), remember: (id, m) => memories.push({ id, ...m }), today: () => 5, clockAt: () => 'Monday 9:00 AM' };
  const agents = { enabled: () => [{ id: 1, name: 'Adam', ownerId: 7 }, { id: 2, name: 'Bea', ownerId: 7 }] };
  const money = { troubles: new Map(), available: new Map([[0, VC(500)], [1, VC(500)]]) };
  const P = new Problems({ dbs, agents, sim: () => sim, life, notify: (id, m) => told.push({ id, ...m }),
    money: () => ({ troubles: () => money.troubles }), wallets: () => ({ money: p => ({ available: money.available.get(p.id), rentPerDay: VC(20) }) }) });
  return { P, dbs, people, memories, told, money, close: () => { dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('problems open when seen twice and resolve when gone twice; the agent remembers, its owner is told', () => {
  const R = rig();
  try {
    const { P, people, memories, told, money } = R;
    P.scan();                                                 // (names what it has: its home, its job)
    people[0].home = null; people[0].job = { kind: 'free', title: 'Between jobs', lost: 1 };
    P.scan();
    assert.deepEqual(P.openOf(1), [], 'once is not enough (the city may re-home it a moment later)');
    P.scan();
    assert.deepEqual(P.openOf(1).map(r => r.kind).sort(), ['home', 'job']);
    assert.deepEqual(memories.map(m => m.text).sort(), ['Lost my home at Elm Court', 'Lost my job (Engineer at HQ)']);
    assert.ok(memories.every(m => m.day === 5 && m.time === 'Monday 9:00 AM' && m.kind === 'event'));
    assert.deepEqual(told.map(t => [t.id, t.t, t.ev, t.kind]).sort(), [[7, 'mind', 'problem', 'home'], [7, 'mind', 'problem', 'job']]);
    assert.equal(P.openOf(2).length, 0, 'a retired body has no job to lose');
    // a new home: resolved after two scans, remembered
    people[0].home = { b: 0, f: 1, u: 3, bed: [9, 0] };
    P.scan(); assert.ok(P.openOf(1).some(r => r.kind === 'home'));
    P.scan(); assert.ok(!P.openOf(1).some(r => r.kind === 'home'));
    assert.ok(memories.some(m => m.text === 'Moved into a new home at Elm Court'));
    assert.equal(told.at(-1).ev, 'solved');
    // money: opens below 3 days of rent and living (20 + 25 VC a day), stays open until 6 days
    money.available.set(0, VC(100)); P.scan(); P.scan();
    assert.ok(P.openOf(1).some(r => r.kind === 'money'));
    assert.match(P.words(1).find(w => /Money/.test(w)), /^Money is tight: 100 VC left, about 2.2 days/);
    money.available.set(0, VC(200)); P.scan(); P.scan();
    assert.ok(P.openOf(1).some(r => r.kind === 'money'), '4.4 days: still tight (no flapping at the line)');
    // rent it couldn't pay says more than money: money resolves while rent opens
    money.troubles.set(1, { owed: VC(44), lease: null }); P.scan(); P.scan();
    assert.deepEqual(P.openOf(1).map(r => r.kind).sort(), ['job', 'rent']);
    assert.ok(P.words(1).includes('My rent is behind: I owe 44 VC'));
    // what it owes changes: the problem's details follow without reopening it
    money.troubles.set(1, { owed: VC(20), lease: { title: 'Flat 2', perDay: VC(10), status: 'due', graceLeft: 1 } }); P.scan();
    assert.match(P.words(1).find(w => /rent/.test(w)), /^My rent for Flat 2 is overdue \(10 VC a day; 1 day of grace left\); I owe 20 VC$/);
    // its Mind thought about it: every open problem marked for the day, with a note
    P.thought(1, 5, 'asked my owner for 40 VC');
    assert.ok(P.openOf(1).every(r => r.lastThoughtDay === 5 && r.thoughts === 1 && r.note === 'asked my owner for 40 VC'));
    // all of it is kept: a new Problems (a restart) has the same open problems
    const again = new Problems({ dbs: R.dbs, agents: { enabled: () => [] }, sim: () => null, life: {} });
    assert.deepEqual(again.openOf(1).map(r => r.kind).sort(), ['job', 'rent']);
    assert.deepEqual(again.list(1).map(r => `${r.kind}:${r.status}`), ['rent:open', 'money:resolved', 'job:open', 'home:resolved']);
  } finally { R.close(); }
});

test('problem words: a memory when it opens, a line of the prompt while it lasts', () => {
  assert.equal(openWords('rent', { owed: VC(12.5) }), 'Couldn\'t pay all my rent (I owe 12.50 VC)');
  assert.equal(openWords('rent', { lease: { title: 'Flat 1', status: 'ending' } }, true), 'My lease of Flat 1 is ending: the rent went unpaid');
  assert.equal(openWords('job', {}, true), 'I have no job');
  assert.equal(openWords('home', { lost: 'Elm Court' }), 'Lost my home at Elm Court');
});

/** A fake economy for the tools: what it was asked, and answers as the real one gives them. */
function fakeMoney({ rules = {}, refuse = null } = {}) {
  const calls = [];
  return {
    calls,
    ownerOf: () => 7,
    flats: () => [{ id: 'lst_a', title: 'Flat 1 on floor 2 of Elm Court', perMonth: VC(600), perDay: VC(20), landlord: 'City' }, { id: 'lst_b', title: 'Flat 3', perMonth: VC(900), perDay: VC(30), landlord: 'Ann' }],
    menu: (b, f) => (b === 4 && f === 0 ? { business: { id: 'biz_bean', name: 'Bean There', kind: 'cafe' }, items: [{ id: 'flat_white', label: 'Flat white', price: 350 }, { id: 'croissant', label: 'Croissant', price: 300 }] } : null),
    rentFlat: (a, id, idem) => { calls.push(['rent', id, idem]); if (refuse) throw new LedgerError('budget', refuse, 403); return rules.approve ? { status: 'pending', approval: 'appr_1' } : { status: 'done' }; },
    buy: (a, biz, items, idem) => { calls.push(['buy', biz, items, idem]); return { status: 'done' }; },
    pay: (a, to, amount, memo, idem) => { calls.push(['pay', to, amount, memo, idem]); return { status: 'done' }; },
    askOwner: (a, amount, memo) => { calls.push(['ask', amount, memo]); return { id: 'req_1' }; },
    give: (a, to, item, qty, memo, idem) => { calls.push(['give', to, item, qty, idem]); return { status: 'done' }; },
  };
}
const wallet = (scopes = ['rent', 'buy', 'pay'], paused = false) => ({ available: VC(50), rentPerDay: VC(20), owed: 0, lease: null, waiting: 0, askOpen: false, rules: { scopes, dailyCap: VC(100), approveAbove: VC(10), paused, spent24h: 0, leftToday: VC(100) } });
const ctx = { places: [{ kind: 'cafe', name: 'Bean There', b: 4, f: 0, minutes: 3 }], peopleRefs: [{ name: 'Lea', kind: 'agent', id: '1' }, { name: 'Tom', kind: 'resident', id: '2' }], ownerName: 'casey' };
const people = [{ id: 0 }, { id: 1, agentId: 9 }];

test('tools: by kind of thought and its owner\'s rules; references from the results; at most two money actions; refusals said', () => {
  const m = fakeMoney();
  const T = toolbox({ agent: { id: 1 }, kind: 'problem', ctx, money: m, wallet: wallet(), people, idem: 'mind:1:5' });
  assert.deepEqual(T.names, ['flats', 'rent_flat', 'ask_owner']);
  assert.deepEqual(toolbox({ agent: { id: 1 }, kind: 'chat', ctx, money: m, wallet: wallet(), people, idem: 'x' }).names, ['flats', 'menu', 'rent_flat', 'buy', 'pay', 'give']);
  assert.deepEqual(toolbox({ agent: { id: 1 }, kind: 'chat', ctx, money: m, wallet: wallet(['buy']), people, idem: 'x' }).names, ['menu', 'buy'], 'only what its owner allows');
  assert.deepEqual(toolbox({ agent: { id: 1 }, kind: 'problem', ctx, money: m, wallet: wallet(undefined, true), people, idem: 'x' }).names, [], 'paused: nothing');
  // a flat by a reference "flats" gave; before that, none
  assert.match(T.run([{ tool: 'rent_flat', flat: 'F1' }])[0].text, /use a flat from the list/);
  const [list] = T.run([{ tool: 'flats' }]);
  assert.match(list.text, /^FLATS FOR RENT: \[F1\] «Flat 1 on floor 2 of Elm Court» — 600 VC a month \(20 VC a day\), let by «City»; \[F2\]/);
  const r = T.run([{ tool: 'rent_flat', flat: 'f2' }, { tool: 'ask_owner', amount: 40, why: 'rent\u0000' }, { tool: 'ask_owner', amount: 10 }, { tool: 'flats' }]);
  assert.equal(r.length, MAX_PER_ROUND, 'at most three a round');
  assert.equal(r[0].text, 'done: I rent «Flat 3» from today (30 VC a day)');
  assert.equal(r[1].text, 'done: asked my owner for 40 VC; they answer in their wallet');
  assert.equal(r[2].text, `not done: at most ${MAX_DO} money actions at a time`);
  assert.deepEqual(m.calls, [['rent', 'lst_b', 'mind:1:5:1'], ['ask', VC(40), 'rent']]);
  assert.equal(T.summary(), 'Rented Flat 3 (30 VC a day); Asked you for 40 VC (rent)', 'its owner reads what it did, in plain words');
  assert.match(resultsText(r, true), /^RESULTS:\n- rent_flat: done[^]*That was my last look: now answer with the final JSON/);
  // above the owner's limit the economy files an approval: nothing happened yet, and it says so
  const T2 = toolbox({ agent: { id: 1 }, kind: 'problem', ctx, money: fakeMoney({ rules: { approve: true } }), wallet: wallet(), people, idem: 'y' });
  T2.run([{ tool: 'flats' }]);
  const w2 = T2.run([{ tool: 'rent_flat', flat: 'F1' }])[0];
  assert.match(w2.text, /^waiting: my owner must agree first/);
  assert.equal(T2.summary(), 'Wants to rent Flat 1 on floor 2 of Elm Court (20 VC a day) — waiting for your OK');
  // the economy refuses (its daily limit): the reason, as the economy gives it
  const T3 = toolbox({ agent: { id: 1 }, kind: 'problem', ctx, money: fakeMoney({ refuse: 'That would pass your daily limit.' }), wallet: wallet(), people, idem: 'z' });
  T3.run([{ tool: 'flats' }]);
  assert.equal(T3.run([{ tool: 'rent_flat', flat: 'F1' }])[0].text, 'not done: That would pass your daily limit.');
  assert.equal(T3.summary(), 'Couldn\'t rent Flat 1 on floor 2 of Elm Court (20 VC a day): That would pass your daily limit.');
  // not on this thought's list: paying is not a problem tool, an unknown tool neither
  assert.deepEqual(T.run([{ tool: 'pay', to: 'my owner', amount: 1 }, { tool: 'shell', cmd: 'ls' }]).map(x => x.text), ['not done: that is not something I may do now', 'not done: that is not something I may do now']);
});

test('tools in a chat: a real place\'s menu, buying from it, paying people it knows, its owner, or a place — no one else', () => {
  const m = fakeMoney();
  const T = toolbox({ agent: { id: 1 }, kind: 'chat', ctx, money: m, wallet: wallet(), people, idem: 'c' });
  assert.match(T.run([{ tool: 'menu', place: 'Nowhere' }])[0].text, /I don't know a place called «Nowhere»/);
  assert.equal(T.run([{ tool: 'menu', place: 'bean there' }])[0].text, 'AT «Bean There»: [I1] «Flat white» 3.50 VC; [I2] «Croissant» 3 VC');
  assert.equal(T.run([{ tool: 'buy', place: 'Bean There', items: [{ item: 'I1', n: 2 }, { item: 'I2' }, { item: 'I9' }] }])[0].text, 'done: bought 2 × Flat white, Croissant at Bean There for 10 VC');
  assert.deepEqual(m.calls[0], ['buy', 'biz_bean', [{ id: 'flat_white', n: 2 }, { id: 'croissant', n: 1 }], 'c:1']);
  const T2 = toolbox({ agent: { id: 1 }, kind: 'chat', ctx, money: m, wallet: wallet(), people, idem: 'd' });
  const out = T2.run([{ tool: 'pay', to: 'Lea', amount: '2.5', memo: 'lunch' }, { tool: 'pay', to: 'Tom', amount: 1 }, { tool: 'pay', to: 'casey', amount: 0 }]);
  assert.equal(out[0].text, 'done: paid 2.50 VC to Lea');
  assert.match(out[1].text, /^not done: I can pay my owner, a person I know or a place — not «Tom»/, 'a resident has no wallet to pay');
  assert.equal(out[2].text, 'not done: the amount must be a number of VC');
  assert.deepEqual(m.calls.at(-1), ['pay', { kind: 'agent', id: 9 }, 250, 'lunch', 'd:1']);
  const T3 = toolbox({ agent: { id: 1 }, kind: 'chat', ctx, money: m, wallet: wallet(), people, idem: 'e' });
  T3.run([{ tool: 'pay', to: 'my owner', amount: 1 }, { tool: 'pay', to: 'Bean There', amount: 1 }]);
  assert.deepEqual(m.calls.slice(-2).map(c => c[1]), [{ kind: 'account', id: 7 }, { kind: 'business', id: 'biz_bean' }]);
});

test('a problem\'s answer: ≤2 plans, ≤1 short memory, a word to its owner — no plans dropped, nothing done', () => {
  const a = readActions('problem', { plans: [{ kind: 'must', text: 'Ask about cheaper flats' }, { text: 'Cook at home' }, { text: 'A third' }], memories: [{ term: 'long', text: 'Rent is hard', importance: 5 }, { text: 'Second' }],
    drop: [1], done: [1], tell_owner: 'Could you lend me 40 VC?', thought: 'Worried.' }, { plans: [{ id: 1, text: 'Old plan' }] });
  assert.deepEqual(a.plans, [{ kind: 'must', text: 'Ask about cheaper flats' }, { kind: 'want', text: 'Cook at home' }]);
  assert.deepEqual(a.memories, [{ term: 'short', text: 'Rent is hard', importance: 5 }]);
  assert.deepEqual([a.drop, a.done, a.tellOwner, a.thought], [[], [], 'Could you lend me 40 VC?', 'Worried.']);
  assert.equal(readActions('chat', { reply: 'Hi', tell_owner: 'x' }, {}).tellOwner, null, 'only a problem tells its owner');
});

test('the problem\'s prompt: what is wrong, its money and its owner\'s rules, the tools, quoted names', () => {
  const c = { name: 'Adam', role: '', personality: [], bio: '', purpose: '', aspirations: [], likes: [], dislikes: [], now: { weekday: 'Monday', clock: '9:00 AM' }, where: 'at home',
    job: null, home: 'Elm Court', plans: [], memoriesLong: [], memoriesShort: [], people: [], places: [{ kind: 'cafe', name: 'Bean «There»', minutes: 3, price: 900 }], atHome: true,
    troubles: ['My rent is behind: I owe 44 VC'], wallet: { ...wallet(['rent', 'pay']), owed: VC(44), waiting: 1, askOpen: true } };
  const t = problemText(c, ['TOOLS (to use some, answer {"use":[...]} with up to 3 of them; the results come back to me):', '- {"tool":"flats"} — x']);
  assert.match(t, /WHAT IS WRONG: «My rent is behind: I owe 44 VC»\./);
  assert.match(t, /MY MONEY: 50 VC to spend; my rent is 20 VC a day; I owe 44 VC in rent\./);
  assert.match(t, /MY OWNER'S RULES: I may rent a home, pay people; up to 100 VC a day \(100 VC left today\); above 10 VC my owner agrees first\. 1 of my requests wait for their OK\. I asked my owner for money/);
  assert.match(t, /café «Bean There» \(3 min walk/, 'a quote inside a name cannot close it');
  assert.match(t, /TOOLS \(to use some/);
  assert.match(t, /FINAL JSON: \{"plans"/);
  assert.doesNotMatch(problemText(c, []), /TOOLS|look things up/, 'no tools: none mentioned');
});

test('Free Will hears its worries with every choice (at most three)', () => {
  const t = snapshotText({ name: 'Adam', tr: {}, needs: {}, h: 12, day: 0, atHome: true, worries: ['Money is tight: 40 VC left', 'I have no job', 'a', 'b'], plans: ['must Cook at home'] });
  assert.match(t, /\nWorries: Money is tight: 40 VC left; I have no job; a\.\nPlans: must Cook at home\./);
});

test('giving something it holds (a chat with its owner): to its owner or a person it knows, its owner\'s rules deciding', () => {
  const m = fakeMoney();
  const T = toolbox({ agent: { id: 1 }, kind: 'chat', ctx, money: m, wallet: wallet(), people, idem: 'g' });
  const r = T.run([{ tool: 'give', item: 'Gift box', to: 'Lea' }, { tool: 'give', item: 'Americano', n: 2, to: 'my owner' }]);
  assert.equal(r[0].text, 'done: gave «Gift box» to Lea');
  assert.equal(r[1].text, 'done: gave 2 × «Americano» to my owner');
  assert.deepEqual(m.calls.map(c => c.slice(0, 4)), [['give', { kind: 'agent', id: 9 }, 'Gift box', 1], ['give', { kind: 'account', id: 7 }, 'Americano', 2]]);
  assert.equal(T.summary(), 'Gave Gift box to Lea; Gave 2 × Americano to you');
  assert.match(toolbox({ agent: { id: 1 }, kind: 'chat', ctx, money: fakeMoney(), wallet: wallet(), people, idem: 'h' }).run([{ tool: 'give', item: 'Gift box', to: 'a stranger' }])[0].text, /^not done: I can give to my owner/);
  assert.ok(!toolbox({ agent: { id: 1 }, kind: 'chat', ctx, money: m, wallet: wallet(['buy']), people, idem: 'x' }).names.includes('give'), 'not without its owner allowing "pay"');
});
