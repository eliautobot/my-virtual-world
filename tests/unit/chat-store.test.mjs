// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat stores (server/chat/*, PLAN WP2.2; DECISIONS C53, C119, C121; CHECKLIST X11): the transcript mirror, sessions private to an
// account and an agent, references shared per agent, and attachments stored by content hash with type and size limits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { Attachments, AttachmentError, typeOf } from '../../server/chat/attachments.js';
import { References } from '../../server/chat/references.js';
import { Sessions, LAZY_KEY } from '../../server/chat/sessions.js';
import { Transcripts, mergeHistory } from '../../server/chat/transcript.js';
import { openDb } from '../../server/db.js';
import { tempDir } from '../helpers/server.mjs';

test('the transcript is kept per account, agent and session, with ids, meta and a cap (schema 27)', () => {
  const dbs = openDb(tempDir('mvw-tr-')), t = new Transcripts(dbs, { now: () => 1000 });
  dbs.db.prepare("INSERT INTO chat_sessions (id, world_id, agent_id, account_id, native_key, label, created, updated) VALUES (3, ?, 2, 1, '@new', 'x', 1, 1), (4, ?, 2, 1, '@new', 'y', 1, 1)").run(dbs.worldId, dbs.worldId);
  assert.deepEqual(t.read(1, 2, 3), []);
  const u = t.append(1, 2, 3, { role: 'user', text: 'hi', runId: 'r1', meta: { attachments: [{ id: 'a1', name: 'x.png' }] } });
  t.append(1, 2, 3, { role: 'assistant', text: 'hello', runId: 'r1', status: 'ok', meta: { model: 'm', tokensIn: 5 } });
  t.append(1, 2, 3, { role: 'bogus', text: 'x'.repeat(130000) });
  const list = t.read(1, 2, 3);
  assert.deepEqual(list.map(e => e.role), ['user', 'assistant', 'system']);
  assert.ok(Number.isInteger(u.id) && list[0].id === u.id, 'each message has an id');
  assert.deepEqual(list[0].meta, { attachments: [{ id: 'a1', name: 'x.png' }] }); assert.equal(list[1].meta.model, 'm');
  assert.equal(list[2].text.length, 100000, 'long text is cut');
  assert.deepEqual(t.read(9, 2, 3), [], 'another account reads nothing');
  assert.equal(t.get(9, 3, u.id), null, 'nor one message of it');
  for (const bad of [[0, 2, 3], [1, -1, 3], [1, 2, 1.5], ['../x', 2, 3]]) assert.throws(() => t.read(...bad), /bad transcript id/, 'ids are integers');
  assert.equal(t.update(1, 3, list[1].id, { text: 'hello again' }).text, 'hello again');
  assert.equal(t.truncateFrom(1, 3, list[1].id), 2, 'an answer and what came after it go');
  assert.deepEqual(t.read(1, 2, 3).map(e => e.text), ['hi']);
  t.remove(1, 2, 3); assert.deepEqual(t.read(1, 2, 3), []);
  for (let i = 0; i < 5050; i++) t.append(1, 2, 4, { role: 'user', text: String(i) });
  const capped = t.read(1, 2, 4); assert.equal(capped.length, 5000); assert.equal(capped[0].text, '50', 'the oldest go first');
});

test('an account\'s chats are searched by word prefix, only its own and only live sessions', () => {
  const dbs = openDb(tempDir('mvw-trs-')), t = new Transcripts(dbs, { now: () => 1000 }), s = new Sessions(dbs);
  const a = s.create(1, 7, null, 'Taxes'), b = s.create(1, 7, null, 'Gone'), c = s.create(2, 7, null, 'Other');
  t.append(1, 7, a.id, { role: 'user', text: 'How do quarterly estimated taxes work?' });
  t.append(1, 7, b.id, { role: 'user', text: 'quarterly report' });
  t.append(2, 7, c.id, { role: 'user', text: 'quarterly secrets' });
  s.remove(1, b.id);
  const r = t.search(1, 'Quarter tax');
  assert.equal(r.length, 1); assert.equal(r[0].session, a.id);
  assert.match(r[0].snippet, /\u0002quarterly\u0003/, 'the match is marked');
  assert.deepEqual(t.search(1, '"); DROP TABLE chat_messages; --'), [], 'what is typed is words, never a query');
  assert.deepEqual(t.search(1, '   '), []);
});

