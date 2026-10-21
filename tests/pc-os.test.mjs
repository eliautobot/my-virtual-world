// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The agents' PC engine (docs/features/agent-pc.md): homes and teams, who reaches what (never another account, never
// another agent's home, a viewer reads only, a visitor only Public), paths that can't leave their space, files with
// versions, the trash, the storage pool, contents stored once, search, boards, calendars and the upkeep.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PcOS, splitPath, checkName } from '../server/pc/os.js';

function fakeAgents(list) {
  const rows = list.map(a => ({ deleted: undefined, ...a }));
  return { rows, list: () => rows, get: id => rows.find(a => a.id === Number(id)) || null };
}
function make({ limits = {}, agents = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-pc-'));
  const ag = agents || fakeAgents([
    { id: 1, name: 'Reva', ownerId: 10 }, { id: 2, name: 'Mo', ownerId: 10 }, { id: 3, name: 'Kit', ownerId: 10 },
    { id: 4, name: 'Zed', ownerId: 20 },
  ]);
  const frames = [];
  let t = Date.parse('2026-10-18T12:00:00Z');
  const pc = new PcOS({ dir, agents: ag, ownerAccount: () => 10, limits: () => limits, emit: (acc, f) => frames.push({ acc, ...f }), now: () => t });
  return { pc, dir, frames, ag, tick: ms => { t += ms; }, done: () => { pc.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const A = { agent: 1 }, B = { agent: 2 }, C = { agent: 3 }, Z = { agent: 4 }, H = { human: 10 }, H2 = { human: 20 };

test('paths never leave their space; names are checked', () => {
  assert.deepEqual(splitPath('a/./b/../c'), ['a', 'c']);
  assert.deepEqual(splitPath('../../../etc/passwd'), ['etc', 'passwd']);
  assert.deepEqual(splitPath('//x///y/'), ['x', 'y']);
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'x'.repeat(121)]) assert.throws(() => checkName(bad), { code: 'bad_name' });
  assert.equal(checkName('  Plan\u0007 2026.md '), 'Plan 2026.md');
  const { pc, done } = make();
  try {
    pc.write(A, '~/notes.md', 'hi');
    // '..' stops at the PC's top (/): never another home, never a place on disk
    assert.throws(() => pc.readText(A, '~/../../../notes.md'), { code: 'not_found' });
    assert.equal(pc.readText(A, '~/../../home/./notes.md').text, 'hi');
    assert.equal(pc.readText(A, '/home/../home/notes.md').text, 'hi');
    assert.throws(() => pc.readText(A, '/etc/passwd'), { code: 'not_found' });
    assert.throws(() => pc.readText(A, '../../../../etc/passwd'), { code: 'not_found' });
    assert.throws(() => pc.write(A, '~/a/b\\c', 'x'), { code: 'bad_name' });
  } finally { done(); }
});

test('a home is made on first use with its four folders; ls, write, read, mkdir, did-you-mean', () => {
  const { pc, done } = make();
  try {
    assert.deepEqual(pc.list(A, '~').entries.map(e => e.name), ['Documents', 'Downloads', 'Public', 'Skills']);
    const w = pc.write(A, '~/Documents/Reports/q3.md', '# Q3\nSales up.');
    assert.equal(w.created, true);
    assert.equal(w.info.path, '~/Documents/Reports/q3.md');
    assert.equal(pc.readText(A, 'Documents/Reports/q3.md').text, '# Q3\nSales up.');
    assert.equal(pc.readText(A, 'q3.md', { cwd: '~/Documents/Reports' }).text, '# Q3\nSales up.');
    assert.throws(() => pc.readText(A, '~/Documents/Reports/q4.md'), e => e.code === 'not_found' && /Did you mean ~\/Documents\/Reports\/q3\.md/.test(e.message));
    assert.throws(() => pc.list(A, '~/Documnts'), e => /Did you mean ~\/Documents/.test(e.message));
    assert.equal(pc.mkdir(A, '~/Documents/Reports').existed, true);
    assert.throws(() => pc.write(A, '~/Documents/Reports/q3.md/x', 'no'), { code: 'not_folder' });
    assert.deepEqual(pc.list(A, '/').entries.map(e => e.name), ['home', 'teams']);
    assert.throws(() => pc.remove(A, '~/Documents'), { code: 'system' });
    assert.throws(() => pc.move(A, '~/Skills', '~/Documents'), { code: 'system' });
    // same name in another case is the same file
    pc.write(A, '~/Documents/README.md', 'one');
    assert.equal(pc.readText(A, '~/documents/readme.md').text, 'one');
  } finally { done(); }
});

test('no other account, and no other agent\'s home, can be reached - not even named', () => {
  const { pc, done } = make();
  try {
    pc.write(A, '~/secret.md', 'mine');
    pc.write(Z, '~/secret.md', 'zed');
    assert.throws(() => pc.readText(B, '~/secret.md'), { code: 'not_found' });
    assert.equal(pc.readText(H, '~/secret.md', { profile: 1 }).text, 'mine');
    assert.throws(() => pc.readText(H, '~/secret.md', { profile: 4 }), { code: 'not_found' }, 'a person never opens another account\'s agent');
    assert.throws(() => pc.list(H2, '~', { profile: 1 }), { code: 'not_found' });
    const homeA = pc.home(1).id;
    assert.throws(() => pc.list(H2, '/', { space: homeA }), { code: 'not_found' }, 'nor by its space id');
    assert.throws(() => pc.readText({ human: 20 }, '/secret.md', { space: homeA }), { code: 'not_found' });
    assert.equal(pc.find(H2, 'mine').results.length, 0);
    assert.equal(pc.find(Z, 'mine').results.length, 0);
    assert.equal(pc.find(B, 'mine').results.length, 0);
    assert.ok(pc.find(A, 'mine').results.length >= 1);
    assert.throws(() => pc.caller({ agent: 999 }), { code: 'not_found' });
  } finally { done(); }
});

test('teams: members share the team folder, a viewer only reads, others never see it; deleting waits', () => {
  const { pc, done, tick } = make();
  try {
    assert.throws(() => pc.createTeam(A, { name: 'Sales' }), { code: 'people_only' });
    const t = pc.createTeam(H, { name: 'Sales & Marketing', brief: 'Sell more.' });
    assert.equal(t.slug, 'sales-marketing');
    assert.throws(() => pc.createTeam(H, { name: 'sales  marketing' }), { code: 'exists' });
    pc.setMember(H, t.id, 1, 'lead'); pc.setMember(H, t.id, 2, 'member'); pc.setMember(H, t.id, 3, 'viewer');
    assert.throws(() => pc.setMember(H, t.id, 4, 'member'), { code: 'not_found' }, 'an agent of another account never joins');
    assert.throws(() => pc.setMember(H2, t.id, 4, 'member'), { code: 'not_found' });
    pc.write(A, '/teams/sales-marketing/plan.md', 'the plan');
    assert.equal(pc.readText(B, '/teams/Sales-Marketing/plan.md').text, 'the plan');
    assert.equal(pc.readText(C, '/teams/sales-marketing/plan.md').text, 'the plan');
    assert.throws(() => pc.write(C, '/teams/sales-marketing/plan.md', 'x'), { code: 'read_only' });
    assert.throws(() => pc.readText(Z, '/teams/sales-marketing/plan.md'), { code: 'not_found' });
    assert.equal(pc.list(A, '/teams').entries[0].name, 'sales-marketing');
    // members never see each other's homes
    pc.write(B, '~/mine.md', 'b only');
    assert.throws(() => pc.readText(A, '~/mine.md'), { code: 'not_found' });
    // copy from home into the team shares the content (one copy stored)
    pc.write(B, '~/Documents/deck.md', 'deck '.repeat(50));
    pc.copy(B, '~/Documents/deck.md', '/teams/sales-marketing/');
    assert.equal(pc.readText(A, '/teams/sales-marketing/deck.md').text, 'deck '.repeat(50));
    const sha = pc.db.prepare("SELECT blob FROM nodes WHERE name = 'deck.md'").all().map(r => r.blob);
    assert.equal(new Set(sha).size, 1);
    assert.equal(pc.db.prepare('SELECT refs FROM blobs WHERE sha = ?').get(sha[0]).refs, 2);
    // move a team file into a home: the bytes move from the team's space to the agent's
    const before = pc.usage(10);
    pc.move(A, '/teams/sales-marketing/plan.md', '~/Documents/');
    assert.equal(pc.readText(A, '~/Documents/plan.md').text, 'the plan');
    assert.throws(() => pc.readText(B, '/teams/sales-marketing/plan.md'), { code: 'not_found' });
    assert.equal(pc.usage(10).used, before.used);
    // removing a member: out at once
    pc.setMember(H, t.id, 2, null);
    assert.throws(() => pc.readText(B, '/teams/sales-marketing/deck.md'), { code: 'not_found' });
    assert.equal(pc.readText(A, '/teams/sales-marketing/deck.md').text.length, 250, 'the file it made stays with the team');
    // a deleted team waits keepDays, then goes
    pc.deleteTeam(H, t.id);
    assert.throws(() => pc.readText(A, '/teams/sales-marketing/deck.md'), { code: 'not_found' });
    assert.equal(pc.goneTeams(H).length, 1);
    const back = pc.restoreTeam(H, t.id);
    assert.equal(pc.readText(A, `/teams/${back.slug}/deck.md`).text.length, 250);
    pc.deleteTeam(H, t.id);
    tick(31 * 86400000);
    const g = pc.gc();
    assert.ok(g.spaces >= 1);
    assert.equal(pc.goneTeams(H).length, 0);
    assert.equal(pc.db.prepare('SELECT refs FROM blobs WHERE sha = ?').get(sha[0]).refs, 1, 'only B\'s own copy still points at it');
  } finally { done(); }
});

test('a visitor reaches only its Public folder, to read', () => {
  const { pc, done } = make();
  try {
    pc.write(A, '~/Public/menu.md', 'Coffee $3');
    pc.write(A, '~/Documents/private.md', 'Coffee secrets');
    const V = { visitor: 1 };
    assert.equal(pc.readText(V, '~/Public/menu.md').text, 'Coffee $3');
    assert.throws(() => pc.readText(V, '~/Documents/private.md'), { code: 'not_found' });
    assert.throws(() => pc.write(V, '~/Public/menu.md', 'free'), { code: 'read_only' });
    assert.deepEqual(pc.list(V, '~').entries.map(e => e.name), ['Public']);
    assert.deepEqual(pc.find(V, 'coffee').results.map(r => r.path), ['~/Public/menu.md']);
    assert.throws(() => pc.list(V, '/teams'), { code: 'not_found' });
    assert.throws(() => pc.board(V, '~'), { code: 'not_found' });
    assert.deepEqual(pc.events(V, 0, 86400000).events, []);
  } finally { done(); }
});

test('versions, conflicts, edit, append, revert', () => {
  const { pc, done, tick } = make();
  try {
    pc.write(A, '~/a.md', 'one');
    tick(1000);
    const r2 = pc.write(A, '~/a.md', 'two');
    assert.equal(r2.info.version, 2);
    assert.equal(pc.write(A, '~/a.md', 'two').same, true, 'the same content is no new version');
    assert.throws(() => pc.write(A, '~/a.md', 'three', { expect: 1 }), { code: 'changed' });
    // someone else's file: read it first (or force)
    pc.write(H, '~/a.md', 'from the owner', { profile: 1 });
    assert.throws(() => pc.write(A, '~/a.md', 'mine now'), { code: 'not_read' });
    pc.edit(A, '~/a.md', 'the owner', 'Sam');
    assert.equal(pc.readText(A, '~/a.md').text, 'from Sam');
    assert.throws(() => pc.edit(A, '~/a.md', 'nowhere', 'x'), { code: 'no_match' });
    pc.write(A, '~/b.md', 'x y x');
    assert.throws(() => pc.edit(A, '~/b.md', 'x', 'z'), { code: 'many' });
    assert.equal(pc.edit(A, '~/b.md', 'x', 'z', { all: true }).replaced, 2);
    pc.append(A, '~/log.md', 'first');
    pc.append(A, '~/log.md', 'second');
    assert.equal(pc.readText(A, '~/log.md').text, 'first\nsecond');
    const v = pc.versions(A, '~/a.md');
    assert.deepEqual(v.older.map(x => x.version), [3, 2, 1]);
    pc.revert(A, '~/a.md', 1);
    assert.equal(pc.readText(A, '~/a.md').text, 'one');
    assert.equal(pc.versions(A, '~/a.md').current.version, 5);
  } finally { done(); }
});

test('the storage pool: per agent and team, the trash and versions do not count, nothing is lost when full', () => {
  const { pc, done } = make({ limits: { agentMB: 0.01, teamMB: 0.01, fileMB: 0.02 } });   // ≈ 10 KB an agent, 3 agents + a team
  try {
    const u0 = pc.usage(10);
    assert.equal(u0.limit, Math.round(0.03 * 1048576));
    pc.write(A, '~/big.bin', Buffer.alloc(9000, 1));
    pc.write(B, '~/big.bin', Buffer.alloc(9000, 2));
    pc.write(C, '~/big.bin', Buffer.alloc(9000, 3));
    assert.throws(() => pc.write(A, '~/more.bin', Buffer.alloc(9000, 4)), { code: 'full' });
    assert.throws(() => pc.readText(A, '~/more.bin'), { code: 'not_found' }, 'nothing was saved');
    assert.throws(() => pc.write(A, '~/huge.bin', Buffer.alloc(30000)), { code: 'too_large' });
    pc.remove(A, '~/big.bin');
    pc.write(A, '~/more.bin', Buffer.alloc(9000, 4));
    assert.throws(() => pc.restore(A, pc.trashList(A).items[0].id), { code: 'full' });
    for (const r of pc.recount()) assert.equal(r.used, r.counted);
    // a team adds its own room
    pc.createTeam(H, { name: 'Ops' });
    assert.equal(pc.usage(10).limit, Math.round(0.04 * 1048576));
    assert.equal(pc.usage(20).limit, Math.round(0.01 * 1048576), 'another account has its own pool');
  } finally { done(); }
});

test('contents are stored once, compressed, big ones in the file store, and swept when unused', () => {
  const { pc, dir, done, tick } = make();
  try {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(4000);   // ≈ 180 KB of text: to the file store, compressed
    pc.write(A, '~/fox.txt', text);
    pc.write(B, '~/fox-copy.txt', text);
    const row = pc.db.prepare('SELECT * FROM blobs').all().find(b => b.size === Buffer.byteLength(text));
    assert.equal(row.stored, 'disk'); assert.equal(row.codec, 'zstd'); assert.equal(row.refs, 2);
    const onDisk = fs.statSync(path.join(dir, 'blobs', row.sha.slice(0, 2), row.sha)).size;
    assert.ok(onDisk < 4000, `compressed on disk (${onDisk} bytes)`);
    assert.equal(pc.readText(B, '~/fox-copy.txt').text, text);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200000, 7)]);
    pc.write(A, '~/pic.png', png);
    assert.equal(pc.db.prepare('SELECT codec FROM blobs WHERE size = ?').get(png.length).codec, 'none', 'pictures are kept as they are');
    assert.ok(pc.readFile(A, '~/pic.png').buf.equals(png));
    pc.remove(A, '~/fox.txt'); pc.remove(B, '~/fox-copy.txt');
    pc.emptyTrash(A); pc.emptyTrash(B);
    const g = pc.gc();
    assert.ok(g.blobs >= 1);
    assert.equal(fs.existsSync(path.join(dir, 'blobs', row.sha.slice(0, 2), row.sha)), false);
    // the trash empties itself after keepDays
    pc.write(A, '~/old.md', 'old');
    pc.remove(A, '~/old.md');
    tick(31 * 86400000);
    assert.ok(pc.gc().trash >= 1);
    assert.equal(pc.trashList(A).items.length, 0);
  } finally { done(); }
});

