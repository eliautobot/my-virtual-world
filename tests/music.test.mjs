// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's music (server/music/music.js, 2026-10-23, the product owner: "some kind of way to add to the playlist ... a
// UI that can be interacted with when a player or user interacts with the jazz stage or the dj booth ... admin should
// have full control for now"): a stage's deck plays its family's approved songs only while the band or the DJ is there,
// requests first (one each, taken back when the band leaves early), a breath between the band's songs, the DJ's next
// track blended over the last seconds of the one before; its own playlist in order; a song removed leaves every list.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../server/db.js';
import { Music } from '../server/music/music.js';
import { hasFfmpeg, mp3Seconds } from '../server/music/audio.js';
import { MUSIC } from '../shared/music.js';

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-music-'));
  const dbs = openDb(dir);
  const world = { buildings: [{ idx: 0, floors: 2, lv: [0, 1] }], levels: [{ items: [] }, { items: [{ id: 7, t: 'lounge_stage' }, { id: 9, t: 'dj_stage' }, { id: 3, t: 'sofa' }] }] };
  let T = 1000;
  const sim = { agents: [], now: () => T };
  const sent = [];
  const music = new Music({ dbs, dataDir: dir, sim: () => sim, world: () => world, broadcast: m => sent.push(m), nameOf: id => `Player ${id}`, log: { error() {} } });
  const add = (title, genre, seconds = 120, status = 'approved', uploader = null) => {
    const file = music.newFileName(); fs.writeFileSync(path.join(music.dir, file), Buffer.alloc(64));
    return music.add({ file, seconds, title, artist: 'Test', genre, status, uploader, source: status === 'approved' ? 'library' : 'upload' });
  };
  const perform = (use, id) => { sim.agents = [{ i: 0, p: {}, act: { use, b: 0, f: 1, id, holdStart: 0, holdEnd: 1e12 } }]; };
  const leave = () => { sim.agents = []; };
  return { dir, dbs, world, sim, music, add, perform, leave, sent, setT: t => { T = t; } };
}

