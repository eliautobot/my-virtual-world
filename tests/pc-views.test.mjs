// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What an agent's PC screen shows (server/pc/views.js, docs/features/agent-pc.md §2.1): after each command, the window
// it has open - the file it wrote with the lines it changed marked (written, appended, edited), the part it reads, the
// folder with what it made marked, its search, the board with the task it touched, its week with the event, its
// terminal with the commands and what they said - kept small, sent to its owner's account alone, never for a visitor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PcOS, HOLD_MS } from '../server/pc/os.js';
import { PcShell } from '../server/pc/shell.js';
import { capView } from '../server/pc/views.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-pcview-'));
  const rows = [{ id: 1, name: 'Reva', role: 'Front desk', ownerId: 10 }, { id: 2, name: 'Mo', ownerId: 10 }, { id: 4, name: 'Zed', ownerId: 20 }];
  const agents = { list: () => rows, get: id => rows.find(a => a.id === Number(id)) || null };
  let now = Date.parse('2026-10-18T16:00:00Z');
  const frames = [];
  const pc = new PcOS({ dir, agents, ownerAccount: () => 10, now: () => now, emit: (acc, f) => frames.push({ acc, ...f }) });
  const names = (tag, me) => (tag === me ? 'you' : tag.startsWith('a:') ? rows.find(a => a.id === Number(tag.slice(2)))?.name || 'someone' : 'your owner');
  const sh = (who, o = {}) => new PcShell(pc, { who, tz: 'America/New_York', names, now: () => now, ...o });
  const view = id => pc.screenOf(id)?.view;
  return { pc, sh, frames, view, later: ms => { now += ms; }, done: () => { pc.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('a file: written (all of it marked), appended (the new lines), edited (the changed lines), read (from its line)', async () => {
  const { sh, view, done } = setup();
  try {
    const r = sh({ agent: 1 });
    await r.run('write ~/Documents/plan.md', { text: '# Plan\n\nMonday: calls\nTuesday: invoices\nWednesday: review' });
    let v = view(1);
    assert.equal(v.kind, 'file'); assert.equal(v.path, '~/Documents/plan.md'); assert.equal(v.mode, 'write');
    assert.deepEqual(v.lines, ['# Plan', '', 'Monday: calls', 'Tuesday: invoices', 'Wednesday: review']);
    assert.deepEqual(v.hl, [1, 5], 'all of it, just written');
    await r.run('append ~/Documents/plan.md', { text: '\nThursday: the team call\nFriday: off' });
    v = view(1);
    assert.equal(v.mode, 'append');
    assert.deepEqual(v.lines.slice(v.hl[0] - v.first, v.hl[1] - v.first + 1), ['Thursday: the team call', 'Friday: off']);
    await r.run('edit ~/Documents/plan.md', { find: 'Tuesday: invoices', replace: 'Tuesday: invoices and quotes' });
    v = view(1);
    assert.equal(v.mode, 'edit'); assert.equal(v.lines[v.hl[0] - v.first], 'Tuesday: invoices and quotes');
    const long = Array.from({ length: 120 }, (_, k) => `line ${k + 1}`).join('\n');
    await r.run('write ~/Documents/long.txt', { text: long });
    await r.run('read ~/Documents/long.txt 80');
    v = view(1);
    assert.equal(v.mode, 'read'); assert.equal(v.first, 80); assert.equal(v.lines[0], 'line 80'); assert.equal(v.total, 120);
    assert.ok(v.lines.length <= 40, 'a window of lines, not the whole file');
  } finally { done(); }
});

test('folders, search, board, calendar, terminal - each command leaves its window', async () => {
  const { sh, view, later, done } = setup();
  try {
    const r = sh({ agent: 1 });
    await r.run('mkdir ~/Documents/Clients');
    let v = view(1);
    assert.equal(v.kind, 'folder'); assert.equal(v.path, '~/Documents'); assert.equal(v.mark, 'Clients');
    assert.ok(v.entries.some(e => e.name === 'Clients' && e.dir));
    await r.run('write ~/Documents/Clients/lee.md', { text: 'Mrs Lee: call back about the quote' });
    await r.run('find quote');
    v = view(1);
    assert.equal(v.kind, 'find'); assert.equal(v.results[0].path, '~/Documents/Clients/lee.md');
    await r.run('task add "Call Mrs Lee" --due tomorrow 9am');
    v = view(1);
    assert.equal(v.kind, 'board'); assert.equal(v.board, '~');
    const card = v.cards.find(k => k.title === 'Call Mrs Lee');
    assert.ok(card && v.mark === card.id, 'the task just added, marked');
    await r.run(`task ${card.id} doing`);
    assert.equal(view(1).cards.find(k => k.id === card.id).col, 'doing');
    await r.run('cal add "Team call" tomorrow 3pm --for 30m');
    v = view(1);
    assert.equal(v.kind, 'calendar'); assert.equal(v.events[0].title, 'Team call'); assert.equal(v.mark, v.events[0].id); assert.equal(v.tz, 'America/New_York');
    // (a quick command right after: its week stays up - the command goes to its terminal; one a while later shows it)
    await r.run('whoami');
    assert.equal(view(1).kind, 'calendar', 'a command no app claims doesn\'t cover the window it works in');
    later(HOLD_MS + 1);
    await r.run('whoami');
    v = view(1);
    assert.equal(v.kind, 'terminal');
    assert.ok(v.lines.includes('$ whoami') && v.lines.includes('$ cal add "Team call" tomorrow 3pm --for 30m'), 'its commands, in order');
    assert.equal(v.lines.filter(l => l === '$ whoami').length, 2, 'the held one too');
    await r.run('read ~/nope.md');
    assert.ok(view(1).lines.some(l => /^error: /.test(l)), 'a command that failed: its error in the terminal');
  } finally { done(); }
});

test('only its owner\'s account hears it; a visitor\'s questions and the owner\'s own use leave no window', async () => {
  const { pc, sh, frames, view, done } = setup();
  try {
    await sh({ agent: 1 }).run('write ~/Public/hours.md', { text: 'Open 9 to 5' });
    const n = frames.filter(f => f.kind === 'screen').length;
    assert.ok(frames.filter(f => f.kind === 'screen').every(f => f.acc === 10 && f.screen.agent === 1));
    await sh({ visitor: 1 }).run('read ~/Public/hours.md');
    await sh({ human: 10, profile: 1 }).run('ls ~');
    assert.equal(frames.filter(f => f.kind === 'screen').length, n, 'no screen for a visitor\'s or the owner\'s own commands');
    assert.equal(view(1).path, '~/Public/hours.md');
    assert.equal(pc.screenOf(4), null);
  } finally { done(); }
});

test('a picture opened (read, or open ~/…) is on its screen, and the agent is told what it is', async () => {
  const { pc, sh, view, done } = setup();
  try {
    // a 3×2 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEklEQVR4nGP4z8DAwMDAgAEAH/gD/QAAAABJRU5ErkJggg==', 'base64');
    pc.write({ agent: 1 }, '~/Downloads/chart.png', png, { mime: 'image/png' });
    const r = sh({ agent: 1 });
    let out = await r.run('read ~/Downloads/chart.png');
    assert.match(out.text, /a picture \(PNG, 3×2, .*\), open on your screen/);
    assert.equal(view(1).kind, 'image'); assert.equal(view(1).path, '~/Downloads/chart.png');
    await r.run('write ~/Documents/plan.md', { text: '# Plan' });
    out = await r.run('open ~/Documents/plan.md');
    assert.match(out.text, /^~\/Documents\/plan\.md - 1 line/);
    assert.equal(view(1).kind, 'file'); assert.equal(view(1).mode, 'read');
    out = await r.run('open ~/Downloads/chart.png');
    assert.equal(view(1).kind, 'image');
    assert.match((await r.run('read ~/Documents')).text, /is a folder: ls/);
  } finally { done(); }
});

test('a window is kept small', () => {
  const big = { kind: 'file', path: '~/x', lines: Array.from({ length: 40 }, () => 'x'.repeat(180)) };
  const v = capView(big);
  assert.ok(JSON.stringify(v).length <= 6000);
  assert.ok(v.lines.length >= 4 && v.lines.length < 40);
});