test('trash and restore: back where it was, a taken name gets "(restored)"', () => {
  const { pc, done } = make();
  try {
    pc.write(A, '~/Documents/x/plan.md', 'v1');
    pc.remove(A, '~/Documents/x');
    assert.throws(() => pc.readText(A, '~/Documents/x/plan.md'), { code: 'not_found' });
    assert.equal(pc.find(A, 'v1').results.length, 0, 'the trash is not searched');
    pc.mkdir(A, '~/Documents/x');
    const item = pc.trashList(A).items[0];
    assert.equal(item.path, '~/Documents/x');
    const r = pc.restore(A, item.id);
    assert.equal(r.info.path, '~/Documents/x (restored)');
    assert.equal(pc.readText(A, '~/Documents/x (restored)/plan.md').text, 'v1');
    assert.equal(pc.find(A, 'plan').results[0].path, '~/Documents/x (restored)/plan.md');
    assert.throws(() => pc.restore(B, item.id), { code: 'not_found' });
  } finally { done(); }
});

test('search finds words in files and names, only where the caller reaches', () => {
  const { pc, done } = make();
  try {
    pc.write(A, '~/Documents/invoice-march.md', 'Total due: 4,200 dollars for the dental cleaning');
    pc.write(A, '~/Documents/notes.txt', 'Dentists prefer mornings');
    pc.write(B, '~/Documents/b.md', 'dental');
    const r = pc.find(A, 'dental');
    assert.deepEqual(r.results.map(x => x.path), ['~/Documents/invoice-march.md']);
    assert.match(r.results[0].snippet, /dental cleaning/);
    assert.deepEqual(pc.find(A, 'invoice').results.map(x => x.path), ['~/Documents/invoice-march.md']);
    assert.equal(pc.find(A, 'dent').results.length, 2, 'words are matched by their start');
    assert.deepEqual(pc.find(A, 'dental', { in: '~/Downloads' }).results, []);
    assert.equal(pc.find(H, 'dental').results.length, 2, 'the owner finds across their agents');
    assert.equal(pc.find(H, 'dental', { profile: 2 }).results.length, 1);
  } finally { done(); }
});

