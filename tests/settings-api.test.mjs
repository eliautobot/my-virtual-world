// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The settings API, display preferences that follow the account, the key for stored secrets on a real server, and an
// end-to-end check that a real secret never reaches a log or another response (CHECKLIST I14.16; DECISIONS C86–C88,
// C90, C91, C93, C96–C98).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from '../server/sqlite.js';
import { totp, base32Decode } from '../server/auth/totp.js';
import { newKey, fingerprint, readKeyFile, writeKeyFile } from '../server/secrets.js';
import { ROOT, startServer, httpClient, ownerSession, userSession, tempDir } from './helpers/server.mjs';

let s, owner, admin, member, twofa = null;
before(async () => {
  s = await startServer({ population: 60, env: { MVW_KEY_POLL_MS: '100' } });
  owner = await ownerSession(s);
  admin = await userSession(s, owner, { login: 'admin1', displayName: 'Admin One', role: 'admin' });
  member = await userSession(s, owner, { login: 'member1', displayName: 'Member One' });
});
after(async () => { await s?.stop(); });

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 100));
  }
};
const age = login => {
  const db = new DatabaseSync(path.join(s.data, 'next.db'), { timeout: 5000 });
  try { db.prepare('UPDATE sessions SET auth_at = auth_at - 660000 WHERE account_id = (SELECT id FROM accounts WHERE login = ?)').run(login); } finally { db.close(); }
};
const hostTool = args => spawnSync(process.execPath, ['tools/admin.mjs', ...args, '--data', s.data, '--key-file', s.keyFile], { cwd: ROOT, encoding: 'utf8' });
const rowsOf = view => Object.fromEntries(view.settings.map(x => [x.path, x]));
async function twoStepSignIn(login, password, code) {
  const c = httpClient(s.url);
  const t = (await c.post('/api/auth/signin', { login, password })).json.ticket;
  return (await c.post('/api/auth/signin/2fa', { ticket: t, code })).status;
}

test('installation settings: admins see each one with its tier and who may change it; members and guests do not (C90, C96)', async () => {
  const v = (await admin.get('/api/settings')).json, row = rowsOf(v);
  assert.deepEqual(Object.keys(row), ['world.requireSignIn', 'registration.open', 'connector.enabled', 'agentApps.grokBot', 'agentApps.openaiDot', 'agentApps.metaMuse', 'security.require2fa', 'audit.retentionDays', 'players.spawn', 'chat.proximity', 'world.homesFilled', 'world.home', 'chat.attachmentMaxMb', 'chat.attachmentQuotaMb', 'presence.finishGraceSec', 'presence.quietLimitMin', 'activity.retentionDays', 'freeWill.enabled', 'freeWill.defaultConnection', 'freeWill.dailyDecisions', 'freeWill.agentDailyDecisions', 'freeWill.keepDays', 'mind.enabled', 'mind.reflectConnection', 'mind.agentDailyJobs', 'mind.agentMonthlyUsd', 'mind.dailyUsd', 'mind.keepDays', 'mind.speech', 'mind.moderationConnection', 'mind.speechPerDay', 'mind.chatModels', 'push.contact', 'mind.chatPerDay', 'phone.syncSeconds', 'talk.enabled', 'talk.maxMessages', 'talk.maxChars', 'talk.windowMinutes', 'talk.visitorPerDay', 'talk.agentVisitorPerDay', 'mind.speechGapSeconds', 'mind.speechMaxChars', 'connected.hearMeters', 'connected.heardMax', 'connected.nearMax', 'connected.placesMax', 'connected.inboxMax', 'connected.orderGapSeconds', 'connected.maxOrderMinutes', 'connected.meetSearchMinutes', 'connected.writesPerMinute', 'connected.requestsPerMinute', 'connected.queueMax', 'connected.enabled', 'connected.requireApproval', 'connected.wakeEnabled', 'connected.wakePerHour', 'connected.visitorsEnabled', 'connected.strikesPerDay', 'connected.answerMaxChars', 'connector.perMinute', 'social.enabled', 'social.friendAt', 'social.knownAt', 'social.msgMaxChars', 'social.convoMessages', 'social.convoMinutes', 'social.pairPerDay', 'social.sentPerDay', 'social.repliesPerDay', 'social.strangerLinesPerDay', 'social.perMinute', 'social.whereisPerDay', 'social.invitesPerDay', 'social.mindMessagesPerDay', 'social.mindInvitesPerDay', 'social.fadeAfterDays', 'social.fadePerDay', 'social.coolOffDays', 'voice.enabled', 'voice.listenConnection', 'voice.speakConnection', 'voice.perMinute', 'voice.dailyUsd', 'agentLife.activityDays', 'pc.agentMB', 'pc.teamMB', 'pc.fileMB', 'pc.keepDays', 'pc.search', 'pc.realBrowser']);
  assert.ok(v.settings.every(x => x.tier === 2 && x.tierName === 'infrastructure'));
  assert.equal(row['registration.open'].canChange, true);
  assert.deepEqual([row['audit.retentionDays'].canChange, row['audit.retentionDays'].why], [false, 'Only the owner can change this']);
  assert.equal(rowsOf((await owner.get('/api/settings')).json)['audit.retentionDays'].canChange, true);
  assert.equal(v.key.source, 'file');
  assert.deepEqual(v.key.fingerprints, readKeyFile(s.keyFile).map(fingerprint));
  assert.equal(v.key.problem, null);
  assert.equal((await member.get('/api/settings')).status, 403);
  assert.equal((await httpClient(s.url).get('/api/settings')).status, 401);
});

