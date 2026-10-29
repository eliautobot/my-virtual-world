// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Rolling back across an accounts-database schema change (DECISIONS C84): the schema number is lowered when every newer
// migration only added things, an older release's writes still work, and migrating forward again is harmless.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { openDb, downgradeSchema, SCHEMA_VERSION, MIGRATION_INFO } from '../server/db.js';
import { Audit } from '../server/auth/audit.js';
import { DatabaseSync } from '../server/sqlite.js';
import { ROOT, tempDir } from './helpers/server.mjs';

const tool = (...args) => spawnSync(process.execPath, ['tools/deploy/dbschema.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });

test('the current database goes back to schema 2 with nothing lost, takes an older release\'s writes, and migrates forward again', () => {
  const dir = tempDir('mvw-schema-');
  try {
    let s = openDb(dir);
    assert.equal(SCHEMA_VERSION, 57);
    assert.ok(MIGRATION_INFO.slice(1).every(m => m.additive), 'every migration after the first only adds things');
    const now = Date.now();
    s.db.prepare(`INSERT INTO accounts (world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated)
      VALUES (?, 'owner', 'Owner', 'owner', 'owner', 'x', ?, ?, ?)`).run(s.worldId, now, now, now);
    new Audit(s).log('auth.signin', { actor: { id: 1, login: 'owner' } });
    s.db.prepare("INSERT INTO account_settings (account_id, world_id, key, value, updated) VALUES (1, ?, 'display.labels', 'false', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO mind_jobs (world_id, agent_id, kind, at, status) VALUES (?, 1, 'problem', ?, 'ok')").run(s.worldId, now);
    s.db.prepare("INSERT INTO account_plans (world_id, account_id, tier, status, started, updated) VALUES (?, 1, 'plus', 'active', ?, ?)").run(s.worldId, now, now);
    s.db.prepare("INSERT INTO chat_sessions (world_id, agent_id, account_id, native_key, label, created, updated, model, effort) VALUES (?, 1, 1, '@new', 'Taxes', ?, ?, 'm1', 'high')").run(s.worldId, now, now);
    s.db.prepare("INSERT INTO chat_messages (world_id, account_id, agent_id, session_id, role, text, ts) VALUES (?, 1, 1, 1, 'user', 'quarterly estimated taxes', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO notifications (world_id, account_id, kind, title, created) VALUES (?, 1, 'note', 'Hello', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO account_ai_usage (world_id, account_id, month, voice_seconds, voice_micro, updated) VALUES (?, 1, '2026-10', 75.5, 900, ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO voice_prefs (world_id, account_id, prefs_json, updated) VALUES (?, 1, '{\"listen\":{\"language\":\"en\"}}', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO chat_projects (world_id, account_id, agent_id, name, instructions, created, updated) VALUES (?, 1, 1, 'Bakery', 'In Spanish', ?, ?)").run(s.worldId, now, now);
    // the chat window's own transparency, as a release before the theme's kept it (half of its background kept)
    s.db.prepare("INSERT INTO account_settings (account_id, world_id, key, value, updated) VALUES (1, ?, 'display.chatOpacity', '\"50\"', ?)").run(s.worldId, now);
    // an agent's work: its brief, a note it kept, a file it knows, a chat in Life
    s.db.prepare("INSERT INTO agent_work (world_id, agent_id, brief_json, updated) VALUES (?, 1, '{\"company\":\"Acme\"}', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO agent_work_notes (world_id, agent_id, text, source, created) VALUES (?, 1, 'Reports on Friday', 'agent', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO agent_work_files (world_id, agent_id, sha256, name, mime, size, kind, text, created) VALUES (?, 1, 'ab', 'faq.txt', 'text/plain', 3, 'text', 'faq', ?)").run(s.worldId, now);
    s.db.prepare("UPDATE chat_sessions SET mode = 'life'").run();
    // a talk in the city and an owner's block
    s.db.prepare("INSERT INTO chat_sessions (world_id, agent_id, account_id, native_key, label, created, updated, kind) VALUES (?, 1, 1, '@new', 'Talk with an agent', ?, ?, 'talk')").run(s.worldId, now, now);
    s.db.prepare('INSERT INTO talk_blocks (world_id, owner_id, account_id, agent_id, created) VALUES (?, 1, 7, NULL, ?)').run(s.worldId, now);
    // the People page's note on an account, and a paying account's Stripe customer
    s.db.prepare("INSERT INTO account_notes (world_id, account_id, note, tags, updated) VALUES (?, 1, 'Met at launch', 'vip', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO commerce_customers (world_id, account_id, mode, customer, created) VALUES (?, 1, 'test', 'cus_1', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO commerce_gifts (id, world_id, code, batch, created) VALUES ('gift_1', ?, 'ABCDEFGH', 'early', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO mcp_grants (world_id, account_id, agent_id, client_id, client_name, scope, resource, created) VALUES (?, 1, 1, 'mvwc_1', 'Grok', 'agent', 'https://w.example/mcp', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO agent_wakeups (world_id, slot_id, sealed, host, events, per_hour, updated) VALUES (?, 1, 'v1:x', 'hooks.example.com', '{}', 6, ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO agent_slots (world_id, account_id, name, name_key, created, updated, app) VALUES (?, 1, 'Nova', 'nova', ?, ?, 'grok-bot')").run(s.worldId, now, now);
    s.db.prepare("INSERT INTO play_best (world_id, module, course, account_id, score, ms, stars, at) VALUES (?, 'airport', 'first-flight', 1, 90.5, 90500, 2, ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO play_badges (world_id, account_id, badge, at) VALUES (?, 1, 'airborne', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO homesteads (id, world_id, lot_id, account_id, status, claimed, due) VALUES ('hst_1', ?, 'L00001', 1, 'open', ?, ?)").run(s.worldId, now, now + 14 * 86400e3);
    s.db.prepare("INSERT INTO brain_trials (world_id, account_id, ended_noted) VALUES (?, 1, ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO inv_items (world_id, owner, item, qty, held, attrs, got) VALUES (?, 'account:1', 'fish:redsnapper', 1, 0, '{\"cm\":52}', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO fish_dex (world_id, account_id, species, n, best_kg, best_cm, first_at, best_at) VALUES (?, 1, 'redsnapper', 2, 2.1, 52, ?, ?)").run(s.worldId, now, now);
    s.db.prepare("INSERT INTO phone_lines (world_id, agent_id, connection_id, number, number_sid, created, updated) VALUES (?, 1, 1, '+18885550100', 'PNx', ?, ?)").run(s.worldId, now, now);
    s.db.prepare("INSERT INTO phone_takeovers (world_id, line_id, peer, since) VALUES (?, 1, '+15552010042', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO mind_jobs (world_id, agent_id, kind, at, status) VALUES (?, 1, 'work', ?, 'ok')").run(s.worldId, now);
    s.db.prepare("INSERT INTO music_tracks (id, world_id, title, artist, genre, seconds, file, bytes, source, status, created, updated) VALUES ('t1', ?, 'Velvet Hour', 'MVW Originals', 'jazz', 154, 'a.mp3', 100, 'import', 'approved', ?, ?)").run(s.worldId, now, now);
    s.db.prepare("INSERT INTO music_decks (world_id, place, state_json, updated) VALUES (?, '1:1:7', '{\"family\":\"lounge\"}', ?)").run(s.worldId, now);
    s.db.prepare("INSERT INTO ou_cookbook (world_id, cook_id, item, n, best, first_at, best_at) VALUES (?, 1, 'latte', 3, 96, ?, ?)").run(s.worldId, now, now);
    assert.deepEqual(downgradeSchema(s.db, 56), { ok: true, from: 57, to: 56, changed: true }, 'what releases before the sound\'s new defaults need');
    assert.deepEqual(downgradeSchema(s.db, 55), { ok: true, from: 56, to: 55, changed: true }, 'what releases before Order Up\'s cooks and Cookbook need');
    assert.deepEqual(downgradeSchema(s.db, 54), { ok: true, from: 55, to: 54, changed: true }, 'what releases before the city\'s music need');
    assert.deepEqual(downgradeSchema(s.db, 53), { ok: true, from: 54, to: 53, changed: true }, 'what releases before agents\' work sessions on their PC need');
    assert.deepEqual(downgradeSchema(s.db, 52), { ok: true, from: 53, to: 52, changed: true }, 'what releases before the person takes over a phone need');
    assert.deepEqual(downgradeSchema(s.db, 51), { ok: true, from: 52, to: 51, changed: true }, 'what releases before agents\' phones need');
    assert.deepEqual(downgradeSchema(s.db, 50), { ok: true, from: 51, to: 50, changed: true }, 'what releases before the angler\'s gear and Fishdex need');
    assert.deepEqual(downgradeSchema(s.db, 49), { ok: true, from: 50, to: 49, changed: true }, 'what releases before the inventory need');
    assert.deepEqual(downgradeSchema(s.db, 48), { ok: true, from: 49, to: 48, changed: true }, 'what releases before the world\'s brain for new players need');
    assert.deepEqual(downgradeSchema(s.db, 47), { ok: true, from: 48, to: 47, changed: true }, 'what releases before free lots need');
    assert.deepEqual(downgradeSchema(s.db, 46), { ok: true, from: 47, to: 46, changed: true }, 'what releases before play modules need');
    assert.deepEqual(downgradeSchema(s.db, 45), { ok: true, from: 46, to: 45, changed: true }, 'what releases before each agent had its own MCP address need');
    assert.deepEqual(downgradeSchema(s.db, 44), { ok: true, from: 45, to: 44, changed: true }, 'what releases before third-party agents knew their app need');
    assert.deepEqual(downgradeSchema(s.db, 43), { ok: true, from: 44, to: 43, changed: true }, 'what releases before wake-up links need');
    assert.deepEqual(downgradeSchema(s.db, 42), { ok: true, from: 43, to: 42, changed: true }, 'what releases before connections waited for their owner\'s OK need');
    assert.deepEqual(downgradeSchema(s.db, 41), { ok: true, from: 42, to: 41, changed: true }, 'what releases before agents started conversations need');
    assert.deepEqual(downgradeSchema(s.db, 40), { ok: true, from: 41, to: 40, changed: true }, 'what releases before the Mind answered friends need');
    assert.deepEqual(downgradeSchema(s.db, 39), { ok: true, from: 40, to: 39, changed: true }, 'what releases before agents and friends need');
    assert.deepEqual(downgradeSchema(s.db, 38), { ok: true, from: 39, to: 38, changed: true }, 'what releases before AI apps need');
    assert.deepEqual(downgradeSchema(s.db, 37), { ok: true, from: 38, to: 37, changed: true }, 'what releases before gift codes need');
    assert.deepEqual(downgradeSchema(s.db, 36), { ok: true, from: 37, to: 36, changed: true }, 'what releases before the People page need');
    assert.deepEqual(downgradeSchema(s.db, 35), { ok: true, from: 36, to: 35, changed: true }, 'what releases before signing in with Google need');
    assert.deepEqual(downgradeSchema(s.db, 34), { ok: true, from: 35, to: 34, changed: true }, 'what releases before account emails need');
    assert.deepEqual(downgradeSchema(s.db, 33), { ok: true, from: 34, to: 33, changed: true }, 'what releases before the realty market need');
    assert.deepEqual(downgradeSchema(s.db, 32), { ok: true, from: 33, to: 32, changed: true }, 'what releases before talking in the city need');
    assert.deepEqual(downgradeSchema(s.db, 31), { ok: true, from: 32, to: 31, changed: true }, 'what releases before an agent\'s work need');
    s.db.prepare("INSERT INTO chat_sessions (world_id, agent_id, account_id, native_key, label, created, updated) VALUES (?, 1, 1, '@new', 'Older', ?, ?)").run(s.worldId, now, now);
    assert.deepEqual(downgradeSchema(s.db, 30), { ok: true, from: 31, to: 30, changed: true }, 'what releases before the theme\'s transparency need');
    s.db.exec("DELETE FROM account_settings WHERE key = 'display.transparency'");   // (as such a release would have it)
    assert.deepEqual(downgradeSchema(s.db, 29), { ok: true, from: 30, to: 29, changed: true }, 'what releases before chat projects need');
    assert.deepEqual(downgradeSchema(s.db, 28), { ok: true, from: 29, to: 28, changed: true }, 'what releases before voice need');
    assert.deepEqual(downgradeSchema(s.db, 27), { ok: true, from: 28, to: 27, changed: true }, 'what releases before notifications need');
    assert.deepEqual(downgradeSchema(s.db, 26), { ok: true, from: 27, to: 26, changed: true }, 'what releases before the chat window need');
    assert.deepEqual(downgradeSchema(s.db, 25), { ok: true, from: 26, to: 25, changed: true }, 'what releases before plans need');
    assert.deepEqual(downgradeSchema(s.db, 24), { ok: true, from: 25, to: 24, changed: true }, 'what releases before the Mind handled problems need');
    assert.deepEqual(downgradeSchema(s.db, 23), { ok: true, from: 24, to: 23, changed: true }, 'what releases before the Mind need');
    assert.deepEqual(downgradeSchema(s.db, 22), { ok: true, from: 23, to: 22, changed: true }, 'what releases before Free Will chose more than free time need');
    assert.deepEqual(downgradeSchema(s.db, 21), { ok: true, from: 22, to: 21, changed: true }, 'what releases before agents\' profiles and memories need');
    assert.deepEqual(downgradeSchema(s.db, 20), { ok: true, from: 21, to: 20, changed: true }, 'what releases before Free Will need');
    assert.deepEqual(downgradeSchema(s.db, 11), { ok: true, from: 20, to: 11, changed: true }, 'what releases before WP4\'s world store need (they read the world.json export)');
    assert.deepEqual(downgradeSchema(s.db, 10), { ok: true, from: 11, to: 10, changed: true }, 'what releases before WP4\'s property store need');
    assert.deepEqual(downgradeSchema(s.db, 9), { ok: true, from: 10, to: 9, changed: true }, 'what releases 2.0.0-alpha.10 to 2.0.0-alpha.11.2 need');
    assert.deepEqual(downgradeSchema(s.db, 8), { ok: true, from: 9, to: 8, changed: true }, 'what release 2.0.0-alpha.9 needs');
    assert.deepEqual(downgradeSchema(s.db, 7), { ok: true, from: 8, to: 7, changed: true }, 'what releases 2.0.0-alpha.6 to 2.0.0-alpha.8 need');
    assert.deepEqual(downgradeSchema(s.db, 6), { ok: true, from: 7, to: 6, changed: true }, 'what release 2.0.0-alpha.5 needs');
    assert.deepEqual(downgradeSchema(s.db, 5), { ok: true, from: 6, to: 5, changed: true }, 'what release 2.0.0-alpha.3 needs');
    assert.deepEqual(downgradeSchema(s.db, 4), { ok: true, from: 5, to: 4, changed: true }, 'what release 1.3 needs');
    assert.deepEqual(downgradeSchema(s.db, 3), { ok: true, from: 4, to: 3, changed: true }, 'what release 1.2 needs');
    assert.deepEqual(downgradeSchema(s.db, 2), { ok: true, from: 3, to: 2, changed: true });
    s.close();
    const raw = new DatabaseSync(path.join(dir, 'next.db'));
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 2, 'what a release knowing schema 2 checks');
    raw.prepare(`INSERT INTO sessions (world_id, token_hash, account_id, csrf, created, last_seen, auth_at, ip, user_agent)
      VALUES ((SELECT value FROM meta WHERE key = 'world_id'), 'h1', 1, 'c', ?, ?, ?, NULL, 'old release')`).run(now, now, now);
    assert.equal(raw.prepare('SELECT needs_twofa FROM sessions').get().needs_twofa, 0, 'the added column has a default');
    raw.close();
    s = openDb(dir);   // the newer release again: migrates 2 -> 57 over the tables that already exist
    assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 57);
    assert.equal(s.db.prepare('SELECT best FROM ou_cookbook').get().best, 96, 'the Cookbook survived');
    assert.equal(s.db.prepare('SELECT title FROM music_tracks').get().title, 'Velvet Hour', 'the music library survived');
    assert.equal(s.db.prepare('SELECT peer FROM phone_takeovers').get().peer, '+15552010042', 'a take-over survived');
    assert.equal(s.db.prepare('SELECT number FROM phone_lines').get().number, '+18885550100', 'a phone survived');
    assert.equal(s.db.prepare('SELECT n FROM fish_dex').get().n, 2, 'the Fishdex survived');
    assert.equal(s.db.prepare('SELECT item FROM inv_items').get().item, 'fish:redsnapper', 'the inventory survived');
    assert.equal(s.db.prepare('SELECT score FROM play_best').get().score, 90.5, 'a best result survived');
    assert.deepEqual({ ...s.db.prepare('SELECT note, tags FROM account_notes').get() }, { note: 'Met at launch', tags: 'vip' }, 'the People page\'s notes survived');
    assert.equal(s.db.prepare('SELECT customer FROM commerce_customers').get().customer, 'cus_1', 'the Stripe customer survived');
    assert.equal(s.db.prepare('SELECT code FROM commerce_gifts').get().code, 'ABCDEFGH', 'the gift codes survived');
    assert.equal(s.db.prepare('SELECT client_name FROM mcp_grants').get().client_name, 'Grok', 'the AI apps\' grants survived');
    assert.equal(s.db.prepare("SELECT value FROM account_settings WHERE key = 'display.transparency'").get()?.value, '50', 'the chat window\'s transparency became the theme\'s');
    assert.equal(s.db.prepare('SELECT instructions FROM chat_projects').get().instructions, 'In Spanish', 'the projects survived');
    assert.equal(s.db.prepare('SELECT brief_json FROM agent_work').get().brief_json, '{"company":"Acme"}', 'the brief survived');
    assert.equal(s.db.prepare('SELECT text FROM agent_work_notes').get().text, 'Reports on Friday', 'the work notes survived');
    assert.equal(s.db.prepare('SELECT text FROM agent_work_files').get().text, 'faq', 'the files it knows survived');
    assert.deepEqual(s.db.prepare('SELECT label, mode, kind FROM chat_sessions ORDER BY id').all().map(r => [r.label, r.mode, r.kind]), [['Taxes', 'life', null], ['Talk with an agent', null, 'talk'], ['Older', null, null]], 'a chat\'s mode and a talk survived; an older release\'s chat has neither');
    assert.equal(s.db.prepare('SELECT account_id FROM talk_blocks').get().account_id, 7, 'the block survived');
    assert.deepEqual({ ...s.db.prepare('SELECT voice_seconds, voice_micro FROM account_ai_usage').get() }, { voice_seconds: 75.5, voice_micro: 900 }, 'the voice meter survived');
    assert.match(s.db.prepare('SELECT prefs_json FROM voice_prefs').get().prefs_json, /"en"/, 'the voice choices survived');
    assert.equal(s.db.prepare('SELECT title FROM notifications').get().title, 'Hello', 'the notifications survived');
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM chat_messages_fts WHERE chat_messages_fts MATCH 'quarter*'").get().n, 1, 'the chat messages and their search survived');
    assert.equal(s.db.prepare('SELECT effort FROM chat_sessions').get().effort, 'high', 'a session\'s own effort survived');
    assert.equal(s.db.prepare('SELECT tier FROM account_plans').get().tier, 'plus', 'the plans survived');
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM mind_jobs WHERE kind = 'problem'").get().n, 1, 'mind_jobs rebuilt once, its rows kept');
    const audit = new Audit(s);
    assert.equal(audit.list().length, 1, 'the audit event survived');
    assert.equal(audit.verify().ok, true);
    assert.throws(() => s.db.exec('DELETE FROM audit'), /append-only/, 'the triggers are still there');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    assert.equal(s.db.prepare("SELECT value FROM account_settings WHERE key = 'display.labels'").get().value, 'false', 'the account settings survived');
    s.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a migration that changed existing data blocks the downgrade', () => {
  const dir = tempDir('mvw-schema-');
  try {
    const s = openDb(dir);
    const info = MIGRATION_INFO.map(m => (m.version === 3 ? { ...m, additive: false } : m));
    const r = downgradeSchema(s.db, 2, info);
    assert.equal(r.ok, false);
    assert.match(r.why, /migration 3 changed existing data/);
    assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 57, 'nothing changed');
    assert.deepEqual(downgradeSchema(s.db, 57), { ok: true, from: 57, to: 57, changed: false });
    s.db.exec('PRAGMA user_version = 99');
    assert.match(downgradeSchema(s.db, 2).why, /newer than this tool knows/);
    s.db.exec('PRAGMA user_version = 42');
    s.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('tools/deploy/dbschema.mjs: version, release-schema, downgrade', () => {
  const dir = tempDir('mvw-schema-');
  try {
    openDb(dir).close();
    const db = path.join(dir, 'next.db');
    assert.equal(tool('version', db).stdout.trim(), String(SCHEMA_VERSION));
    assert.equal(tool('release-schema', ROOT).stdout.trim(), String(SCHEMA_VERSION));
    assert.equal(tool('release-schema', dir).stdout.trim(), '0', 'a folder without server/db.js');
    const d = tool('downgrade', db, '2');
    assert.equal(d.status, 0, d.stderr);
    assert.match(d.stdout, new RegExp(`schema ${SCHEMA_VERSION} -> 2`));
    assert.equal(tool('version', db).stdout.trim(), '2');
    assert.equal(tool('downgrade', db, 'x').status, 2);
    assert.equal(tool('version', path.join(dir, 'missing.db')).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
