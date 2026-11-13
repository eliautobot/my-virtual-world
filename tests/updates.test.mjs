// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// "New version available" (server/updates.js): the server asks GitHub's latest release; a newer version is kept, told
// once per version to the accounts that run the server (a notification), and shown to those who see the settings
// (/api/auth/me update → Settings → About and the page's note). Older or equal versions, drafts, pre-releases and no
// answer change nothing; Settings → General turns the check off. The real server asks a fake feed here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { openDb } from '../server/db.js';
import { UpdateCheck, newer, parseVersion, RELEASES_URL, RELEASES_PAGE } from '../server/updates.js';
import { startServer, ownerSession, userSession, tempDir } from './helpers/server.mjs';

test('versions: read with or without v, compared part by part', () => {
  assert.deepEqual(parseVersion('v2.6.0'), [2, 6, 0]);
  assert.deepEqual(parseVersion('2.10.3'), [2, 10, 3]);
  assert.deepEqual(parseVersion('2.6.0-rc.1'), [2, 6, 0]);
  assert.equal(parseVersion('latest'), null); assert.equal(parseVersion(''), null); assert.equal(parseVersion('2.6'), null);
  assert.equal(newer('2.6.0', '2.5.2'), true);
  assert.equal(newer('2.10.0', '2.9.9'), true, 'numbers, not text');
  assert.equal(newer('2.5.2', '2.5.2'), false);
  assert.equal(newer('2.5.1', '2.5.2'), false);
  assert.equal(newer('x', '2.5.2'), false);
  assert.match(RELEASES_URL, /^https:\/\/api\.github\.com\/repos\/eliautobot\/my-virtual-world\/releases\/latest$/);
});