test('changing installation settings: each setting checks its own permission, and tier 2 needs a recent password entry', async () => {
  const r = await admin.post('/api/settings', { values: { 'registration.open': true } });
  assert.equal(r.status, 200, r.text);
  assert.equal(rowsOf(r.json)['registration.open'].value, true);
  assert.equal((await httpClient(s.url).get('/api/auth/me')).json.registrationOpen, true);
  assert.equal((await admin.post('/api/settings', { values: { 'audit.retentionDays': 90 } })).json.code, 'forbidden');
  assert.equal((await admin.post('/api/settings', { values: { 'no.such': 1 } })).status, 400);
  assert.equal((await admin.post('/api/settings', { values: { 'registration.open': 'yes' } })).status, 400);
  assert.equal((await admin.post('/api/settings', { values: {} })).status, 400);
  age('admin1');
  assert.equal((await admin.post('/api/settings', { values: { 'registration.open': false } })).json.code, 'reauth_required');
  assert.equal((await admin.post('/api/auth/reauth', { password: admin.password })).status, 200);
  assert.equal((await admin.post('/api/settings', { values: { 'registration.open': false } })).status, 200);
  assert.equal(rowsOf((await owner.post('/api/settings', { values: { 'audit.retentionDays': 365 } })).json)['audit.retentionDays'].value, 365);
  assert.equal(rowsOf((await owner.post('/api/settings', { values: { 'audit.retentionDays': null } })).json)['audit.retentionDays'].value, null);
  const ev = (await owner.get('/api/audit?group=settings&limit=50')).json.events;
  assert.ok(ev.some(e => e.action === 'settings.change' && e.detail.changes['registration.open'] === true));
});

test('display preferences follow the account to every device; they are tier 0 and not audited (C91, C92, C100)', async () => {
  const r = await member.post('/api/account/settings', { values: { 'display.labels': false, 'display.walls': 'up' } });
  assert.equal(r.status, 200, r.text);
  const other = httpClient(s.url);
  await other.signIn('member1', member.password);
  const row = rowsOf((await other.get('/api/account/settings')).json);
  assert.deepEqual([row['display.labels'].value, row['display.labels'].stored], [false, true]);
  assert.equal(row['display.walls'].value, 'up');
  assert.deepEqual([row['display.seenHelp'].value, row['display.seenHelp'].stored], [false, false]);
  assert.ok(Object.values(row).every(x => x.tier === 0));
  assert.equal((await member.post('/api/account/settings', { values: { 'display.walls': 'sideways' } })).status, 400);
  assert.equal((await member.post('/api/account/settings', { values: { 'world.requireSignIn': true } })).status, 400);
  // a number setting (Transparency, 2026-10-08): whole numbers in its range and steps only
  assert.deepEqual([row['display.transparency'].value, row['display.transparency'].min, row['display.transparency'].max, row['display.transparency'].step], [0, 0, 60, 5]);
  for (const bad of [33, 65, -5, '40', 40.5, true]) assert.equal((await member.post('/api/account/settings', { values: { 'display.transparency': bad } })).status, 400, `refuses ${JSON.stringify(bad)}`);
  assert.equal((await member.post('/api/account/settings', { values: { 'display.transparency': 40 } })).status, 200);
  assert.equal(rowsOf((await other.get('/api/account/settings')).json)['display.transparency'].value, 40, 'on every device');
  assert.equal((await httpClient(s.url).get('/api/account/settings')).status, 401);
  const ex = await member.get('/api/account/export');
  assert.equal(ex.status, 200, ex.text);
  assert.equal(ex.json.settings.find(x => x.path === 'display.labels').value, false, 'the data download includes them');
  assert.equal(JSON.stringify((await owner.get('/api/audit?limit=500')).json.events).includes('display.'), false);
});

