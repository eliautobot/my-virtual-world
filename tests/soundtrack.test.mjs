// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The game's own soundtrack (server/music/soundtrack.js, 2026-10-25): its songs go into a world's music library at start,
// each once, approved, as they are; a song an administrator deletes stays deleted; one already imported under the same
// key is not added twice; a later version's new songs come with the next start; the server does it unless
// MVW_SOUNDTRACK=off. And the soundtrack itself: every song listed is there, playable, with its licence.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { Music } from '../server/music/music.js';
import { mp3Seconds } from '../server/music/audio.js';
import { seedSoundtrack, SOUNDTRACK_DIR } from '../server/music/soundtrack.js';
import { GENRES, MUSIC } from '../shared/music.js';
import { startServer, ownerSession, tempDir } from './helpers/server.mjs';

const LIST = JSON.parse(fs.readFileSync(path.join(SOUNDTRACK_DIR, 'soundtrack.json'), 'utf8')).tracks;
const quiet = { info() {}, warn() {}, error() {} };

test('the soundtrack: every song listed is there, an MP3 of a library song\'s length, in a known genre, with its own key and its licence', () => {
  assert.ok(LIST.length >= 20, `${LIST.length} songs`);
  assert.equal(new Set(LIST.map(e => e.key)).size, LIST.length, 'one key each');
  for (const e of LIST) {
    assert.ok(GENRES[e.genre], `${e.title}: genre ${e.genre}`);
    assert.ok(e.title && e.artist, e.file);
    const secs = mp3Seconds(fs.readFileSync(path.join(SOUNDTRACK_DIR, e.file)));
    assert.ok(secs >= MUSIC.minSeconds && secs <= MUSIC.maxSeconds, `${e.file}: ${secs} s`);
    if (e.loop) assert.ok(e.loop[0] >= 0 && e.loop[0] < e.loop[1] && e.loop[1] <= secs + 0.1, `${e.file}: loop ${e.loop}`);
  }
  const licence = fs.readFileSync(path.join(SOUNDTRACK_DIR, 'LICENSE.md'), 'utf8');
  assert.match(licence, /inside My Virtual\s+World/);
  assert.match(fs.readFileSync(new URL('../ASSETS-LICENSE.md', import.meta.url), 'utf8'), /server\/music\/soundtrack/, 'the assets licence leaves it out');
});

test('the songs go in once, approved, as they are; a deleted one stays deleted; a later version\'s new ones come next start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-soundtrack-')), st = path.join(dir, 'soundtrack');
  try {
    // a small soundtrack of three of the real songs (one with loop points), then a fourth in a "later version"
    const pick = [LIST.find(e => e.loop), ...LIST.filter(e => !e.loop).slice(0, 3)];
    for (const e of pick) { fs.mkdirSync(path.join(st, path.dirname(e.file)), { recursive: true }); fs.copyFileSync(path.join(SOUNDTRACK_DIR, e.file), path.join(st, e.file)); }
    const write = n => fs.writeFileSync(path.join(st, 'soundtrack.json'), JSON.stringify({ tracks: pick.slice(0, n) }));
    write(3);
    const dbs = openDb(path.join(dir, 'data'));
    const open = () => new Music({ dbs, dataDir: path.join(dir, 'data'), sim: () => null, world: () => null, log: quiet });
    let M = open();
    assert.deepEqual(seedSoundtrack(M, { dir: st, log: quiet }), { added: 3, taken: 3, failed: 0 });
    const songs = [...M.tracks.values()];
    assert.equal(songs.length, 3);
    for (const t of songs) {
      const e = pick.find(x => x.key === t.meta.key);
      assert.ok(e, 'its key kept');
      assert.equal(t.status, 'approved'); assert.equal(t.source, 'import'); assert.equal(t.meta.soundtrack, true); assert.equal(t.title, e.title); assert.equal(t.genre, e.genre);
      assert.match(t.rights, /inside My Virtual World only/);
      assert.deepEqual(fs.readFileSync(path.join(M.dir, t.file)), fs.readFileSync(path.join(st, e.file)), 'the file as it is');
      assert.deepEqual(t.loop, e.loop || null);
    }
    // again (a restart): nothing new
    M = open();
    assert.equal(seedSoundtrack(M, { dir: st, log: quiet }).added, 0);
    assert.equal(M.tracks.size, 3);
    // an administrator deletes one: it stays deleted
    const gone = songs[0].meta.key;
    M.remove(songs[0].id);
    M = open();
    assert.equal(seedSoundtrack(M, { dir: st, log: quiet }).added, 0);
    assert.ok(![...M.tracks.values()].some(t => t.meta?.key === gone));
    // a later version adds a song: it comes with the next start
    write(4);
    M = open();
    assert.deepEqual(seedSoundtrack(M, { dir: st, log: quiet }), { added: 1, taken: 4, failed: 0 });
    assert.equal(M.tracks.size, 3);
    dbs.db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a song the library already has under the same key (tools/music-import.mjs) is taken, not added twice; a broken one is skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-soundtrack-')), st = path.join(dir, 'soundtrack');
  try {
    const [a, b] = LIST.filter(e => !e.loop);
    fs.mkdirSync(path.join(st, path.dirname(a.file)), { recursive: true });
    fs.copyFileSync(path.join(SOUNDTRACK_DIR, a.file), path.join(st, a.file));
    fs.mkdirSync(path.join(st, path.dirname(b.file)), { recursive: true });
    fs.writeFileSync(path.join(st, b.file), Buffer.alloc(5000));   // (not an MP3)
    fs.writeFileSync(path.join(st, 'soundtrack.json'), JSON.stringify({ tracks: [a, b] }));
    const dbs = openDb(path.join(dir, 'data'));
    const M = new Music({ dbs, dataDir: path.join(dir, 'data'), sim: () => null, world: () => null, log: quiet });
    const file = M.newFileName(); fs.copyFileSync(path.join(st, a.file), path.join(M.dir, file));
    M.add({ file, seconds: 60, title: a.title, artist: a.artist, genre: a.genre, source: 'import', status: 'approved', meta: { key: a.key } });
    assert.deepEqual(seedSoundtrack(M, { dir: st, log: quiet }), { added: 0, taken: 1, failed: 1 });
    assert.equal(M.tracks.size, 1);
    assert.deepEqual(fs.readdirSync(M.dir), [file], 'no file left behind');
    dbs.db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the server adds the soundtrack at start (MVW_SOUNDTRACK on); the tests\' servers leave the library alone', async () => {
  const dir = tempDir('mvw-soundtrack-http-');
  let s;
  try {
    s = await startServer({ data: path.join(dir, 'data'), population: 60, env: { MVW_SOUNDTRACK: 'on' } });
    const owner = await ownerSession(s);
    const lib = (await owner.get('/api/music/library')).json.tracks;
    assert.equal(lib.length, LIST.length);
    assert.deepEqual(lib.map(t => t.title).sort(), LIST.map(e => e.title).sort());
    await s.stop(); s = null;
    s = await startServer({ data: path.join(dir, 'data2'), population: 60 });
    assert.equal((await (await ownerSession(s)).get('/api/music/library')).json.tracks.length, 0);
  } finally { await s?.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
