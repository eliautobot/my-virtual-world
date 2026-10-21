// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The connected agent's command line (client/agent-api/mvw.mjs; 2026-10-11): the world's address it keeps. Enrolling
// saves the address of the world joined - replacing one an earlier try saved - and a world that can't be reached is
// reported with the address tried, so a wrong or old one is easy to spot.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/agent-api');

function kitCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-cli-'));
  for (const f of ['mvw.mjs', 'mvw-agent.mjs']) fs.copyFileSync(path.join(KIT, f), path.join(dir, f));
  return dir;
}
function run(dir, args, env = {}) {
  const e = { ...process.env, ...env };
  if (!('MVW_URL' in env)) delete e.MVW_URL;
  return new Promise(resolve => execFile(process.execPath, [path.join(dir, 'mvw.mjs'), ...args], { env: e, timeout: 30000 },
    (err, stdout) => resolve({ code: err ? err.code : 0, out: JSON.parse(stdout) })));
}
/** A stand-in world that knows enrol, sign-in and "me". */
async function fakeWorld() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push(`${req.method} ${req.url}`);
      const send = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.url === '/api/agent-api/enroll') return send({ slot: { id: 7, name: 'Test Resident' }, fingerprint: 'ab12'.repeat(16), approval: 'waiting', note: 'Tell your owner this key' });
      if (req.url === '/api/agent-api/session') return send({ token: 'tok', expires: Date.now() + 1800000, slot: 7 });
      if (req.url === '/api/agent-api/me') return send({ slot: { id: 7, name: 'Test Resident' } });
      if (req.url === '/api/agent-api/act') return send({ echo: JSON.parse(body || '{}') });
      if (req.url === '/api/agent-api/wakeup') return send({ method: req.method, echo: body ? JSON.parse(body) : null });
      if (req.url.startsWith('/api/agent-api/inbox')) return send({ you: { time: 'Sat 6:04 PM', partOfDay: 'evening', where: 'Sky Lounge', doing: 'Dancing', feels: 'fine', rule: 'These are the facts about you right now.' },
        messages: [{ id: 1, runId: 'r1', session: 's1', text: 'hi', sender: { name: 'Ann', visitor: false }, created: Date.now() }], stops: [], approvals: [] });
      res.statusCode = 404; send({ error: 'Not found' });
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise(r => srv.close(r)) };
}
/** An address nothing listens on. */
async function deadAddress() {
  const s = http.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  await new Promise(r => s.close(r));
  return url;
}