function setup({ current = '2.5.2', feed, enabled = true, recipients = [1] } = {}) {
  const dir = tempDir('mvw-upd-');
  const dbs = openDb(dir);
  const told = [], asked = [];
  const on = { enabled };
  const u = new UpdateCheck({
    db: dbs.db, worldId: dbs.worldId, current, enabled: () => on.enabled, recipients: () => recipients, notify: (id, n) => told.push({ id, ...n }),
    fetch: async (url, o) => { asked.push({ url, headers: o.headers }); return feed(); },
  });
  return { u, told, asked, on, recipients, done: () => { dbs.db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const release = (tag, extra = {}) => async () => ({ ok: true, status: 200, json: async () => ({ tag_name: tag, name: `My Virtual World ${tag}`, html_url: `https://github.com/eliautobot/my-virtual-world/releases/tag/${tag}`,
  published_at: '2026-11-20T12:00:00Z', body: '## What is new\n- Things', draft: false, prerelease: false, ...extra }) });

test('a newer version is kept, told once to the accounts that run the server, and shown with its notes', async () => {
  const x = setup({ feed: release('v2.6.0'), recipients: [1, 4] });
  try {
    assert.equal(x.u.status().available, false, 'nothing known before the first answer');
    const r = await x.u.check();
    assert.deepEqual(r, { checked: true, available: true, version: '2.6.0' });
    assert.equal(x.asked[0].url, RELEASES_URL);
    assert.equal(x.asked[0].headers['user-agent'], 'My-Virtual-World-update-check', 'a generic client name, nothing about this world');
    assert.equal(x.told.length, 2);
    assert.deepEqual(x.told.map(t => t.id), [1, 4]);
    assert.equal(x.told[0].kind, 'update');
    assert.equal(x.told[0].title, 'New version available: My Virtual World 2.6.0');
    assert.match(x.told[0].body, /This server runs 2\.5\.2\. Settings → About/);
    assert.deepEqual(x.told[0].link, { update: '2.6.0' });
    const st = x.u.status();
    assert.equal(st.available, true); assert.equal(st.current, '2.5.2');
    assert.equal(st.latest.version, '2.6.0');
    assert.equal(st.latest.url, 'https://github.com/eliautobot/my-virtual-world/releases/tag/v2.6.0');
    assert.match(st.latest.notes, /What is new/);
    await x.u.check();
    assert.equal(x.told.length, 2, 'told once per version, not at every check');
    x.recipients.push(9);
    await x.u.check();
    assert.deepEqual(x.told.map(t => t.id), [1, 4, 9], 'an account that runs the server from later on is told at the next check');
  } finally { x.done(); }
});

test('the same or an older version, a draft or pre-release, or no answer: nothing to tell', async () => {
  for (const feed of [release('v2.5.2'), release('v2.4.0'), release('v9.0.0', { prerelease: true }), release('v9.0.0', { draft: true }), release('nightly'),
    async () => ({ ok: false, status: 403, json: async () => ({ message: 'rate limit' }) }), async () => { throw new Error('offline'); }]) {
    const x = setup({ feed });
    try {
      await x.u.check();
      assert.equal(x.told.length, 0);
      assert.equal(x.u.status().available, false);
    } finally { x.done(); }
  }
});

test('a release page that is not GitHub\'s own is not linked; turned off, nothing is asked', async () => {
  const x = setup({ feed: release('v3.0.0', { html_url: 'https://evil.example/download' }) });
  try {
    await x.u.check();
    assert.equal(x.u.status().latest.url, RELEASES_PAGE);
    x.on.enabled = false;
    const before = x.asked.length;
    assert.deepEqual(await x.u.check(), { checked: false, why: 'off' });
    assert.equal(x.asked.length, before, 'nothing asked');
    assert.equal(x.u.status().available, false, 'and nothing shown');
  } finally { x.done(); }
});

// ---------------------------------------------------------------------------------------- a real server, a fake feed
let feed, feedUrl, s, owner, member, served = 0;
before(async () => {
  feed = http.createServer((req, res) => {
    served++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tag_name: 'v99.1.0', name: 'My Virtual World 99.1.0', html_url: 'https://github.com/eliautobot/my-virtual-world/releases/tag/v99.1.0',
      published_at: '2026-11-20T12:00:00Z', body: 'Big news', draft: false, prerelease: false }));
  });
  await new Promise(r => feed.listen(0, '127.0.0.1', r));
  feedUrl = `http://127.0.0.1:${feed.address().port}/repos/latest`;
  s = await startServer({ population: 100, demo: true, env: { MVW_PROVIDER_TEST: '1', MVW_UPDATE_CHECK: 'on', MVW_UPDATE_TEST_URL: feedUrl } });
  owner = await ownerSession(s);
  member = await userSession(s, owner, { login: 'mem', displayName: 'Mem' });
});
after(async () => { await s?.stop(); feed?.close(); });

test('the server tells its owner of a newer version: a notification, and the session says so', async () => {
  let me = null;
  for (let i = 0; i < 100; i++) {
    me = (await owner.get('/api/auth/me')).json;
    if (me.update?.available) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(served >= 1, 'the feed was asked');
  assert.equal(me.update.available, true, JSON.stringify(me.update));
  assert.equal(me.update.latest.version, '99.1.0');
  assert.equal(me.update.current, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version);
  // (the owner was made after the first check: a later check tells them — every 1.5 s with a test feed)
  let note = null;
  for (let i = 0; i < 50 && !note; i++) {
    note = (await owner.get('/api/notifications')).json.notifications.find(n => n.kind === 'update');
    if (!note) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(note, 'a notification in the bell');
  assert.equal(note.title, 'New version available: My Virtual World 99.1.0');
  assert.deepEqual(note.link, { update: '99.1.0' });
  assert.equal((await member.get('/api/auth/me')).json.update, null, 'a member is not told (they cannot update the server)');
  assert.equal((await member.get('/api/notifications')).json.notifications.some(n => n.kind === 'update'), false);
});

test('Settings → General turns the check off: nothing is shown', async () => {
  const r = await owner.post('/api/settings', { values: { 'updates.check': false } });
  assert.equal(r.status, 200, r.text);
  const u = (await owner.get('/api/auth/me')).json.update;
  assert.equal(u.enabled, false); assert.equal(u.available, false);
  assert.equal((await owner.post('/api/settings', { values: { 'updates.check': true } })).status, 200);
  assert.equal((await owner.get('/api/auth/me')).json.update.available, true);
});