test('the key: created at the first start next to the data folder, not in it, readable only by the server\'s user, never logged (C86)', () => {
  assert.equal(path.dirname(s.keyFile), path.dirname(s.data));
  assert.equal(fs.statSync(s.keyFile).mode & 0o777, 0o600);
  assert.match(s.log(), /\[secrets\] created the key file .* \(key [0-9a-f]{12}\)/);
  assert.equal(s.log().includes(fs.readFileSync(s.keyFile, 'utf8').trim()), false);
});

test('end to end: a real secret reaches only its one-time setup answer, never a log, another response or the database in the clear (I14.16, C93)', async () => {
  const u = await userSession(s, owner, { login: 'secure1', displayName: 'Secure One', role: 'admin' });
  const setup = (await u.post('/api/account/2fa/setup')).json;
  const secret = setup.secret.replace(/\s/g, ''), key = base32Decode(secret);
  const en = await u.post('/api/account/2fa/enable', { code: totp(key, Date.now()) });
  assert.equal(en.status, 200, en.text);
  twofa = { client: u, key, codes: en.json.codes, login: 'secure1', password: u.password };
  const texts = [];
  for (const [c, p] of [[u, '/api/auth/me'], [u, '/api/account/2fa'], [u, '/api/account/settings'], [u, '/api/account/export'],
    [u, '/api/account/devices'], [owner, '/api/settings'], [owner, '/api/users'], [owner, '/api/audit?format=jsonl&limit=5000'],
    [owner, '/api/audit?format=csv'], [httpClient(s.url), '/api/health']]) {
    const r = await c.get(p);
    assert.equal(r.status, 200, `${p}: ${r.status} ${r.text}`);
    texts.push(r.text);
  }
  const file = n => (fs.existsSync(path.join(s.data, n)) ? fs.readFileSync(path.join(s.data, n)).toString('latin1') : '');
  const db = file('next.db') + file('next.db-wal');
  for (const x of [secret, setup.secret, ...twofa.codes, fs.readFileSync(s.keyFile, 'utf8').trim()]) {
    assert.equal(texts.some(t => t.includes(x)), false, 'no other response holds it');
    assert.equal(s.log().includes(x), false, 'the log never holds it');
    assert.equal(db.includes(x), false, 'the database holds it only sealed');
  }
  assert.equal(s.log().includes('otpauth://'), false);
  assert.equal(await twoStepSignIn('secure1', u.password, twofa.codes[0]), 200, 'and it works: a recovery code signs in');
});

test('rotating the key while the server runs: it switches within seconds; recovery codes survive, --forget removes them (C87, C96, C97)', async () => {
  assert.ok(twofa, 'needs the end-to-end test');
  const second = await userSession(s, owner, { login: 'secure2', displayName: 'Secure Two' });
  const k2 = base32Decode((await second.post('/api/account/2fa/setup')).json.secret);
  assert.equal((await second.post('/api/account/2fa/enable', { code: totp(k2, Date.now()) })).status, 200);
  const old = fingerprint(readKeyFile(s.keyFile)[0]);
  const r = hostTool(['rotate-key']);
  assert.equal(r.status, 0, r.stderr);
  const fps = readKeyFile(s.keyFile).map(fingerprint);
  assert.deepEqual(fps.slice(1), [old]);
  await until(async () => (await owner.get('/api/settings')).json.key.fingerprints.join() === fps.join());
  assert.equal(await twoStepSignIn(twofa.login, twofa.password, totp(twofa.key, Date.now() + 30000)), 200, 'two-factor secrets open with the new key');
  assert.equal(await twoStepSignIn(twofa.login, twofa.password, twofa.codes[1]), 200, 'recovery codes survive a rotation');
  const f = hostTool(['rotate-key', '--forget']);
  assert.equal(f.status, 0, f.stderr);
  const fps2 = readKeyFile(s.keyFile).map(fingerprint);
  assert.equal(fps2.length, 1);
  await until(async () => (await owner.get('/api/settings')).json.key.fingerprints.join() === fps2[0]);
  assert.equal((await twofa.client.get('/api/account/2fa')).json.recoveryLeft, 0);
  assert.equal(await twoStepSignIn(twofa.login, twofa.password, twofa.codes[2]), 401, 'recovery codes are gone after --forget');
  assert.equal(await twoStepSignIn('secure2', second.password, totp(k2, Date.now() + 30000)), 200, 'two-factor secrets open with the newest key');
  assert.match(s.log(), /\[secrets\] the key file changed/);
});