test('a lounge stage plays its own family\'s approved songs while the band is there, requests first', () => {
  const R = rig(), M = R.music;
  try {
    const a = R.add('Velvet Hour', 'jazz'), b = R.add('Copper Moon', 'piano'), c = R.add('Rio Lanterns', 'bossa');
    R.add('Neon Tide', 'house'); R.add('First Light', 'score'); R.add('Waiting', 'jazz', 100, 'pending', 5);
    const d = M.deckOf('0:1:7');
    assert.equal(d.family, 'lounge');
    assert.deepEqual(M.pool(d).map(t => t.title).sort(), ['Copper Moon', 'Rio Lanterns', 'Velvet Hour'], 'its family, approved, never the game\'s music');
    assert.equal(d.upcoming.length, 3);
    assert.equal(M.deckOf('0:1:3'), null, 'a sofa has no deck');
    assert.equal(M.deckOf('0:1:9').family, 'club');

    // no one on stage: nothing plays
    let t = Date.now();
    M.tick(t);
    assert.equal(d.now, null); assert.equal(d.live, false);
    // the band comes on: a song starts a moment later (everyone's browser loads it)
    R.perform('perform', 7); M.tick(t);
    assert.equal(d.live, true); assert.ok(d.now, 'a song');
    assert.equal(d.now.at, t + MUSIC.startDelay * 1000);
    const first = M.tracks.get(d.now.id);
    // a player asks for a song; asking again replaces it; requests come before the playlist
    const ask = d.upcoming.find(id => id !== first.id) || (first.id === a.id ? b.id : a.id);
    assert.equal(M.request(5, 'Ann', '0:1:7', ask).position, 1);
    assert.throws(() => M.request(6, 'Bo', '0:1:7', M.pool(d).find(x => x.genre === 'house')?.id || [...M.tracks.values()].find(x => x.genre === 'house').id), /isn't played/);
    assert.throws(() => M.request(6, 'Bo', '0:1:7', [...M.tracks.values()].find(x => x.status === 'pending').id), /waiting for review/);
    const other = [a, b, c].find(x => x.id !== ask && x.id !== first.id);
    assert.equal(M.request(5, 'Ann', '0:1:7', other.id).replaced, true);
    assert.equal(d.queue.length, 1); assert.equal(d.queue[0].id, other.id);
    assert.ok(!d.upcoming.includes(other.id) && !d.upcoming.includes(first.id), 'a song asked for, or on now, is not also next');
    // the song ends: a breath, then the request
    const end = d.now.at + first.seconds * 1000;
    M.tick(end - 5000); assert.equal(d.now.id, first.id, 'still the first song');
    M.tick(end + 1200);
    assert.equal(d.now.id, other.id); assert.equal(d.now.by, 5); assert.equal(d.now.name, 'Ann');
    assert.equal(d.now.at, end + MUSIC.loungeGap * 1000, 'the band takes a breath between songs');
    assert.equal(d.queue.length, 0);
    assert.equal(M.tracks.get(other.id).plays, 1);
    // the band leaves early in a request: a moment's gap (between one stretch at work and the next) plays on; gone longer
    // than MUSIC.grace, it goes back to the front, nothing plays
    const at = d.now.at, playing = d.now.id;
    M.tick(at + 10000); R.leave(); M.tick(at + 12000);
    assert.equal(d.now?.id, playing, 'a moment off the stage: the song goes on'); assert.equal(d.live, true);
    M.tick(at + 10000 + MUSIC.grace * 1000 + 1000);
    assert.equal(d.now, null); assert.equal(d.live, false);
    assert.equal(d.queue[0]?.id, other.id, 'the cut-short request waits for the band');
    // requests off: refused; on again
    M.configure('0:1:7', { requests: false });
    assert.throws(() => M.request(7, 'Cy', '0:1:7', a.id), /off/);
    M.configure('0:1:7', { requests: true });
  } finally { R.dbs.db.close(); fs.rmSync(R.dir, { recursive: true, force: true }); }
});

test('the DJ blends the next track over the end of the last; its own playlist plays in order; a deleted song leaves every list', () => {
  const R = rig(), M = R.music;
  try {
    const x = R.add('Neon Tide', 'house', 150), y = R.add('Concrete Pulse', 'techno', 150), z = R.add('Calle Luna', 'reggaeton', 150);
    R.add('Velvet Hour', 'jazz');
    const d = M.deckOf('0:1:9');
    // its own playlist, in order
    M.configure('0:1:9', { playlist: [z.id, x.id, y.id] });
    assert.deepEqual(d.upcoming, [z.id, x.id, y.id]);
    let t = Date.now();
    R.perform('dj', 9); M.tick(t);
    assert.equal(d.now.id, z.id);
    const end = d.now.at + 150000;
    M.tick(end - MUSIC.clubBlend * 1000 - 5000); assert.equal(d.now.id, z.id);
    M.tick(end - MUSIC.clubBlend * 1000 - 1000);
    assert.equal(d.now.id, x.id, 'the next track');
    assert.equal(d.now.at, end - MUSIC.clubBlend * 1000, 'starts under the end of the last one');
    assert.deepEqual({ id: d.prev.id, end: d.prev.end }, { id: z.id, end }, 'the last one plays out');
    // a genre night applies to all of its music, not to its own playlist; back to all
    M.configure('0:1:9', { playlist: null, genre: 'techno' });
    assert.deepEqual(M.pool(d).map(t => t.id), [y.id]);
    assert.throws(() => M.configure('0:1:9', { genre: 'jazz' }), /this stage/);
    // skip: the next one at once, the skipped one fades
    M.skip('0:1:9');
    assert.equal(d.now.id, y.id);
    // deleting a song takes it out of the queue, the playlist, the next songs
    M.configure('0:1:9', { genre: null, playlist: [x.id, y.id, z.id] });
    M.request(5, 'Ann', '0:1:9', z.id);
    M.remove(z.id);
    assert.ok(!d.queue.some(q => q.id === z.id) && !d.settings.playlist.includes(z.id) && !d.upcoming.includes(z.id));
    // the stage taken away: its deck goes with it
    R.world.levels[1].items = R.world.levels[1].items.filter(i => i.id !== 9);
    assert.equal(M.deckOf('0:1:9'), null);
    assert.ok(R.sent.some(m => m.t === 'music' && m.gone === '0:1:9'));
  } finally { R.dbs.db.close(); fs.rmSync(R.dir, { recursive: true, force: true }); }
});

test('decks and the library outlast a restart', () => {
  const R = rig();
  try {
    const a = R.add('Velvet Hour', 'jazz');
    R.music.configure('0:1:7', { requests: false, genre: 'jazz' });
    R.music.request(5, 'Ann', '0:1:9', R.add('Neon Tide', 'house').id);
    R.music.flush();
    const again = new Music({ dbs: R.dbs, dataDir: R.dir, sim: () => R.sim, world: () => R.world, log: { error() {} } });
    assert.equal(again.tracks.get(a.id).title, 'Velvet Hour');
    assert.deepEqual(again.decks.get('0:1:7').settings, { requests: false, genre: 'jazz', playlist: null });
    assert.equal(again.decks.get('0:1:9').queue[0].name, 'Ann');
  } finally { R.dbs.db.close(); fs.rmSync(R.dir, { recursive: true, force: true }); }
});

test('an MP3\'s length is read from its bytes (no ffmpeg needed)', { skip: !hasFfmpeg() && 'ffmpeg makes the test files' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-mp3-'));
  try {
    for (const [args, secs] of [[['-b:a', '128k'], 37], [['-q:a', '4'], 52]]) {   // constant and variable bitrate
      const f = path.join(dir, `t${secs}.mp3`);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${secs}`, '-c:a', 'libmp3lame', ...args, f]);
      const s = mp3Seconds(fs.readFileSync(f));
      assert.ok(Math.abs(s - secs) < 0.6, `${secs} s read as ${s}`);
    }
    assert.equal(mp3Seconds(Buffer.from('not an mp3 at all, just some text '.repeat(40))), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
