// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a chat attachment says to the model (server/chat/extract.js) and how an owner's chat is put together and read
// back (server/mind/assistant.js; docs/features/CHAT.md §2, §4): Office and OpenDocument text from their ZIP archives
// with no library, bounded (a zip bomb stops at the limit); old binary formats and damaged files refused in plain
// words; the answer split from a tool request and from what the agent keeps; the conversation and its files bounded.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { test } from 'node:test';
import { extractText, kindOf, readZip, ExtractError } from '../../server/chat/extract.js';
import { StreamSplit, buildTurns, parseActions, ACTIONS_MARK, CONTEXT_CHARS } from '../../server/mind/assistant.js';
import { tempDir } from '../helpers/server.mjs';
import { zip, DOCX } from '../helpers/zip.mjs';

test('Word, Excel, PowerPoint and OpenDocument files read as text, in order, entities decoded', () => {
  const dir = tempDir('mvw-ex-'), put = (n, b) => { const p = path.join(dir, n); fs.writeFileSync(p, b); return p; };
  const d = extractText(put('r.docx', DOCX), 'r.docx');
  assert.match(d.text, /^Quarterly report\nRevenue\t12 & up\nA \| B \|/); assert.match(d.text, /Page footer/); assert.equal(d.truncated, false);
  const x = zip({ 'xl/workbook.xml': '<workbook><sheets><sheet name="Q1 &amp; Q2" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Total</t></si><si><r><t>Ann</t></r><r><t>ie</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>x</t></is></c><c r="C2"><v>42.5</v></c></row></sheetData></worksheet>' });
  assert.equal(extractText(put('b.xlsx', x), 'b.xlsx').text, '## Sheet: Q1 & Q2\nName\t\tTotal\nAnnie\tx\t42.5');
  const p = zip({ 'ppt/presentation.xml': '<p/>', 'ppt/slides/slide2.xml': '<a:p><a:r><a:t>Second</a:t></a:r></a:p>', 'ppt/slides/slide10.xml': '<a:p><a:r><a:t>Tenth</a:t></a:r></a:p>',
    'ppt/slides/slide1.xml': '<a:p><a:r><a:t>Title</a:t></a:r></a:p><a:p><a:r><a:t>Sub</a:t></a:r></a:p>', 'ppt/notesSlides/notesSlide1.xml': '<a:p><a:r><a:t>Say hello</a:t></a:r></a:p>' });
  assert.equal(extractText(put('s.pptx', p), 's.pptx').text, '## Slide 1\nTitle\nSub\nNotes: Say hello\n\n## Slide 2\nSecond\n\n## Slide 3\nTenth', 'slides in number order (10 after 2)');
  const o = zip({ 'content.xml': '<office:text><text:h>Heading</text:h><text:p>One<text:tab/>two<text:s text:c="3"/>three</text:p></office:text>' });
  assert.equal(extractText(put('n.odt', o), 'n.odt').text, 'Heading\nOne\ttwo   three');
  assert.equal(extractText(put('c.py', 'print("hi")\n'), 'c.py').text, 'print("hi")');
  const long = extractText(put('big.txt', 'x'.repeat(130000)), 'big.txt');
  assert.equal(long.truncated, true); assert.equal(long.text.length, 120000);
});