test('a key file that cannot open the stored secrets is kept out while the server runs, and admins see why (C98)', async () => {
  const good = fs.readFileSync(s.keyFile, 'utf8');
  const loaded = (await owner.get('/api/settings')).json.key.fingerprints;
  writeKeyFile(s.keyFile, [newKey()]);
  try {
    const v = await until(async () => { const j = (await admin.get('/api/settings')).json; return j.key.problem ? j : null; });
    assert.match(v.key.problem, /cannot open \d+ stored secrets?; keeping the keys loaded before/);
    assert.deepEqual(v.key.fingerprints, loaded);
    assert.match(s.log(), /keeping the keys loaded before/);
  } finally {
    fs.writeFileSync(s.keyFile, good);
  }
  await until(async () => (await admin.get('/api/settings')).json.key.problem === null);
});

test('the server refuses to start without a usable key, and an environment key works (C86, C95)', async () => {
  await assert.rejects(startServer({ population: 40, env: { MVW_KEY_FILE: '' } }), /No key for stored secrets/);
  await assert.rejects(startServer({ population: 40, env: { MVW_KEY_FILE: 'relative/secret.key' } }), /must be an absolute path/);
  const tmp = tempDir('mvw-keyenv-');
  const data = tempDir('mvw-inside-');
  try {
    await assert.rejects(startServer({ population: 40, env: { MVW_KEY_FILE: path.join(tmp, 'k'), MVW_SECRET_KEY: newKey().toString('base64') } }),
      /Both MVW_SECRET_KEY and MVW_KEY_FILE are set/);
    await assert.rejects(startServer({ data, population: 40, env: { MVW_KEY_FILE: path.join(data, 'secret.key') } }), /inside the data folder/);
    assert.equal(fs.existsSync(path.join(data, 'secret.key')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
  const k = newKey();
  const e = await startServer({ population: 40, env: { MVW_SECRET_KEY: k.toString('base64') } });
  try {
    assert.match(e.log(), new RegExp(`\\[secrets\\] key ${fingerprint(k)} from MVW_SECRET_KEY`));
    assert.equal(e.log().includes(k.toString('base64')), false);
    assert.match(e.log(), / warn \[secrets\] the key comes from MVW_SECRET_KEY/, 'C101');
  } finally { await e.stop(); }
});

test('stored secrets the key cannot open stop the start until the right key is back or they are deleted (C88)', async () => {
  const a = await startServer({ population: 40, demo: true });   // no licence receipt: exactly the 2FA secrets
  const data = a.data, keyFile = a.keyFile;
  try {
    const o = await ownerSession(a);
    const m = await userSession(a, o, { login: 'tfuser', displayName: 'TF User' });
    const k = base32Decode((await m.post('/api/account/2fa/setup')).json.secret);
    assert.equal((await m.post('/api/account/2fa/enable', { code: totp(k, Date.now()) })).status, 200);
    await a.stop({ keepData: true });
    const good = fs.readFileSync(keyFile, 'utf8');
    writeKeyFile(keyFile, [newKey()]);
    await assert.rejects(startServer({ data, population: 40, env: { MVW_KEY_FILE: keyFile } }),
      /holds secrets this server cannot open: 2 sealed with key [0-9a-f]{12}[\s\S]*forget-secrets --unreadable/);
    fs.writeFileSync(keyFile, good);
    const back = await startServer({ data, population: 40, env: { MVW_KEY_FILE: keyFile } });
    await back.stop({ keepData: true });
    writeKeyFile(keyFile, [newKey()]);
    const f = spawnSync(process.execPath, ['tools/admin.mjs', 'forget-secrets', '--unreadable', '--data', data, '--key-file', keyFile], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(f.status, 0, f.stderr);
    assert.match(f.stdout, /Deleted 2 stored secrets/);
    const again = await startServer({ data, population: 40, env: { MVW_KEY_FILE: keyFile } });
    try {
      const r = await httpClient(again.url).post('/api/auth/signin', { login: 'tfuser', password: m.password });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.account.login, 'tfuser', 'it signs in with the password alone until it sets up two-factor again');
    } finally { await again.stop({ keepData: true }); }
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(keyFile, { force: true });
  }
});