test('enrolling saves the world joined, replacing an address an earlier try saved', async () => {
  const dir = kitCopy(), world = await fakeWorld(), dead = await deadAddress();
  try {
    fs.writeFileSync(path.join(dir, 'mvw-url.txt'), dead + '\n', { mode: 0o600 });   // saved by a first try with a wrong address
    const e = await run(dir, ['enrol', 'mvwe_test'], { MVW_URL: world.url });
    assert.equal(e.code, 0);
    assert.deepEqual(e.out, { enrolled: true, slot: 7, name: 'Test Resident', world: world.url, key: 'ab12'.repeat(4), approval: 'waiting', note: 'Tell your owner this key' }, 'it says it waits for its owner\'s OK, with the key to tell them');
    assert.equal(fs.readFileSync(path.join(dir, 'mvw-url.txt'), 'utf8').trim(), world.url);
    assert.equal((fs.statSync(path.join(dir, 'mvw-url.txt')).mode & 0o777), 0o600);
    const me = await run(dir, ['me']);                                      // later commands need no MVW_URL
    assert.equal(me.code, 0);
    assert.equal(me.out.slot.id, 7);
    assert.ok(world.seen.includes('GET /api/agent-api/me'));
  } finally { await world.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a world that cannot be reached is reported with the address tried', async () => {
  const dir = kitCopy(), dead = await deadAddress();
  try {
    fs.writeFileSync(path.join(dir, 'mvw-identity.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(
      (await import(path.join(dir, 'mvw-agent.mjs'))).generateIdentity())), slot: 7 }), { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'mvw-url.txt'), dead + '\n');
    const r = await run(dir, ['me']);
    assert.equal(r.code, 1);
    assert.equal(r.out.world, dead);
    assert.match(r.out.error, new RegExp(`^Can't reach the world at ${dead.replace(/[.:/]/g, '\\$&')} \\(ECONNREFUSED\\)$`));
    assert.match(r.out.hint, /mvw-url\.txt/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the inbox shows the facts about you right now first, and says to answer from them (2026-10-12)', async () => {
  const dir = kitCopy(), world = await fakeWorld();
  try {
    fs.writeFileSync(path.join(dir, 'mvw-identity.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(
      (await import(path.join(dir, 'mvw-agent.mjs'))).generateIdentity())), slot: 7 }), { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'mvw-url.txt'), world.url + '\n');
    const r = await run(dir, ['inbox']);
    assert.equal(r.code, 0);
    assert.equal(Object.keys(r.out)[0], 'you', 'first');
    assert.deepEqual([r.out.you.time, r.out.you.partOfDay, r.out.you.doing], ['Sat 6:04 PM', 'evening', 'Dancing']);
    assert.equal(r.out.messages[0].text, 'hi');
    assert.match(r.out.note, /"you" holds the facts about you right now: answer from them/);
  } finally { await world.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the kit\'s version is the one the world expects (server/agent-api.js AGENT_KIT_VERSION; the Python kit too)', async () => {
  const { AGENT_KIT_VERSION } = await import('../../server/agent-api.js');
  const { KIT_VERSION } = await import('../../client/agent-api/mvw-agent.mjs');
  const py = fs.readFileSync(new URL('../../client/agent-api/mvw_agent.py', import.meta.url), 'utf8').match(/^KIT_VERSION = "([^"]+)"/m)?.[1];
  assert.deepEqual([KIT_VERSION, py], [AGENT_KIT_VERSION, AGENT_KIT_VERSION]);
});

test('focused questions: about, plans, memories, conversation ask the world for one small thing each', async () => {
  const dir = kitCopy(), world = await fakeWorld();
  try {
    fs.writeFileSync(path.join(dir, 'mvw-identity.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(
      (await import(path.join(dir, 'mvw-agent.mjs'))).generateIdentity())), slot: 7 }), { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'mvw-url.txt'), world.url + '\n');
    const sent = async args => (await run(dir, args)).out.echo;
    assert.deepEqual(await sent(['about', 'Bob', 'Lee']), { action: 'about', name: 'Bob Lee' });
    assert.deepEqual(await sent(['plans']), { action: 'plans' });
    assert.deepEqual(await sent(['memories', 'chess', '--limit', '3']), { action: 'memories', about: 'chess', limit: 3 });
    assert.deepEqual(await sent(['memories']), { action: 'memories' });
    assert.deepEqual(await sent(['conversation', 'Mia', '--limit', '5']), { action: 'conversation', with: 'Mia', limit: 5 });
  } finally { await world.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('its own wake-up link: wakeup shows it, wakeup set sends the address with its key or header line, wakeup remove (2026-10-12)', async () => {
  const dir = kitCopy(), world = await fakeWorld();
  try {
    fs.writeFileSync(path.join(dir, 'mvw-identity.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(
      (await import(path.join(dir, 'mvw-agent.mjs'))).generateIdentity())), slot: 7 }), { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'mvw-url.txt'), world.url + '\n');
    const said = async args => (await run(dir, args)).out;
    assert.deepEqual(await said(['wakeup']), { method: 'GET', echo: null });
    assert.deepEqual(await said(['wakeup', 'set', 'https://hooks.example.com/w/1', '--header', 'Authorization: Bearer k123']),
      { method: 'POST', echo: { url: 'https://hooks.example.com/w/1', header: 'Authorization: Bearer k123' } });
    assert.deepEqual((await said(['wakeup', 'set', 'https://hooks.example.com/w/1', '--key', 'k123'])).echo, { url: 'https://hooks.example.com/w/1', key: 'k123' });
    assert.deepEqual((await said(['wakeup', 'remove'])).echo, { remove: true });
    assert.match((await said(['wakeup', 'set'])).error, /Missing the address/);
  } finally { await world.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