test('boards: tasks on an agent\'s own board and a team\'s; who may be given a task', () => {
  const { pc, done } = make();
  try {
    const t = pc.createTeam(H, { name: 'Ops' });
    pc.setMember(H, t.id, 1, 'lead'); pc.setMember(H, t.id, 2, 'member'); pc.setMember(H, t.id, 3, 'viewer');
    const k = pc.addCard(A, '/teams/ops', { title: 'Write the weekly report', assignee: 2 });
    assert.equal(k.assignee, 2);
    assert.throws(() => pc.addCard(A, '/teams/ops', { title: 'x', assignee: 3 }), { code: 'viewer' });
    assert.throws(() => pc.addCard(A, '/teams/ops', { title: 'x', assignee: 4 }), { code: 'not_found' });
    assert.throws(() => pc.addCard(C, '/teams/ops', { title: 'x' }), { code: 'read_only' });
    assert.deepEqual(pc.myTasks(B).map(x => x.id), [k.id]);
    const moved = pc.updateCard(B, k.id, { col: 'doing', addNote: 'Started' });
    assert.equal(moved.col, 'doing'); assert.equal(moved.notes, 'Started');
    pc.updateCard(B, k.id, { col: 'done' });
    assert.equal(pc.myTasks(B).length, 0);
    assert.throws(() => pc.updateCard(Z, k.id, { col: 'todo' }), { code: 'not_found' });
    assert.throws(() => pc.card(H2, k.id), { code: 'not_found' });
    const own = pc.addCard(B, '~', { title: 'Call the dentist' });
    assert.equal(own.assignee, 2, 'its own board: its own task');
    assert.throws(() => pc.addCard(B, '~', { title: 'x', assignee: 1 }), { code: 'not_member' });
    const b = pc.board(H, '/teams/ops', { profile: 1 });
    assert.equal(b.cards.length, 1);
    assert.equal(pc.board(H, '/', { space: pc.teamSpace(t.id).id }).cards.length, 1);
  } finally { done(); }
});

