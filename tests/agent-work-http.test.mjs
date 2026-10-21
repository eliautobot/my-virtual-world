// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's work on a real server (docs/features/CHAT.md §13): its job brief, notes and knowledge files (its owner's
// and its managers' only, checked and bounded); its owner's chats in Work mode — the real date and time, the brief, what
// it knows and its notes, nothing of its city life, notes kept instead of plans and memories — and in Life mode as
// before; a chat's own mode, the line that marks a switch, and who has the modes at all.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { DOCX } from './helpers/zip.mjs';

let s, owner, ann, fake, A, B;
const seen = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(30); } };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

/** The fake brain: echoes the message; "keep-note" also keeps notes, "plan-it" asks for a plan in the city. */
function content(j) {
  const sys = j.messages.find(m => m.role === 'system')?.content || '';
  const last = j.messages.filter(m => m.role === 'user').at(-1).content;
  const text = typeof last === 'string' ? last : last.filter(p => p.type === 'text').map(p => p.text).join('\n');
  if (!/In this chat you talk with|This chat is WORK/.test(sys)) return JSON.stringify({ reply: 'Hi stranger.' });
  const msg = text.split('\n').at(-1), keep = {};
  if (/keep-note/.test(msg)) keep.notes = ['Sam wants the report every Friday.', 'Sam wants the report every Friday.', '', 42];
  if (/plan-it/.test(msg)) { keep.plans = [{ kind: 'must', text: 'buy a coffee' }]; keep.memories = [{ text: 'Sam likes tea', importance: 3 }]; }
  if (/This is a new chat/.test(sys)) keep.title = 'Work chat';
  return `Echo: ${msg}${Object.keys(keep).length ? `\n[[mvw-actions]]\n${JSON.stringify(keep)}` : ''}`;
}
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : null;
      if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fake-small' }] })); return; }
      seen.push(j);
      const c = content(j);
      if (!j.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model: j.model, choices: [{ finish_reason: 'stop', message: { content: c } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: c } }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`);
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 260, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake-small' }, secrets: { apiKey: 'sk-WORK-1' } });
  assert.equal(c.status, 200, c.text);
  [A, B] = [agents[0].id, agents[1].id];
  for (const id of [A, B]) assert.equal((await owner.post('/api/agents/update', { id, connectionId: c.json.id, nativeId: 'mind' })).status, 200);
});
after(async () => { await s?.stop(); fake?.close(); });

const newChat = async (agent = A, c = owner) => (await c.post('/api/chat-sessions/create', { agent })).json.session;
const ask = async (session, input, { agent = A, c = owner, ...extra } = {}) => {
  const n = seen.length;
  const r = await c.post('/api/providers/runs', { agent, session, input, ...extra });
  assert.equal(r.status, 200, r.text);
  const end = await waitFor(async () => { const e = (await c.get(`/api/providers/runs/events?run=${r.json.runId}`)).json; return e && e.done ? e.events.map(x => x.event) : null; });
  assert.ok(end, 'the answer ended');
  const call = seen.slice(n).find(j => j.stream);
  return { events: end, end: end.find(e => e.type === 'run.end'), system: call?.messages.find(m => m.role === 'system')?.content || '', call };
};
const up = async (c, name, buf) => { const r = await c.request('POST', `/api/chat/attachments?name=${encodeURIComponent(name)}`, buf, { 'content-type': 'application/octet-stream' }); assert.equal(r.status, 200, r.text); return r.json.attachment; };

test('the brief: its default, each field checked, kept; only its owner and managers see or change it', async () => {
  const g = (await owner.get(`/api/agent-work?agent=${A}`)).json;
  assert.deepEqual(g.brief, { company: '', instructions: '', tone: 'own', timezone: '', knowledge: '', notes: true, defaultMode: 'work', publicMode: 'life' });
  assert.deepEqual([g.notes, g.files, g.budget.chars, g.budget.maxChars, g.budget.maxFiles], [[], [], 0, 60000, 10]);
  const set = await owner.post('/api/agent-work', { agent: A, company: '  Acme\nDental  ', instructions: 'Answer the phone.\r\nBook appointments.', tone: 'professional', timezone: 'America/New_York', knowledge: 'Open 9 to 5, Monday to Friday.' });
  assert.equal(set.status, 200, set.text);
  assert.deepEqual([set.json.brief.company, set.json.brief.instructions, set.json.brief.tone, set.json.brief.timezone], ['Acme Dental', 'Answer the phone.\nBook appointments.', 'professional', 'America/New_York']);
  assert.equal(set.json.budget.chars, 'Open 9 to 5, Monday to Friday.'.length);
  for (const [bad, code] of [[{ tone: 'rude' }, 'bad_tone'], [{ timezone: 'Mars/Olympus' }, 'bad_timezone'], [{ timezone: '../etc' }, 'bad_timezone'], [{ defaultMode: 'play' }, 'bad_mode'],
    [{ publicMode: 'x' }, 'bad_mode'], [{ notes: 'yes' }, 'bad_notes'], [{ instructions: 'x'.repeat(8001) }, 'too_long'], [{ knowledge: 'k'.repeat(60001) }, 'knowledge_full'], [{ knowledge: 7 }, 'bad_knowledge'], [{}, 'nothing']]) {
    const r = await owner.post('/api/agent-work', { agent: A, ...bad });
    assert.deepEqual([r.status, r.json.code], [400, code], JSON.stringify(bad));
  }
  assert.equal((await owner.get(`/api/agent-work?agent=${A}`)).json.brief.tone, 'professional', 'nothing refused was kept');
  // someone it is not shared with to manage: no such agent (even shared to use)
  assert.equal((await owner.post('/api/agents/share', { id: A, kind: 'account', who: (await ann.get('/api/auth/me')).json.account.id, level: 'use' })).status, 200);
  for (const r of [await ann.get(`/api/agent-work?agent=${A}`), await ann.post('/api/agent-work', { agent: A, tone: 'formal' }), await ann.post('/api/agent-work/notes', { agent: A, add: { text: 'x' } }),
    await ann.get(`/api/agent-work?agent=999999`)]) assert.equal(r.status, 404);
  const audit = await owner.get('/api/audit?action=agent.work');
  assert.equal(audit.status, 200, audit.text);
  const ev = audit.json.events.find(e => e.action === 'agent.work');
  assert.ok(ev, 'the change is in the audit log');
  assert.deepEqual(JSON.parse(typeof ev.detail === 'string' ? ev.detail : JSON.stringify(ev.detail)).fields.sort(), ['company', 'instructions', 'knowledge', 'timezone', 'tone']);
});

test('notes: its owner adds and removes them; one kept twice is refused', async () => {
  const add = await owner.post('/api/agent-work/notes', { agent: A, add: { text: '  The front desk  phone is 555-0100. ' } });
  assert.equal(add.status, 200, add.text);
  assert.deepEqual(add.json.notes.map(n => [n.text, n.source]), [['The front desk phone is 555-0100.', 'owner']]);
  assert.equal((await owner.post('/api/agent-work/notes', { agent: A, add: { text: 'the front desk phone is 555-0100.' } })).json.code, 'duplicate');
  assert.equal((await owner.post('/api/agent-work/notes', { agent: A, add: { text: '   ' } })).json.code, 'empty');
  assert.equal((await owner.post('/api/agent-work/notes', { agent: A, add: { text: 'n'.repeat(501) } })).json.code, 'too_long');
  const tmp = (await owner.post('/api/agent-work/notes', { agent: A, add: { text: 'Gone soon' } })).json.notes[0];
  assert.equal(tmp.text, 'Gone soon', 'the newest first');
  assert.equal((await owner.post('/api/agent-work/notes', { agent: A, id: tmp.id, remove: true })).json.notes.length, 1);
  assert.equal((await owner.post('/api/agent-work/notes', { agent: A, id: tmp.id, remove: true })).status, 404);
  assert.equal((await owner.post('/api/agent-work/notes', { agent: B, id: add.json.notes[0].id, remove: true })).status, 404, 'another agent\'s note is not found');
});

test('knowledge files: a copy of an upload (the upload can leave the Library), documents read once, bounded, private', async () => {
  const md = await up(owner, 'prices.md', Buffer.from('# Prices\nCleaning: $90\nWhitening: $250\n'));
  const add = await owner.post('/api/agent-work/files', { agent: A, attachment: md.id, drop: true });
  assert.equal(add.status, 200, add.text);
  assert.deepEqual([add.json.file.name, add.json.file.kind, add.json.duplicate, add.json.files.length], ['prices.md', 'text', false, 1]);
  assert.ok(add.json.file.chars > 20);
  assert.ok(!(await owner.get('/api/chat/attachments')).json.attachments.some(f => f.id === md.id), 'the upload left the Library');
  const file = await owner.request('GET', `/api/agent-work/file?agent=${A}&id=${add.json.file.id}`);
  assert.equal(file.status, 200); assert.match(file.text, /Whitening: \$250/, 'its copy stays');
  const doc = await up(owner, 'handbook.docx', DOCX);
  const d = await owner.post('/api/agent-work/files', { agent: A, attachment: doc.id });
  assert.equal(d.status, 200, d.text);
  assert.ok((await owner.get('/api/chat/attachments')).json.attachments.some(f => f.id === doc.id), 'without drop the upload stays');
  assert.equal((await owner.post('/api/agent-work/files', { agent: A, attachment: doc.id })).json.duplicate, true, 'the same file twice is the one there');
  const pdf = await up(owner, 'menu.pdf', PDF);
  const p = await owner.post('/api/agent-work/files', { agent: A, attachment: pdf.id });
  assert.deepEqual([p.status, p.json.file?.kind], [200, 'pdf'], p.text);
  assert.equal(p.json.budget.pdf, PDF.length);
  const png = await up(owner, 'logo.png', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
  assert.equal((await owner.post('/api/agent-work/files', { agent: A, attachment: png.id })).json.code, 'unreadable', 'an image is refused');
  const big = await up(owner, 'big.txt', Buffer.from('word '.repeat(13000)));
  const r = await owner.post('/api/agent-work/files', { agent: A, attachment: big.id });
  assert.deepEqual([r.status, r.json.code], [400, 'knowledge_full']); assert.match(r.json.error, /left/);
  assert.equal((await owner.post('/api/agent-work', { agent: A, knowledge: 'k'.repeat(59990) })).json.code, 'knowledge_full', 'typed knowledge counts its files');
  // someone else's upload, or none: not found
  const annFile = await up(ann, 'ann.txt', Buffer.from('hello'));
  assert.equal((await owner.post('/api/agent-work/files', { agent: A, attachment: annFile.id })).status, 404);
  assert.equal((await ann.request('GET', `/api/agent-work/file?agent=${A}&id=${add.json.file.id}`)).status, 404);
  const gone = await owner.post('/api/agent-work/files/remove', { agent: A, id: d.json.file.id });
  assert.deepEqual(gone.json.files.map(f => f.name), ['prices.md', 'menu.pdf']);
  assert.equal((await owner.post('/api/agent-work/files/remove', { agent: A, id: d.json.file.id })).status, 404);
});

test('a chat in Work mode: the real time where it works, its brief, what it knows and its notes; nothing of the city; notes kept', async () => {
  const can = (await owner.get(`/api/chat/can?agent=${A}`)).json;
  assert.deepEqual(can.modes, { default: 'work' }, 'its owner has the modes');
  const sess = await newChat();
  assert.equal(sess.mode, null, 'a new chat follows the agent');
  const r = await ask(sess.id, 'What time is it?', { tz: 'Asia/Tokyo' });
  assert.equal(r.end.status, 'ok', JSON.stringify(r.end));
  assert.match(r.system, /This chat is WORK/);
  assert.match(r.system, /at «Acme Dental», an AI agent who works for/);
  assert.match(r.system, /in a tone that is professional/);
  assert.match(r.system, /NOW: \w+day, \w+ \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M E[DS]T \(time zone America\/New_York\)/, 'the brief\'s time zone wins over the writer\'s');
  assert.match(r.system, /YOUR JOB — «[^»]+»'s instructions[^\n]*\nAnswer the phone\.\nBook appointments\./);
  assert.match(r.system, /Open 9 to 5, Monday to Friday\./);
  assert.match(r.system, /--- FILE «prices\.md» ---\n# Prices\nCleaning: \$90/);
  assert.match(r.system, /Your PDF «menu\.pdf» can't be read by the brain you think with now/, 'a brain that reads no PDFs is told (models.js: only OpenAI, OpenRouter, Anthropic)');
  assert.match(r.system, /YOUR WORK NOTES[^\n]*\n- «The front desk phone is 555-0100\.»/);
  assert.doesNotMatch(r.system, /YOUR LIFE IN THE CITY|TOOLS \(things you can do in the city/, 'nothing of its life');
  assert.equal(typeof r.call.messages.find(m => m.role === 'user').content, 'string', '… and its PDF is not sent to it');
  // without a time zone in the brief: the writer's; without either, the server's
  assert.equal((await owner.post('/api/agent-work', { agent: A, timezone: '' })).status, 200);
  assert.match((await ask(sess.id, 'and now?', { tz: 'Asia/Tokyo' })).system, /GMT\+9 \(time zone Asia\/Tokyo\)/);
  assert.equal((await owner.post('/api/providers/runs', { agent: A, session: sess.id, input: 'x', tz: 7 })).json.code, 'bad_timezone');
  const unknown = await ask(sess.id, 'a zone it does not know', { tz: 'Not/AZone' });
  assert.equal(unknown.end.status, 'ok', 'a browser\'s zone the server doesn\'t know never stops a chat');
  assert.doesNotMatch(unknown.system, /Not\/AZone/);
  // what it keeps from work: notes (once each), never plans or memories in the city
  const before = (await owner.get(`/api/agent-life/profile?agent=${A}`)).json.plans.length;
  const k = await ask(sess.id, 'keep-note plan-it');
  assert.equal(k.end.text, 'Echo: keep-note plan-it');
  assert.deepEqual(k.events.filter(e => e.type === 'tool.end').map(e => e.text), ['Sam wants the report every Friday.']);
  assert.ok(k.events.some(e => e.type === 'tool.start' && e.name === 'note'));
  const notes = (await owner.get(`/api/agent-work?agent=${A}`)).json.notes;
  assert.deepEqual(notes.map(n => [n.text, n.source]).slice(0, 2), [['Sam wants the report every Friday.', 'agent'], ['The front desk phone is 555-0100.', 'owner']]);
  assert.equal((await owner.get(`/api/agent-life/profile?agent=${A}`)).json.plans.length, before, 'no plan in the city from work');
  // notes off: none kept, and it is not asked for them
  assert.equal((await owner.post('/api/agent-work', { agent: A, notes: false })).status, 200);
  const off = await ask(sess.id, 'keep-note again');
  assert.doesNotMatch(off.system, /"notes":/);
  assert.equal(off.events.filter(e => e.type === 'tool.end').length, 0);
  assert.equal((await owner.post('/api/agent-work', { agent: A, notes: true })).status, 200);
});

test('Work and Life: a chat\'s own mode, the line that marks a switch, Life as before, and only its owner\'s Mind chats have them', async () => {
  const sess = await newChat();
  const sw = await owner.post('/api/chat-sessions/prefs', { agent: A, session: sess.id, mode: 'life' });
  assert.equal(sw.status, 200, sw.text); assert.equal(sw.json.session.mode, 'life');
  assert.equal(sw.json.line, undefined, 'a chat with nothing in it yet: nothing to mark');
  const life = await ask(sess.id, 'plan-it please');
  assert.match(life.system, /In this chat you talk with/);
  assert.match(life.system, /YOUR LIFE IN THE CITY/);
  assert.doesNotMatch(life.system, /Acme Dental|Answer the phone|YOUR WORK NOTES|prices\.md/, 'nothing of its job in Life');
  assert.doesNotMatch(life.system, /Earlier in this chat you were/, 'a chat that started in Life never switched');
  assert.ok(life.events.some(e => e.type === 'tool.start' && e.name === 'plan'), 'Life keeps plans as before');
  const same = await owner.post('/api/chat-sessions/prefs', { agent: A, session: sess.id, mode: 'life' });
  assert.deepEqual([same.status, same.json.line], [200, undefined], 'the same mode again: no switch');
  const back = await owner.post('/api/chat-sessions/prefs', { agent: A, session: sess.id, mode: null });
  assert.equal(back.json.session.mode, null, 'back to the agent\'s');
  assert.deepEqual([back.json.line?.text, back.json.line?.status, back.json.line?.meta?.mode, Number.isInteger(back.json.line?.id)], ['Switched to Work', 'mode', 'work', true], 'the line, for the window');
  const h = (await owner.get(`/api/providers/history?agent=${A}&session=${sess.id}`)).json.messages;
  assert.deepEqual(h.filter(m => m.role === 'system').map(m => [m.text, m.status]), [['Switched to Work', 'mode']], 'one line for each real switch in a chat with messages');
  const again = (await ask(sess.id, 'hello')).system;
  assert.match(again, /This chat is WORK/);
  assert.match(again, /Earlier in this chat you were in Life mode[^\n]*don't correct or repeat them/, 'its Life answers before are not to be "corrected"');
  // the agent's default decides chats that have none of their own
  assert.equal((await owner.post('/api/agent-work', { agent: A, defaultMode: 'life' })).status, 200);
  assert.match((await ask(sess.id, 'hello again')).system, /YOUR LIFE IN THE CITY/);
  assert.deepEqual((await owner.get(`/api/chat/can?agent=${A}`)).json.modes, { default: 'life' });
  assert.equal((await owner.post('/api/agent-work', { agent: A, defaultMode: 'work' })).status, 200);
  for (const [bad, code] of [[{ mode: 'play' }, 'bad_mode']]) assert.equal((await owner.post('/api/chat-sessions/prefs', { agent: A, session: sess.id, ...bad })).json.code, code);
  // someone it is shared with: the resident's short answer, no modes
  const theirs = await newChat(A, ann);
  assert.equal((await ann.get(`/api/chat/can?agent=${A}`)).json.modes, undefined);
  assert.equal((await ann.post('/api/chat-sessions/prefs', { agent: A, session: theirs.id, mode: 'work' })).json.code, 'no_modes');
  // an agent without a brief of its own: Work, as its own self
  const other = await ask((await newChat(B)).id, 'hi', { agent: B });
  assert.match(other.system, /This chat is WORK/);
  assert.match(other.system, /in your own voice/);
  assert.doesNotMatch(other.system, /YOUR JOB|WHAT YOU KNOW|YOUR WORK NOTES|Acme/, 'one agent\'s job is not another\'s');
});
