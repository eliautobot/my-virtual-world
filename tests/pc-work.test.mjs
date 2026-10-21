// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The PC as an agent's tool and its work sessions (docs/features/agent-pc.md §4): the brain's "pc" tool runs the command
// line as the agent; a visitor's chat gets Public alone, and only when there is something in it; a task given to an agent
// by someone else starts a session — Doing, steps on its PC, then Review (or Done, or Blocked) with a note, its owner
// told, its presence shown, counted in its thinking; no brain, a limit or its owner's "no" stop it before it starts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PcOS } from '../server/pc/os.js';
import { pcToolbox, joinTools } from '../server/pc/agent-tools.js';
import { PcWork } from '../server/pc/work.js';

function setup({ answers = [], limited = null, own = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-pcw-'));
  const rows = [{ id: 1, key: 'reva', name: 'Reva', role: 'Writer', ownerId: 10, connectionId: 7 }, { id: 2, key: 'mo', name: 'Mo', ownerId: 10, connectionId: 7 }];
  const agents = { list: () => rows, get: id => rows.find(a => a.id === Number(id)) || null };
  const pc = new PcOS({ dir, agents, ownerAccount: () => 10 });
  const calls = [], records = [], told = [], events = [];
  const mind = {
    brainOf: () => (own ? { connection: { id: 7, config: { model: 'm' } }, own: true } : { connection: { id: 9 }, own: false }),
    limited: () => limited, breakerAllow: () => true, breakerOk() {}, breakerFail() {}, breakerRelease() {}, pausedText: () => null,
    costOf: () => 5, record: (agent, kind, day, o) => records.push({ agent: agent.id, kind, ...o }),
    completeFn: async (c, p) => { calls.push({ ...p, turns: p.turns.map(t => ({ ...t })) }); const a = answers.shift(); if (!a) return { text: '{"done":"nothing more","status":"review"}', usage: { in: 1, out: 1 } }; return { text: typeof a === 'string' ? a : JSON.stringify(a), usage: { in: 10, out: 5 }, model: 'm' }; },
  };
  const names = (t, me) => (t === me ? 'you' : t.startsWith('a:') ? rows.find(a => a.id === Number(t.slice(2)))?.name : 'Sam');
  const work = new PcWork({ pc, mind, agents, names, bus: { emit: e => events.push(e) }, notify: (acc, n) => told.push({ acc, ...n }), zoneOf: () => 'America/New_York' });
  const idle = async () => { for (let i = 0; i < 200 && (work.running.size || work.queue.length); i++) await new Promise(r => setTimeout(r, 10)); };
  return { pc, work, calls, records, told, events, idle, done: () => { pc.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('the brain\'s pc tool: commands run as the agent, results come back, the menu says what is on its plate', async () => {
  const { pc, done } = setup();
  try {
    pc.write({ agent: 1 }, '~/Skills/reports.md', 'How I write a weekly report\n1. …');
    pc.addCard({ human: 10 }, '~', { title: 'Plan the launch' }, { profile: 1 });
    const box = pcToolbox({ pc, agent: { id: 1, name: 'Reva' }, tz: 'UTC' });
    const menu = box.menuText().join('\n');
    assert.match(menu, /\{"use":\[\{"tool":"pc","run":"<a command>"\}\]\}/);
    assert.match(menu, /YOUR OPEN TASKS: #\d+ \[To do\] Plan the launch/);
    assert.match(menu, /YOUR SKILLS .*: reports\.md/);
    const r = await box.run([{ tool: 'pc', run: 'mkdir ~/Documents/Launch\nls ~/Documents' }, { tool: 'pc', run: 'write ~/Documents/Launch/plan.md', content: '# Plan' }, { tool: 'pc', cmd: 'read ~/Documents/Launch/plan.md' }, { tool: 'pc' }]);
    assert.deepEqual(r.map(x => x.ok), [true, true, true, false]);
    assert.match(r[0].text, /\$ mkdir ~\/Documents\/Launch\nmade ~\/Documents\/Launch\/\n\n\$ ls ~\/Documents\n/);
    assert.match(r[2].text, /# Plan/);
    assert.match(r[3].text, /give the command in "run"/);
    assert.equal(box.used.length, 4);
    // the city's tools and the PC in one round, in the order asked
    const city = { names: ['pay'], menuText: () => ['- pay'], run: us => us.map(u => ({ tool: u.tool, ok: true, text: 'paid' })) };
    const both = joinTools(city, box);
    const r2 = await both.run([{ tool: 'pay' }, { tool: 'pc', run: 'pwd' }]);
    assert.deepEqual(r2.map(x => [x.tool, x.text]), [['pay', 'paid'], ['pc', '~']]);
  } finally { done(); }
});

test('a visitor\'s toolbox: Public only, and none at all when Public is empty', async () => {
  const { pc, done } = setup();
  try {
    assert.equal(pcToolbox({ pc, agent: { id: 1 }, kind: 'visitor' }), null);
    pc.write({ agent: 1 }, '~/Public/prices.md', 'Cleaning $80');
    pc.write({ agent: 1 }, '~/Documents/private.md', 'Margins 60%');
    const v = pcToolbox({ pc, agent: { id: 1 }, kind: 'visitor' });
    assert.match(v.menuText().join('\n'), /~\/Public\/prices\.md/);
    assert.doesNotMatch(v.menuText().join('\n'), /private/);
    const r = await v.run([{ tool: 'pc', run: 'read ~/Public/prices.md' }, { tool: 'pc', run: 'read ~/Documents/private.md' }, { tool: 'pc', run: 'write ~/Public/x.md', text: 'x' }]);
    assert.deepEqual(r.map(x => x.ok), [true, false, false]);
    assert.doesNotMatch(r[1].text, /Margins/);
  } finally { done(); }
});

test('a task given to an agent starts a session: Doing, its PC, then Review with a note; its owner is told', async () => {
  const { pc, work, calls, records, told, events, idle, done } = setup({ answers: [
    { use: [{ tool: 'pc', run: 'ls /teams/ops' }, { tool: 'pc', run: 'write /teams/ops/report.md', text: '# Weekly report\nAll good.' }] },
    'not json at all',
    { use: [{ tool: 'pc', run: 'task 1 note "Draft is in /teams/ops/report.md"' }] },
    { done: 'Wrote the weekly report in /teams/ops/report.md.', status: 'review' },
  ] });
  try {
    const t = pc.createTeam({ human: 10 }, { name: 'Ops' });
    pc.setMember({ human: 10 }, t.id, 1, 'member'); pc.setMember({ human: 10 }, t.id, 2, 'lead');
    const k = pc.addCard({ agent: 2 }, '/teams/ops', { title: 'Write the weekly report', assignee: 1 });
    assert.equal(k.id, 1);
    await idle();
    const end = pc.card({ human: 10 }, k.id);
    assert.equal(end.col, 'review');
    assert.match(end.notes, /Draft is in \/teams\/ops\/report\.md\nReva: Wrote the weekly report/);
    assert.equal(end.work.state, 'done'); assert.equal(end.work.steps, 3);
    assert.equal(pc.readText({ agent: 2 }, '/teams/ops/report.md').text, '# Weekly report\nAll good.');
    assert.equal(calls.length, 4);
    assert.match(calls[0].system, /You are «Reva», «Writer», an AI agent who works for «Sam»\. You are at your PC/);
    assert.match(calls[0].turns[0].text, /THE TASK: #1 «Write the weekly report» — on the ops team's board/);
    assert.match(calls[2].turns.at(-2).text, /not json/);
    assert.deepEqual(records.map(r => [r.kind, r.status, r.cost]), [['work', 'ok', 20]]);
    assert.equal(told[0].title, 'Reva finished "Write the weekly report"');
    assert.deepEqual(told[0].link, { agent: 1, pcTask: 1 });
    assert.deepEqual(events.map(e => e.type).filter((x, i, a) => a.indexOf(x) === i), ['run.start', 'run.progress', 'tool.start', 'tool.end', 'run.end']);
    assert.ok(events.every(e => e.agentKey === 'reva' && e.connectionId === '7'));
    // its own moves never start a new one; taking a task itself doesn't either
    pc.addCard({ agent: 1 }, '~', { title: 'Tidy my notes' });
    await idle();
    assert.equal(calls.length, 4);
  } finally { done(); }
});

test('stopped before it starts: no brain of its own, a limit, its owner\'s "no"; "Work on it"; stop', async () => {
  let s = setup({ own: false });
  try {
    const k = s.pc.addCard({ human: 10 }, '~', { title: 'Do it' }, { profile: 1 });
    await s.idle();
    assert.equal(s.pc.card({ human: 10 }, k.id).work, null, 'no brain of its own: the task just waits');
    assert.equal(s.told.length, 0);
    assert.equal(s.work.workOn({ human: 10 }, k.id).queued, true, 'asked to, it tries');
    await s.idle();
    assert.equal(s.pc.card({ human: 10 }, k.id).work.state, 'failed');
    assert.match(s.told[0].body, /no brain of its own/);
    assert.equal(s.calls.length, 0);
  } finally { s.done(); }
  s = setup({ limited: 'agent_daily_limit' });
  try {
    const k = s.pc.addCard({ human: 10 }, '~', { title: 'Do it' }, { profile: 1 });
    await s.idle();
    assert.match(s.pc.card({ human: 10 }, k.id).work.error, /as much thinking as it may today/);
  } finally { s.done(); }
  s = setup({ answers: [{ done: 'Booked.', status: 'done' }] });
  try {
    s.work.setAutoWork(1, false);
    const k = s.pc.addCard({ human: 10 }, '~', { title: 'Book the room' }, { profile: 1 });
    await s.idle();
    assert.equal(s.calls.length, 0, 'its owner switched it off: it waits');
    assert.throws(() => s.work.workOn({ human: 20 }, k.id), { code: 'not_found' }, 'another account never starts it');
    assert.equal(s.work.workOn({ human: 10 }, k.id).queued, true);
    assert.equal(s.work.workOn({ human: 10 }, k.id).already, true);
    await s.idle();
    assert.equal(s.pc.card({ human: 10 }, k.id).col, 'done');
    assert.throws(() => s.work.workOn({ human: 10 }, k.id), { code: 'done' });
  } finally { s.done(); }
  s = setup({ answers: Array.from({ length: 20 }, () => ({ use: [{ tool: 'pc', run: 'pwd' }] })) });
  try {
    const k = s.pc.addCard({ human: 10 }, '~', { title: 'Endless' }, { profile: 1 });
    await s.idle();
    const end = s.pc.card({ human: 10 }, k.id);
    assert.equal(end.work.state, 'blocked');
    assert.match(end.notes, /Ran out of steps/);
    assert.equal(s.calls.length, 14);
  } finally { s.done(); }
});