test('the old JSON transcript files are imported once and their folder set aside', () => {
  const dir = tempDir('mvw-tri-'), root = path.join(dir, 'chat');
  fs.mkdirSync(path.join(root, '1', '2'), { recursive: true });
  fs.writeFileSync(path.join(root, '1', '2', '5.json'), JSON.stringify([{ role: 'user', text: 'old hello', ts: 7 }, { role: 'assistant', text: 'old answer', ts: 8, status: 'ok' }]));
  fs.writeFileSync(path.join(root, '1', '2', 'junk.json'), 'not json');
  const dbs = openDb(dir), t = new Transcripts(dbs, { root });
  assert.deepEqual(t.read(1, 2, 5).map(e => `${e.role}:${e.text}:${e.ts}`), ['user:old hello:7', 'assistant:old answer:8']);
  assert.equal(fs.existsSync(root), false); assert.equal(fs.existsSync(`${root}.imported`), true);
  new Transcripts(dbs, { root });   // (again: nothing there, nothing doubled)
  assert.equal(t.read(1, 2, 5).length, 2);
});

test('history is the provider\'s export plus the mirror lines the provider does not have', () => {
  const merged = mergeHistory([{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { text: 7 }, null], [{ role: 'user', text: 'a', ts: 1 }, { role: 'assistant', text: 'c', ts: 2 }]);
  assert.deepEqual(merged.map(m => `${m.source}:${m.role}:${m.text}`), ['provider:user:a', 'provider:assistant:b', 'mirror:assistant:c']);
  assert.deepEqual(mergeHistory(null, null), []);
});

test('a session belongs to one account and one agent: others never find it; new never destroys, delete does (C119)', () => {
  const s = new Sessions(openDb(tempDir('mvw-ss-')));
  const a = s.create(1, 10, null, 'First'), b = s.create(1, 10, null, '  <b>Second</b> ');
  assert.equal(a.key, LAZY_KEY); assert.equal(b.label, 'bSecond/b');
  assert.deepEqual(s.list(1, 10).map(x => x.label).sort(), ['First', 'bSecond/b'], 'a new session leaves the old one');
  assert.equal(s.list(2, 10).length, 0, 'another account has none, even for the same agent');
  assert.equal(s.list(1, 11).length, 0, 'and another agent has none');
  assert.equal(s.get(2, a.id), null, 'not found, not forbidden'); assert.equal(s.rename(2, a.id, 'Hijack'), null); assert.equal(s.remove(2, a.id), null);
  s.setKey(a.id, 'native-1'); assert.equal(s.get(1, a.id).key, 'native-1');
  assert.equal(s.rename(1, a.id, 'Renamed').label, 'Renamed'); assert.equal(s.rename(1, a.id, '   ').label, 'Renamed', 'a blank name keeps the old one');
  assert.equal(s.remove(1, a.id).id, a.id);
  assert.equal(s.get(1, a.id), null); assert.deepEqual(s.list(1, 10).map(x => x.id), [b.id]);
  assert.equal(s.ofAgent(10).length, 1);
});

test('references are notes or links, shared by everyone who may use the agent (C53)', () => {
  const r = new References(openDb(tempDir('mvw-rf-')));
  assert.equal(r.add(5, { kind: 'note', title: 'Style', text: 'Be brief' }, 1).reference.text, 'Be brief');
  assert.equal(r.add(5, { kind: 'link', title: 'Docs', url: 'https://example.com/a' }, 1).reference.url, 'https://example.com/a');
  assert.equal(r.add(5, { kind: 'link', title: 'x', url: 'javascript:alert(1)' }, 1).error, 'bad_url');
  assert.equal(r.add(5, { kind: 'link', title: 'x', url: 'nope' }, 1).error, 'bad_url');
  assert.equal(r.add(5, { kind: 'video' }, 1).error, 'bad_kind');
  assert.equal(r.add(5, { kind: 'note' }, 1).error, 'empty');
  assert.equal(r.list(5).length, 2); assert.equal(r.list(6).length, 0, 'per agent');
  const id = r.list(5)[0].id;
  assert.equal(r.remove(6, id), false, 'not through another agent'); assert.equal(r.remove(5, id), true); assert.equal(r.list(5).length, 1);
  r.removeAll(5); assert.equal(r.list(5).length, 0);
});

const MB = 1048576;
function attach(limits = { maxBytes: 1 * MB, quotaBytes: 3 * MB }) {
  const dbs = openDb(tempDir('mvw-at-')), root = tempDir('mvw-atf-');
  return { at: new Attachments(dbs, root, { limits: () => limits }), root, dbs };
}
const body = (n, fill = 65) => Readable.from([Buffer.alloc(n, fill)]);

test('the type comes from the file name, never from a claim; only images, PDF, office and text or code are accepted (C121)', () => {
  for (const [n, t] of [['a.PNG', 'image/png'], ['b.pdf', 'application/pdf'], ['c.docx', /wordprocessingml/], ['d.py', 'text/plain'], ['e.md', 'text/markdown']]) assert.match(typeOf(n), t instanceof RegExp ? t : new RegExp(`^${t}$`));
  for (const n of ['x.exe', 'y.svg', 'z.html.exe', 'noext', 'a.zip', 'evil.js.', '.env']) assert.equal(typeOf(n), null, n);
  const { at } = attach();
  assert.throws(() => at.precheck(1, 'x.exe'), e => e instanceof AttachmentError && e.status === 415 && e.code === 'type_not_allowed');
  assert.throws(() => at.precheck(1, '   '), e => e.code === 'bad_name');
  assert.equal(at.precheck(1, '../../etc/passwd.txt').name, 'passwd.txt', 'a path in the name is cut to the file name');
});

test('an upload is streamed with a running limit, stored once per account by hash, and is private to its account (C121, X11)', async () => {
  const { at, root } = attach();
  const a = await at.store(1, 'note.txt', body(1000), 1000);
  assert.equal(a.name, 'note.txt'); assert.equal(a.size, 1000); assert.equal(a.mime, 'text/plain');
  assert.equal(fs.readdirSync(path.join(root, '1')).filter(f => f.startsWith('.up-')).length, 0, 'no temp file left behind');
  const dup = await at.store(1, 'copy.txt', body(1000), 1000);
  assert.equal(dup.id, a.id); assert.equal(dup.duplicate, true); assert.equal(at.used(1), 1000, 'stored once');
  const other = await at.store(2, 'note.txt', body(1000), 1000);
  assert.notEqual(other.id, a.id, 'each account has its own copy'); assert.equal(at.used(2), 1000);
  assert.equal(at.get(2, a.id), null, 'not found through another account'); assert.equal(at.pathOf(2, a.id), null);
  assert.equal(at.pathOf(1, a.id).path, path.join(root, '1', fs.readdirSync(path.join(root, '1'))[0]));
  assert.equal(at.list(1).length, 1);
});

test('too large, over quota, empty and cut-off uploads are refused and leave nothing behind (C121)', async () => {
  const { at, root } = attach();
  await assert.rejects(() => at.store(1, 'big.txt', body(2 * MB)), e => e.status === 413 && e.code === 'file_too_large', 'stopped while streaming, not after');
  await assert.rejects(() => at.store(1, 'big.txt', body(10), 5 * MB), e => e.code === 'file_too_large', 'a declared size is refused before any bytes');
  await assert.rejects(() => at.store(1, 'e.txt', Readable.from([])), e => e.code === 'empty');
  assert.equal(fs.readdirSync(path.join(root, '1')).length, 0, 'nothing stored, no temp files');
  for (const n of [1, 2, 3]) await at.store(1, `f${n}.txt`, body(1 * MB - 100 + n, 65 + n));
  await assert.rejects(() => at.store(1, 'more.txt', body(200000, 90)), e => e.status === 413 && e.code === 'quota_exceeded');
  await assert.rejects(() => at.store(1, 'more2.txt', body(10), 500000), e => e.code === 'quota_exceeded', 'a declared size over the quota is refused up front');
  assert.equal(fs.readdirSync(path.join(root, '1')).filter(f => f.startsWith('.up-')).length, 0);
  assert.equal((await at.store(2, 'fine.txt', body(100))).size, 100, 'another account has its own quota');
});

test('the limits are read on every upload, so an admin\'s change applies at once', async () => {
  let limits = { maxBytes: 100, quotaBytes: 10 * MB };
  const { at } = attach(); at.limits = () => limits;
  await assert.rejects(() => at.store(1, 'a.txt', body(500)), e => e.code === 'file_too_large');
  limits = { maxBytes: 1000, quotaBytes: 10 * MB };
  assert.equal((await at.store(1, 'a.txt', body(500))).size, 500);
});
