// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's music over HTTP (server/music/routes.js, docs/features/music.md): an administrator's song goes straight
// into the library, a player's waits for review (only they and administrators see it, it can't be asked for); the
// rights must be confirmed; files stream with byte ranges; anyone watching sees a stage's deck; a member asks for a song
// at a lounge's stage (one each) and takes it back; only administrators run a stage (requests, genre, playlist, skip,
// clear) and review; a player deletes their own song only while it waits.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, ownerSession, userSession, httpClient, tempDir } from './helpers/server.mjs';
import { hasFfmpeg } from '../server/music/audio.js';

const ok = hasFfmpeg();
let s, owner, ann, bo, guest, dir, mp3a, mp3b, wav, place;

before(async () => {
  if (!ok) return;
  dir = tempDir('mvw-music-http-');
  const make = (name, secs, args) => { const f = path.join(dir, name); execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`, ...args, f]); return fs.readFileSync(f); };
  mp3a = make('a.mp3', 40, ['-c:a', 'libmp3lame', '-b:a', '128k']);
  mp3b = make('b.mp3', 45, ['-c:a', 'libmp3lame', '-b:a', '128k']);
  wav = make('c.wav', 35, ['-c:a', 'pcm_s16le']);
  s = await startServer({ data: path.join(dir, 'data'), population: 80 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  bo = await userSession(s, owner, { login: 'bo', displayName: 'Bo', role: 'member' });
  guest = httpClient(s.url);
  // a lounge on an office's second floor (its Lounge Stage)
  const W = (await owner.get('/api/world')).json.world;
  const B = W.buildings.find(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3 && b.w >= 18);
  assert.equal((await owner.post('/api/edit', { ops: [{ op: 'lvl.theme', b: B.idx, f: 1, theme: 'lounge' }] })).status, 200);
  const W2 = (await owner.get('/api/world')).json.world, stage = W2.levels[W2.buildings[B.idx].lv[1]].items.find(i => i.t === 'lounge_stage');
  assert.ok(stage, 'the lounge has a stage');
  place = `${B.idx}:1:${stage.id}`;
});
after(async () => { await s?.stop(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

const up = (who, buf, q, type = 'audio/mpeg') => who.post(`/api/music/upload?${new URLSearchParams(q)}`, buf, { 'content-type': type });

test('songs: an administrator\'s go straight into the library, a player\'s wait for review', { skip: !ok && 'needs ffmpeg' }, async () => {
  let r = await up(owner, mp3a, { title: 'Velvet Test', artist: 'House Band', genre: 'jazz' });
  assert.equal(r.status, 200, r.text); const a = r.json.track;
  assert.equal(a.status, 'approved'); assert.ok(Math.abs(a.seconds - 40) < 1, `${a.seconds}`);
  r = await up(owner, wav, { title: 'Bossa Test', genre: 'bossa' }, 'audio/wav');
  assert.equal(r.status, 200, r.text); assert.ok(Math.abs(r.json.track.seconds - 35) < 1, 'a WAV converted to MP3');
  // a player: the rights first, then it waits
  assert.equal((await up(ann, mp3b, { title: 'Ann Song', genre: 'jazz' })).json.code, 'rights_required');
  assert.equal((await up(ann, mp3b, { title: 'Game', genre: 'score', rights: '1' })).json.code, 'bad_genre', 'only administrators add the game\'s music');
  assert.equal((await up(ann, Buffer.from('x'.repeat(5000)), { title: 'Junk', genre: 'jazz', rights: '1' })).json.code, 'bad_audio');
  r = await up(ann, mp3b, { title: 'Ann Song', genre: 'jazz', rights: '1', explicit: '1' });
  assert.equal(r.status, 200, r.text); const p = r.json.track;
  assert.equal(p.status, 'pending'); assert.equal(p.explicit, true); assert.equal(p.mine, true);
  assert.equal((await up(guest, mp3b, { title: 'Nope', genre: 'jazz', rights: '1' })).status, 401);
  // who sees what
  const titles = async who => (await who.get('/api/music/library')).json.tracks.map(t => t.title).sort();
  assert.deepEqual(await titles(guest), ['Bossa Test', 'Velvet Test']);
  assert.deepEqual(await titles(bo), ['Bossa Test', 'Velvet Test']);
  assert.deepEqual(await titles(ann), ['Ann Song', 'Bossa Test', 'Velvet Test']);
  assert.deepEqual(await titles(owner), ['Ann Song', 'Bossa Test', 'Velvet Test']);
  // its file: the uploader and administrators until approved; a byte range streams
  assert.equal((await bo.get(`/api/music/file/${p.id}`)).status, 404);
  assert.equal((await ann.get(`/api/music/file/${p.id}`)).status, 200);
  const part = await guest.get(`/api/music/file/${a.id}`, { range: 'bytes=1000-1999' });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-type'), 'audio/mpeg'); assert.match(part.headers.get('content-range'), /^bytes 1000-1999\//);
  // the review: only administrators; approved, everyone sees it
  assert.equal((await bo.post('/api/music/review', { id: p.id, approve: true })).status, 403);
  r = await owner.post('/api/music/review', { id: p.id, approve: true });
  assert.equal(r.json.track.status, 'approved');
  assert.ok((await titles(bo)).includes('Ann Song'));
  // a rejected one tells its uploader why; they may delete it, not someone else's approved one
  const q = (await up(bo, mp3a, { title: 'Bo Song', genre: 'house', rights: '1' })).json.track;
  r = await owner.post('/api/music/review', { id: q.id, approve: false, reason: 'Too quiet' });
  const mine = (await bo.get('/api/music/library')).json.tracks.find(t => t.id === q.id);
  assert.deepEqual([mine.status, mine.reason], ['rejected', 'Too quiet']);
  assert.equal((await bo.post('/api/music/delete', { id: p.id })).status, 403);
  assert.equal((await bo.post('/api/music/delete', { id: q.id })).status, 200);
  assert.ok(!(await titles(owner)).includes('Bo Song'));
});

test('a lounge stage: anyone sees its deck, members ask for its songs, administrators run it', { skip: !ok && 'needs ffmpeg' }, async () => {
  let r = await guest.get(`/api/music/deck?place=${place}`);
  assert.equal(r.status, 200, r.text); const d = r.json.deck;
  assert.equal(d.family, 'lounge'); assert.equal(d.music, true); assert.equal(d.settings.requests, true);
  assert.equal((await guest.get('/api/music/deck?place=0:0:999999')).status, 404);
  const lib = (await guest.get('/api/music/library')).json.tracks, jazz = lib.find(t => t.title === 'Velvet Test'), bossa = lib.find(t => t.title === 'Bossa Test');
  // asking: members only, one each, taken back
  assert.equal((await guest.post('/api/music/request', { place, track: jazz.id })).status, 401);
  r = await ann.post('/api/music/request', { place, track: jazz.id });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.position, 1);
  r = await bo.post('/api/music/request', { place, track: jazz.id });
  assert.equal(r.json.code, 'already', 'one request a song');
  assert.equal((await bo.post('/api/music/request', { place, track: bossa.id })).json.position, 2);
  let deck = (await guest.get(`/api/music/deck?place=${place}`)).json.deck;
  assert.deepEqual(deck.queue.map(q => q.name), ['Ann', 'Bo']);
  assert.equal((await ann.post('/api/music/request/cancel', { place })).status, 200);
  assert.equal((await bo.post('/api/music/request/cancel', { place, index: 0 })).status, 200, 'their own');
  deck = (await guest.get(`/api/music/deck?place=${place}`)).json.deck;
  assert.equal(deck.queue.length, 0);
  // running it: administrators only
  assert.equal((await ann.post('/api/music/deck', { place, requests: false })).status, 403);
  assert.equal((await ann.post('/api/music/skip', { place })).status, 403);
  r = await owner.post('/api/music/deck', { place, requests: false, genre: 'bossa' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.deck.settings, { requests: false, genre: 'bossa', playlist: null });
  assert.equal((await ann.post('/api/music/request', { place, track: bossa.id })).json.code, 'requests_off');
  assert.equal((await owner.post('/api/music/deck', { place, genre: 'house' })).json.code, 'bad_genre');
  r = await owner.post('/api/music/deck', { place, requests: true, genre: null, playlist: [bossa.id, jazz.id, 'nope'] });
  assert.deepEqual(r.json.deck.settings.playlist, [bossa.id, jazz.id]);
  assert.equal((await owner.post('/api/music/clear', { place })).status, 200);
  assert.equal((await owner.post('/api/music/skip', { place })).status, 200);
  // the state the page loads: the library, the decks, what this viewer may do
  const st = (await ann.get('/api/music/state')).json;
  assert.ok(st.decks.some(x => x.place === place));
  assert.deepEqual({ request: st.can.request, upload: st.can.upload, manage: st.can.manage }, { request: true, upload: true, manage: false });
  assert.equal((await owner.get('/api/music/state')).json.can.manage, true);
});
