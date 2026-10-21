// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The PC's command line (docs/features/agent-pc.md §4): words as models write them (quotes or none, several commands in
// one go, text after <<EOF), answers in plain words, errors that say what to do, pages, tasks, the calendar in the
// agent's time zone, teams, and a visitor who can only read Public.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PcOS } from '../server/pc/os.js';
import { PcShell, words, commandsOf } from '../server/pc/shell.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-pcsh-'));
  const rows = [{ id: 1, name: 'Reva', role: 'Front desk', ownerId: 10 }, { id: 2, name: 'Mo', role: 'Writer', ownerId: 10 }, { id: 3, name: 'Kit', ownerId: 10 }, { id: 4, name: 'Zed', ownerId: 20 }];
  const agents = { list: () => rows, get: id => rows.find(a => a.id === Number(id)) || null };
  const now = Date.parse('2026-10-18T16:00:00Z');   // Sunday 12:00 in New York
  const pc = new PcOS({ dir, agents, ownerAccount: () => 10, now: () => now });
  const names = (tag, me) => (tag === me ? 'you' : tag.startsWith('a:') ? rows.find(a => a.id === Number(tag.slice(2)))?.name || 'someone' : 'your owner');
  const sh = (who, o = {}) => new PcShell(pc, { who, tz: 'America/New_York', names, now: () => now, ...o });
  return { pc, sh, done: () => { pc.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('words and commands as models write them', () => {
  assert.deepEqual(words('write "~/My Docs/a b.md" now'), ['write', '~/My Docs/a b.md', 'now']);
  assert.deepEqual(words("task add 'Call Sam' --to Mo"), ['task', 'add', 'Call Sam', '--to', 'Mo']);
  assert.deepEqual(words('note "say \\"hi\\""'), ['note', 'say "hi"']);
  assert.deepEqual(words('task add “Smart quotes” x'), ['task', 'add', 'Smart quotes', 'x']);
  const c = commandsOf('$ ls ~\nwrite ~/a.md <<EOF\nline 1\n\nline 3\nEOF\n# a comment\nread ~/a.md');
  assert.deepEqual(c, [{ line: 'ls ~' }, { line: 'write ~/a.md', text: 'line 1\n\nline 3' }, { line: 'read ~/a.md' }]);
});

test('files: write, read in pages, edit, ls, mv, cp, rm, trash, restore, find, info - one request or several', async () => {
  const { sh, done } = setup();
  try {
    const s = sh({ agent: 1 });
    let r = await s.run('write ~/Documents/plan.md <<EOF\n# Plan\n- call Sam\n- book the room\nEOF\nread ~/Documents/plan.md');
    assert.equal(r.results.length, 2);
    assert.match(r.results[0].out, /^made ~\/Documents\/plan\.md \(\d+ bytes, version 1\)$/);
    assert.match(r.results[1].out, /^~\/Documents\/plan\.md - 3 lines, .* version 1, changed Sun, Oct 18, 12:00\n# Plan\n- call Sam/);
    r = await s.run('edit ~/Documents/plan.md', { find: '- call Sam', replace: '- call Sam on Friday' });
    assert.equal(r.text, 'changed ~/Documents/plan.md (1 place, version 2)');
    r = await s.run('edit ~/Documents/plan.md <<EOF\nbook the room\n=====\nbook room 2\nEOF');
    assert.match(r.text, /^changed/);
    r = await s.run('edit ~/Documents/plan.md', { find: 'call Bob', replace: 'x' });
    assert.match(r.text, /^error: "call Bob" isn't in ~\/Documents\/plan\.md\. Read the file/);
    r = await s.run('read ~/Documents/plna.md');
    assert.match(r.text, /^error: No such file or folder: ~\/Documents\/plna\.md\. Did you mean ~\/Documents\/plan\.md\?/);
    r = await s.run('lss ~');
    assert.match(r.text, /isn't a PC command\. Did you mean ls/);
    r = await s.run('write ~/notes.txt');
    assert.match(r.text, /^error: write needs the text/);
    r = await s.run('write ~/notes.txt "quick note"');
    assert.match(r.text, /^made ~\/notes\.txt/);
    // pages
    await s.run('write ~/long.md', { text: Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join('\n') });
    r = await s.run('read ~/long.md');
    assert.match(r.text, /\(lines 1–200 of 450\)/); assert.match(r.text, /… 250 more lines: read ~\/long\.md 201$/);
    r = await s.run('read ~/long.md 441');
    assert.match(r.text, /line 450$/);
    r = await s.run('cd Documents\nls\nmkdir Old\nmv plan.md Old\ncp Old/plan.md ~/Public/plan-copy.md\nls ~/Public\npwd');
    assert.ok(r.results.every(x => x.ok), r.text);
    assert.match(r.results[1].out, /^~\/Documents - 1 item\nplan\.md/);
    assert.match(r.results[5].out, /plan-copy\.md/);
    assert.equal(r.results[6].out, '~/Documents');
    r = await s.run('find room');
    assert.match(r.text, /~\/Documents\/Old\/plan\.md - .*book room 2/);
    r = await s.run('rm ~/Public/plan-copy.md\ntrash');
    const id = /\[(\d+)\]/.exec(r.results[1].out)[1];
    r = await s.run(`restore ${id}`);
    assert.equal(r.text, 'restored ~/Public/plan-copy.md');
    r = await s.run('info ~/Documents/Old/plan.md\nversions ~/Documents/Old/plan.md\nrevert ~/Documents/Old/plan.md 1\ndu');
    assert.ok(r.results.every(x => x.ok), r.text);
    assert.match(r.results[0].out, /version 3, changed .* by you/);
    assert.match(r.results[3].out, /used of .* shared by the account's 3 agents and 0 teams/);
    r = await s.run('rm ~/Documents');
    assert.match(r.text, /one of the PC's own folders/);
  } finally { done(); }
});

test('a save on top of a teammate\'s change is refused until it reads again', async () => {
  const { pc, sh, done } = setup();
  try {
    const t = pc.createTeam({ human: 10 }, { name: 'Ops' });
    pc.setMember({ human: 10 }, t.id, 1, 'lead'); pc.setMember({ human: 10 }, t.id, 2, 'member');
    const reva = sh({ agent: 1 }), mo = sh({ agent: 2 });
    await reva.run('write /teams/ops/brief.md "v1"');
    await mo.run('read /teams/ops/brief.md');
    await reva.run('write /teams/ops/brief.md "v2 by reva"');
    let r = await mo.run('write /teams/ops/brief.md "v2 by mo"');
    assert.match(r.text, /^error: \/teams\/ops\/brief\.md was changed since it was read/);
    r = await mo.run('read /teams/ops/brief.md\nwrite /teams/ops/brief.md "v3 by mo"');
    assert.ok(r.results[1].ok, r.text);
    // never read: someone else's file needs a read first, or force
    const kit = sh({ agent: 1 });
    r = await kit.run('write /teams/ops/brief.md "blind"');
    assert.match(r.text, /exists already \(last changed by a:2\)\. Read it first/);
    r = await kit.run('write -f /teams/ops/brief.md "forced"');
    assert.match(r.text, /^saved/);
  } finally { done(); }
});

test('tasks and the calendar, in the agent\'s time zone', async () => {
  const { pc, sh, done } = setup();
  try {
    const t = pc.createTeam({ human: 10 }, { name: 'Ops', brief: 'Keep the office running.' });
    pc.setMember({ human: 10 }, t.id, 1, 'lead'); pc.setMember({ human: 10 }, t.id, 2, 'member'); pc.setMember({ human: 10 }, t.id, 3, 'viewer');
    const reva = sh({ agent: 1 }), mo = sh({ agent: 2 });
    let r = await reva.run('task add "Write the weekly report" --to Mo --due "fri 5pm" --on /teams/ops');
    assert.match(r.text, /^added #(\d+) \[To do\] Write the weekly report - Mo · due Fri, Oct 23, 17:00 to the ops team's board$/);
    const id = /#(\d+)/.exec(r.text)[1];
    r = await reva.run('task add Something --to Kit --on /teams/ops');
    assert.match(r.text, /Kit only views this team/);
    r = await reva.run('task add Something --to Zed --on /teams/ops');
    assert.match(r.text, /There is no agent called "Zed" here/);
    r = await mo.run('tasks');
    assert.match(r.text, new RegExp(`#${id} \\[To do\\] Write the weekly report · due Fri, Oct 23, 17:00 · the ops team's board`));
    r = await mo.run(`task ${id} start\ntask ${id} note "Draft in /teams/ops/report.md"\ntask ${id} review`);
    assert.ok(r.results.every(x => x.ok), r.text);
    r = await reva.run(`task ${id}`);
    assert.match(r.text, /\[Review\].*\nmade by you .*\nnotes:\nDraft in/);
    r = await reva.run('tasks /teams/ops');
    assert.match(r.text, /^the ops team's board:\nTo do: -\nDoing: -\nReview \(1\):/);
    await reva.run('task add "Call the dentist" --due tomorrow');
    r = await reva.run('tasks');
    assert.match(r.text, /Call the dentist · due Mon, Oct 19 · your board/);
    r = await reva.run('cal add "Team call" tomorrow 3pm --for 30m --on /teams/ops\ncal add Dentist oct 20 9:30am --at "Main St"\ncal week');
    assert.ok(r.results.every(x => x.ok), r.text);
    assert.match(r.results[0].out, /the ops team's calendar: \[\d+\] Team call - Mon, Oct 19, 15:00 for 30 min/);
    assert.match(r.results[2].out, /Mon, Oct 19, 15:00–15:30 Team call · ops team\n\[\d+\] Tue, Oct 20, 09:30–10:30 Dentist at Main St/);
    r = await mo.run('cal tomorrow');
    assert.match(r.text, /Team call/, 'a teammate sees the team\'s calendar');
    const ev = /\[(\d+)\] Dentist/.exec(r.text) || /\[(\d+)\]/.exec((await reva.run('cal oct 20')).text);
    r = await reva.run(`cal move ${ev[1]} oct 21 9am`);
    assert.match(r.text, /is now Wed, Oct 21, 09:00/);
    r = await reva.run('cal add "x" whenever');
    assert.match(r.text, /^error: usage: cal add/);
    r = await reva.run('team');
    assert.match(r.text, /^Ops - folder \/teams\/ops, you are lead\n {2}co-workers: Mo \(member\), Kit \(viewer\)\n {2}brief: Keep the office running\./);
    r = await reva.run('whoami');
    assert.match(r.text, /^You are Reva \(Front desk\), on your own PC, in ~\.\nNow: Sun, Oct 18, 12:00 \(America\/New_York\)\.\nTeams: ops \(lead\)\./);
  } finally { done(); }
});

test('a visitor reads Public only; help and the menu', async () => {
  const { pc, sh, done } = setup();
  try {
    pc.write({ agent: 1 }, '~/Public/menu.md', 'Coffee $3');
    pc.write({ agent: 1 }, '~/Documents/x.md', 'secret');
    const v = sh({ visitor: 1 });
    assert.equal((await v.run('read ~/Public/menu.md')).results[0].ok, true);
    assert.match((await v.run('read ~/Documents/x.md')).text, /^error: No such file/);
    assert.match((await v.run('write ~/Public/menu.md "free"')).text, /only your Public folder can be read/);
    assert.match((await v.run('ls ~')).text, /Public\//);
    assert.match((await v.run('tasks')).text, /only your Public folder/);
    const s = sh({ agent: 1 });
    assert.match((await s.run('help')).text, /^PC COMMANDS/);
    assert.match((await s.run('help write')).text, /^write <file> \(\+text\)\nmake or replace/);
    assert.match((await s.run('search cats')).text, /this PC has no browser/);
    assert.match(PcShell.menu({ browser: true }), /browser: search <words>/);
  } finally { done(); }
});