test('calendars: events in a range, on its own and its teams\' calendars', () => {
  const { pc, done } = make();
  try {
    const t = pc.createTeam(H, { name: 'Ops' });
    pc.setMember(H, t.id, 1, 'member');
    const day = Date.parse('2026-10-20T00:00:00Z');
    const e = pc.addEvent(A, '~', { title: 'Dentist', start: day + 9 * 3600000, end: day + 10 * 3600000 });
    pc.addEvent(A, '/teams/ops', { title: 'Standup', start: day + 15 * 3600000 });
    assert.deepEqual(pc.events(A, day, day + 86400000).events.map(x => x.title), ['Dentist', 'Standup']);
    assert.equal(pc.events(B, day, day + 86400000).events.length, 0);
    const moved = pc.updateEvent(A, e.id, { start: day + 11 * 3600000 });
    assert.equal(moved.end - moved.start, 3600000, 'moving keeps its length');
    assert.throws(() => pc.addEvent(A, '~', { title: 'x', start: day, end: day - 1 }), { code: 'bad_time' });
    assert.throws(() => pc.removeEvent(Z, e.id), { code: 'not_found' });
    pc.removeEvent(A, e.id);
    assert.equal(pc.events(A, day, day + 86400000).events.length, 1);
  } finally { done(); }
});

