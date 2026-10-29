// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The sound's defaults (2026-10-29, shared/sound-defaults.js): the server's settings start from them, and accounts that
// still had the first defaults stored move to them once (server/db.js v57); a volume a player changed stays theirs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { openDb, SCHEMA_VERSION } from '../server/db.js';
import { SETTINGS } from '../server/settings.js';
import { SOUND_DEFAULTS } from '../shared/sound-defaults.js';
import { tempDir } from './helpers/server.mjs';

test('the server\'s sound settings start from the shared defaults', () => {
  for (const [k, v] of Object.entries(SOUND_DEFAULTS)) assert.equal(SETTINGS.find(e => e.path === `sound.${k}`)?.default, v, k);
  assert.deepEqual(SOUND_DEFAULTS, { master: 100, world: 15, aircraft: 50, voices: 85, media: 35, music: 30, score: 15, effects: 10, vehicles: 10, radio: 30 });
});

test('stored volumes still at the first defaults move to the new ones once; chosen ones stay', () => {
  const dir = tempDir('mvw-sound-');
  try {
    let s = openDb(dir);
    const now = Date.now(), put = (acc, key, value) => s.db.prepare('INSERT INTO account_settings (account_id, world_id, key, value, updated) VALUES (?, ?, ?, ?, ?)').run(acc, s.worldId, key, value, now);
    for (const [acc, login] of [[1, 'old'], [2, 'tuned']]) s.db.prepare(`INSERT INTO accounts (id, world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated)
      VALUES (?, ?, ?, ?, ?, 'member', 'x', ?, ?, ?)`).run(acc, s.worldId, login, login, login, now, now, now);
    // an account that signed in once: the first defaults stored as they were
    for (const [k, v] of Object.entries({ master: 100, world: 70, aircraft: 70, voices: 100, media: 100, music: 80, score: 40, effects: 80, vehicles: 80, radio: 70 })) put(1, `sound.${k}`, String(v));
    // an account that tuned some: its own levels, the rest left where they were
    for (const [k, v] of Object.entries({ master: 70, effects: 20, vehicles: 45, radio: 70, world: 45 })) put(2, `sound.${k}`, String(v));
    put(2, 'display.labels', 'false');
    s.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
    s.close();
    s = openDb(dir);   // v57 runs over them
    const of = acc => Object.fromEntries(s.db.prepare("SELECT key, value FROM account_settings WHERE account_id = ? AND key LIKE 'sound.%'").all(acc).map(r => [r.key.slice(6), Number(JSON.parse(r.value))]));
    assert.deepEqual(of(1), SOUND_DEFAULTS, 'untouched: all the new defaults');
    assert.deepEqual(of(2), { master: 70, effects: 20, vehicles: 45, radio: 30, world: 45 }, 'chosen levels stay; the radio, still at its first default, moves');
    assert.equal(s.db.prepare("SELECT value FROM account_settings WHERE account_id = 2 AND key = 'display.labels'").get().value, 'false', 'other settings untouched');
    s.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