test('refused in plain words: old formats, damaged files, a binary file named .txt, and a zip bomb', () => {
  const dir = tempDir('mvw-ex2-'), put = (n, b) => { const p = path.join(dir, n); fs.writeFileSync(p, b); return p; };
  assert.deepEqual(kindOf('old.doc'), { kind: null, why: 'Old .doc files can\'t be read. Save it as .docx and attach it again.' });
  assert.deepEqual([kindOf('a.PNG').kind, kindOf('a.pdf').kind, kindOf('a.xlsx').kind, kindOf('a.exe').kind], ['image', 'pdf', 'text', null]);
  assert.throws(() => extractText(put('old.doc', 'x'), 'old.doc'), e => e instanceof ExtractError && /Save it as \.docx/.test(e.message));
  assert.throws(() => extractText(put('bad.docx', 'not a zip'), 'bad.docx'), e => e.code === 'bad_file');
  assert.throws(() => extractText(put('nodoc.docx', zip({ 'x.xml': '<x/>' })), 'nodoc.docx'), e => e.code === 'bad_file' && /not a Word/.test(e.message));
  assert.throws(() => extractText(put('bin.txt', Buffer.from([0x50, 0x00, 0x01])), 'bin.txt'), e => e.code === 'binary');
  // 40 MB of zeros deflates to ~40 KB; the size the archive claims is a lie (0): the inflate limit stops it all the same
  const bomb = zip({ 'word/document.xml': '\0'.repeat(40 * 1048576) });
  bomb.writeUInt32LE(0, bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
  const t0 = Date.now();
  assert.throws(() => extractText(put('bomb.docx', bomb), 'bomb.docx'), e => e.code === 'too_large');
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(readZip(zip({ a: 'A' })).get('a')().toString(), 'A');
});

test('the answer is shown as written; a tool request and what the agent keeps never are, even split across pieces', () => {
  const run = pieces => { let shown = ''; const s = new StreamSplit(t => { shown += t; }); for (const p of pieces) s.feed(p); const r = s.end(); return { shown, ...r }; };
  let r = run(['Sure', ' - here:\n\n```js\nx = {"use": 1}\n```\n', '[[mvw-', 'actions]]\n{"title":"Code"}']);
  assert.equal(r.shown.trimEnd(), 'Sure - here:\n\n```js\nx = {"use": 1}\n```'); assert.equal(r.reply, r.shown.trimEnd(), '(the final answer replaces what was shown: the same, trimmed)'); assert.equal(parseActions(r.actions).title, 'Code');
  r = run(['  ', '{ "u', 'se": [{"tool":"menu"}]}']);
  assert.equal(r.shown, ''); assert.deepEqual(JSON.parse(r.tool), { use: [{ tool: 'menu' }] });
  r = run(['{"name": "a JSON example the owner asked for"}']);
  assert.equal(r.shown, '{"name": "a JSON example the owner asked for"}');
  r = run(['A wiki [[link]] and a lone [', '[']);
  assert.equal(r.shown, 'A wiki [[link]] and a lone [[', 'a held-back tail that was not the marker is shown at the end');
  // cut short (stopped, or the stream broke) inside the marker: its start is neither shown nor kept
  const cut = pieces => { let shown = ''; const s = new StreamSplit(t => { shown += t; }); for (const p of pieces) s.feed(p); return { shown, ...s.end(undefined, { cut: true }) }; };
  r = cut(['All done.\n', '[[mvw-ac']);
  assert.deepEqual([r.shown, r.reply], ['All done.\n', 'All done.']);
  r = cut(['A wiki [[link]] then a cut']);
  assert.deepEqual([r.shown, r.reply], ['A wiki [[link]] then a cut', 'A wiki [[link]] then a cut'], 'a marker-like text inside the answer stays');
  assert.equal(run([]).reply, '');
  assert.equal(parseActions('```json\n{"memories":[]}\n```').memories.length, 0);
  assert.equal(parseActions('nonsense'), null);
  assert.equal(ACTIONS_MARK, '[[mvw-actions]]');
});

test('the conversation: newest first within its bounds, images for the newest messages that have them, documents as text', () => {
  const dir = tempDir('mvw-bt-'), file = (n, b) => { const p = path.join(dir, n); fs.writeFileSync(p, b); return { id: n, name: n, mime: n.endsWith('.png') ? 'image/png' : 'application/octet-stream', size: Buffer.byteLength(b), path: p }; };
  const img1 = file('one.png', 'PNG1'), img2 = file('two.png', 'PNG2'), img3 = file('three.png', 'PNG3'), doc = file('r.docx', DOCX);
  const h = [{ id: 1, role: 'assistant', text: 'Hi, how can I help?' }, { id: 2, role: 'user', text: 'first', files: [img1] }, { id: 3, role: 'assistant', text: 'A cat.' },
    { id: 4, role: 'user', text: 'and this', files: [img2, doc] }, { id: 5, role: 'assistant', text: 'A dog and a report.' }, { id: 6, role: 'user', text: 'now this', files: [img3] }];
  const { turns } = buildTurns(h);
  assert.equal(turns[0].role, 'user', 'a conversation starts with the person');
  assert.equal(turns[0].text, '[one.png: attached earlier]\n\nfirst', 'an older image is only named');
  assert.deepEqual(turns[2].parts.map(p => [p.name, Buffer.from(p.data, 'base64').toString()]), [['two.png', 'PNG2']]);
  assert.match(turns[2].text, /^ATTACHED FILE «r\.docx»:\n```\nQuarterly report/);
  assert.deepEqual(turns.at(-1).parts.map(p => p.name), ['three.png']); assert.equal(turns.at(-1).text, 'now this');
  // bounded: a long past is cut from the oldest end; the newest message always goes
  const big = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, role: i % 2 ? 'assistant' : 'user', text: `${i} ${'z'.repeat(10000)}` }));
  const cut = buildTurns(big).turns;
  assert.ok(cut.reduce((n, t) => n + t.text.length, 0) <= CONTEXT_CHARS + 10100 && cut.length < 40);
  assert.equal(cut.at(-1).text.startsWith('39 ') || cut.at(-1).text.startsWith('38 '), true);
  // a message that is only a file that can't be read: said at once
  assert.throws(() => buildTurns([{ id: 9, role: 'user', text: '', files: [file('old.doc', 'x')] }]), e => e.code === 'unreadable' && /Save it as \.docx/.test(e.message));
});