test('live frames and activity go to the owning account only', () => {
  const { pc, frames, done } = make();
  try {
    pc.write(A, '~/x.md', 'x');
    pc.write(Z, '~/x.md', 'z');
    assert.ok(frames.filter(f => f.acc === 10).every(f => f.kind !== 'activity' || f.item.agent !== 4));
    assert.ok(frames.filter(f => f.acc === 20).every(f => f.kind !== 'activity' || f.item.agent === 4));
    assert.equal(pc.activity(H)[0].what, 'Created ~/x.md');
    assert.throws(() => pc.activity(H2, { agent: 1 }), { code: 'not_found' });
    assert.equal(pc.screenOf(1).app, 'files');
  } finally { done(); }
});

test('an agent that changes hands takes its home and leaves the old account\'s teams; a deleted agent\'s home goes after keepDays', () => {
  const ag = fakeAgents([{ id: 1, name: 'Reva', ownerId: 10 }, { id: 2, name: 'Mo', ownerId: 10 }]);
  const { pc, done, tick } = make({ agents: ag });
  try {
    const t = pc.createTeam(H, { name: 'Ops' });
    pc.setMember(H, t.id, 1, 'member');
    pc.write(A, '~/mine.md', 'mine');
    ag.rows[0].ownerId = 20;
    assert.throws(() => pc.readText(H, '~/mine.md', { profile: 1 }), { code: 'not_found' });
    assert.equal(pc.readText(H2, '~/mine.md', { profile: 1 }).text, 'mine');
    assert.equal(pc.teamsOf(A).length, 0);
    ag.rows.splice(1, 1);   // Mo is deleted
    pc.write(H2, '~/x.md', 'x', { profile: 1 });
    pc.gc();
    tick(31 * 86400000);
    pc.gc();
    assert.equal(pc.db.prepare("SELECT COUNT(*) AS n FROM spaces WHERE kind = 'agent' AND ref = 2").get().n, 0);
  } finally { done(); }
});
