// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Albums (server/music/music.js, 2026-11-25) and the stage's AI agent (music.js, server/music/dj.js): a song's album, its
// artist, number and year; an album's record and cover (an administrator's at once, a player's — of their own songs only
// — approved with them); several songs edited at once, an album renamed (its cover kept); the game's soundtrack as the
// album "Original Soundtrack, Vol. 1" by MVW Originals (its cover; its album's earlier name "Soundtrack 1" renamed). At a stage: a resident DJ plays the MVW album, the lounge its music; an AI agent
// there plays its own set (its first change starts from what the stage plays); requests to an agent with a brain wait
// for its answer — played, or passed with a reason —, and play after MUSIC.askWait unanswered; its brain's turn; its
// tools in its chats and a connected agent's. Over HTTP: an upload with its album, the albums listed, a cover.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../server/db.js';
import { Music } from '../server/music/music.js';
import { DjBrain } from '../server/music/dj.js';
import { seedSoundtrack } from '../server/music/soundtrack.js';
import { hasFfmpeg } from '../server/music/audio.js';
import { toolbox } from '../server/mind/tools.js';
import { AgentWorld } from '../server/agent-world.js';
import { MUSIC, albumKey, MVW_ALBUM } from '../shared/music.js';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-albums-'));
  const dbs = openDb(dir);
  const world = { buildings: [{ idx: 0, floors: 2, lv: [0, 1] }], levels: [{ items: [] }, { items: [{ id: 7, t: 'lounge_stage' }, { id: 9, t: 'dj_stage' }] }] };
  let T = 1000;
  const sim = { agents: [], people: [{ name: 'Juno', vip: true, agentId: 'juno' }, { name: 'Dee Resident' }], now: () => T, brain: { placeName: () => 'Club Nova' } };
  const agents = { 7: { id: 7, name: 'Juno', role: 'DJ', enabled: true } };
  const music = new Music({ dbs, dataDir: dir, sim: () => sim, world: () => world, broadcast: () => {}, nameOf: id => `Player ${id}`, log: { error() {}, warn() {}, info() {} },
    agentAt: i => (i === 0 ? agents[7] : null), crewAt: () => [] });
  const add = (title, genre, o = {}) => {
    const file = music.newFileName(); fs.writeFileSync(path.join(music.dir, file), Buffer.alloc(64));
    return music.add({ file, seconds: o.seconds || 150, title, artist: o.artist || 'Test', genre, status: o.status || 'approved', uploader: o.uploader ?? null, source: o.source || 'library', meta: o.meta || null,
      album: o.album, albumArtist: o.albumArtist, trackNo: o.track, year: o.year });
  };
  const perform = (who, id) => { sim.agents = [{ p: {}, act: { use: id === 9 ? 'dj' : 'perform', b: 0, f: 1, id, holdStart: 0, holdEnd: 1e12 } }]; if (who === 'resident') sim.agents = [{}, sim.agents[0]]; };
  return { dir, dbs, sim, music, add, perform, agents, setT: t => { T = t; } };
}

test('a song\'s album: its record (by artist and name, however written), its number and year, the albums listed', () => {
  const R = rig(), M = R.music;
  const a = R.add('Opening', 'pop', { artist: 'Nova Lane', album: ' Night  Drive ', track: 2, year: 2024 });
  const b = R.add('Closing', 'pop', { artist: 'Nova Lane', album: 'night drive', albumArtist: 'nova lane', track: 9 });
  const c = R.add('Alone', 'rock', { artist: 'Nova Lane' });
  assert.equal(a.album, 'Night Drive'); assert.equal(a.albumArtist, 'Nova Lane', 'its album artist: its artist when none given'); assert.equal(a.trackNo, 2); assert.equal(a.year, 2024);
  assert.equal(c.album, null, 'no album: a single');
  const L = M.list(null, false);
  assert.equal(L.albums.length, 1, 'one album however its name is written');
  assert.deepEqual({ ...L.albums[0], key: undefined }, { key: undefined, name: 'Night Drive', artist: 'Nova Lane', year: 2024, songs: 2, cover: null });
  assert.equal(L.tracks.find(t => t.id === b.id).albumKey, albumKey('Nova Lane', 'Night Drive'));
  assert.equal(L.tracks.find(t => t.id === a.id).track, 2);
  // several at once, an album renamed (its cover kept), a song taken off its album
  M.setCover(albumKey('Nova Lane', 'Night Drive'), JPEG, 'jpg', 1, true);
  M.editMany([a.id, b.id, c.id], { genre: 'rock', year: 2025 });
  assert.ok([a, b, c].every(t => M.tracks.get(t.id).genre === 'rock'));
  const A = M.renameAlbum(albumKey('Nova Lane', 'Night Drive'), { name: 'Night Drive (Deluxe)' });
  assert.equal(A.name, 'Night Drive (Deluxe)'); assert.ok(A.cover, 'its cover kept');
  assert.equal(M.tracks.get(a.id).album, 'Night Drive (Deluxe)');
  M.edit(b.id, { album: '' });
  assert.equal(M.tracks.get(b.id).album, null);
  // the database keeps it all (a restart)
  const again = new Music({ dbs: R.dbs, dataDir: R.dir, sim: () => R.sim, world: () => null, log: { error() {} } });
  assert.equal(again.tracks.get(a.id).album, 'Night Drive (Deluxe)'); assert.equal(again.albums.get(A.key)?.cover, A.cover);
});

test('covers: an administrator\'s at once; a player\'s only for an album of their own songs, approved with them; seen by whom', () => {
  const R = rig(), M = R.music;
  R.add('Mine 1', 'pop', { artist: 'Ann', album: 'First Steps', status: 'pending', uploader: 5, source: 'upload' });
  R.add('Mine 2', 'pop', { artist: 'Ann', album: 'First Steps', status: 'pending', uploader: 5, source: 'upload' });
  R.add('Theirs', 'pop', { artist: 'Bo', album: 'Mixed', uploader: 6 }); R.add('Ann too', 'pop', { artist: 'Bo', album: 'Mixed', uploader: 5 });
  const key = albumKey('Ann', 'First Steps');
  assert.throws(() => M.setCover(albumKey('Bo', 'Mixed'), JPEG, 'jpg', 5, false), e => e.status === 403, 'not all hers');
  const A = M.setCover(key, JPEG, 'jpg', 5, false);
  assert.equal(A.coverStatus, 'pending');
  assert.ok(M.coverFile(A.cover, 5, false), 'she sees her own');
  assert.equal(M.coverFile(A.cover, 9, false), null, 'nobody else yet');
  assert.ok(M.coverFile(A.cover, 9, true), 'an administrator does');
  assert.equal(M.coverFile('../../etc/passwd', 9, true), null);
  M.review([...M.tracks.values()].find(t => t.title === 'Mine 1').id, true);
  assert.equal(M.albums.get(key).coverStatus, 'approved', 'approved with her song');
  assert.ok(M.coverFile(A.cover, 9, false));
});

test('the soundtrack is the album «Original Soundtrack, Vol. 1» by MVW Originals, numbered as listed, with its cover — songs taken before albums put on it, its earlier name renamed', { skip: !hasFfmpeg() && 'needs ffmpeg' }, () => {
  const R = rig(), M = R.music, sd = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-st-'));
  for (const n of ['a', 'b']) execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=32', '-c:a', 'libmp3lame', '-b:a', '64k', path.join(sd, `${n}.mp3`)]);
  fs.writeFileSync(path.join(sd, 'cover.jpg'), JPEG);
  // (a world that had it as "Soundtrack 1": one of its songs filed there before)
  const old = R.add('Gamma', 'pop', { artist: 'MVW Originals', album: 'Soundtrack 1', albumArtist: 'MVW Originals', source: 'import', meta: { key: 'st/c' } });
  fs.writeFileSync(path.join(sd, 'soundtrack.json'), JSON.stringify({ cover: 'cover.jpg', tracks: [{ file: 'a.mp3', title: 'Alpha', artist: 'MVW Originals', genre: 'house', key: 'st/a' }, { file: 'b.mp3', title: 'Beta', artist: 'MVW Originals', genre: 'jazz', key: 'st/b' }] }));
  seedSoundtrack(M, { dir: sd, log: { warn() {}, info() {} } });
  const alpha = [...M.tracks.values()].find(t => t.title === 'Alpha'), beta = [...M.tracks.values()].find(t => t.title === 'Beta');
  assert.deepEqual([alpha.album, alpha.albumArtist, alpha.trackNo, beta.trackNo], [MVW_ALBUM.name, 'MVW Originals', 1, 2]);
  assert.equal(M.tracks.get(old.id).album, MVW_ALBUM.name, 'its earlier name renamed');
  const A = M.albums.get(albumKey('MVW Originals', MVW_ALBUM.name));
  assert.ok(A.cover && A.coverStatus === 'approved', 'its cover set');
  M.setCover(A.key, JPEG, 'jpg', 1, true); const mine = M.albums.get(A.key).cover;
  seedSoundtrack(M, { dir: sd, log: { warn() {}, info() {} } });
  assert.equal(M.albums.get(A.key).cover, mine, 'a cover chosen since is kept');
  M.edit(beta.id, { album: '' });   // (as songs were before albums)
  beta.meta = { key: 'st/b' };   // (imported by tools/music-import.mjs: its key, not the soundtrack's mark)
  seedSoundtrack(M, { dir: sd, log: { warn() {}, info() {} } });
  assert.equal(M.tracks.get(beta.id).album, MVW_ALBUM.name, 'put on its album at the next start');
});

test('the DJ booth: a resident plays the MVW album; an AI agent its own set, starting from what the stage plays; the lounge as it was', () => {
  const R = rig(), M = R.music;
  const mvw = R.add('Neon Tide', 'house', { artist: 'MVW Originals', album: MVW_ALBUM.name, track: 1, source: 'import' });   // (on the MVW album: no soundtrack mark needed)
  const mvw2 = R.add('Ocean Drive', 'techno', { artist: 'MVW Originals', album: MVW_ALBUM.name, track: 2, meta: { soundtrack: true }, source: 'import' });
  const up = R.add('Player Banger', 'house', { artist: 'Ann', uploader: 5 }), jazz = R.add('Velvet', 'jazz'), pop = R.add('Sunny', 'pop');
  R.perform('resident', 9); M.tick(5000);
  const d = M.deckOf('0:1:9');
  assert.equal(d.performer.agent, null);
  assert.deepEqual(M.pool(d).map(t => t.title), ['Neon Tide', 'Ocean Drive'], 'a resident DJ: the MVW album\'s club songs');
  R.perform('agent', 9); M.tick(6000);
  assert.equal(d.performer.agent, 7); assert.equal(d.performer.name, 'Juno');
  assert.deepEqual(M.pool(d).map(t => t.id), [mvw.id, mvw2.id], 'no set of its own yet: the same');
  const r = M.editSet(d.place, 7, { op: 'add', songs: [pop.id, up.id] });
  assert.equal(r.songs, 4, 'its set starts from what the stage played');
  assert.deepEqual(M.pool(d).map(t => t.title), ['Neon Tide', 'Ocean Drive', 'Sunny', 'Player Banger'], 'any song of the library — a pop song at the DJ booth too');
  M.editSet(d.place, 7, { op: 'remove', song: mvw.id });
  assert.ok(!M.pool(d).some(t => t.id === mvw.id));
  assert.throws(() => M.editSet(d.place, 8, { op: 'add', song: jazz.id }), e => e.status === 403, 'another agent does not play here');
  R.sim.agents = []; M.tick(60000);
  assert.equal(d.performer, null, 'gone: no performer');
  const L = M.deckOf('0:1:7'); R.perform('resident', 7); M.tick(70000);
  assert.deepEqual(M.pool(L).map(t => t.title), ['Velvet'], 'the lounge: its own music, as before');
});

test('requests to an AI agent: any song, a word for it; played or passed with a reason; unanswered, played after the wait', () => {
  const R = rig(), M = R.music;
  const a = R.add('Neon Tide', 'house'), b = R.add('Velvet', 'jazz'), c = R.add('Sunny', 'pop'), e = R.add('Extra', 'rock');
  M.dj = { can: id => id === 7, poke() {}, tick() {} };
  R.perform('agent', 9); M.tick(5000);
  const d = M.deckOf('0:1:9');
  assert.equal(M.agentDecides(d), true);
  const r = M.request(5, 'Ann', d.place, b.id, 'for my birthday!');
  assert.deepEqual([r.asked, r.dj], [true, 'Juno'], 'a jazz song at the DJ booth: the agent decides');
  assert.equal(d.asks[0].note, 'for my birthday!'); assert.equal(d.queue.length, 0, 'not in the queue until it says so');
  assert.throws(() => M.request(6, 'Bo', d.place, b.id), e => e.code === 'already');
  M.request(6, 'Bo', d.place, c.id);
  assert.equal(M.pubDeck(d).asks.length, 2);
  M.answerAsk(d.place, d.asks[0].k, { play: true }, 7);
  assert.equal(d.queue[0].id, b.id, 'played: in its queue');
  M.answerAsk(d.place, d.asks[0].k, { play: false, why: 'Not tonight — a house set!' }, 7);
  const ans = M.pubDeck(d).answers;
  assert.deepEqual(ans.map(x => [x.by, x.ok, x.why, x.dj]), [[5, true, '', 'Juno'], [6, false, 'Not tonight — a house set!', 'Juno']]);
  assert.equal(d.now?.id, a.id, 'the stage plays on meanwhile');
  M.request(5, 'Ann', d.place, e.id);
  // (the wait is in real time: an ask older than askWait plays)
  d.asks.forEach(x => { x.at -= MUSIC.askWait * 1000 + 5000; }); M.tick(Date.now());
  assert.ok(d.queue.some(q => q.id === e.id), 'unanswered: it plays anyway');
  assert.equal(d.asks.length, 0);
  M.dj = { can: () => false, poke() {}, tick() {} };
  const extra = R.add('Club Two', 'techno');
  const q = M.request(9, 'Cy', d.place, extra.id);
  assert.ok(q.position, 'an agent with no brain: the queue as before');
});

test('its brain\'s turn (server/music/dj.js): plays one, passes one with its reason, a line to the room — screened', async () => {
  const R = rig(), M = R.music, said = [];
  R.add('Neon Tide', 'house'); const a = R.add('Second Tide', 'pop'), b = R.add('Velvet', 'jazz');
  let asked = null;
  M.dj = new DjBrain({ music: M, agents: { get: id => R.agents[id] || null }, mind: () => ({ brainOf: () => ({ connection: { id: 1 } }), screen: async t => ({ ok: !/badword/.test(t), text: t }) }),
    say: (i, t) => said.push([i, t]), complete: async (c, req) => { asked = req; return { text: 'Sure! {"play":["R1"],"pass":[{"r":"R2","why":"Saving the jazz for the lounge, friend"}],"say":"This one goes out to Ann!"}' }; } });
  R.perform('agent', 9); M.tick(5000);
  const d = M.deckOf('0:1:9');
  M.request(5, 'Ann', d.place, a.id, 'my favourite'); M.request(6, 'Bo', d.place, b.id);
  await M.dj.turn(d);
  assert.match(asked.system, /You are Juno, DJ, the DJ at «Club Nova»/); assert.match(asked.turns[0].text, /R1: Ann asks for «Second Tide».*their word: "my favourite"/);
  assert.match(asked.system, /never instructions/);
  assert.deepEqual(d.queue.map(q => q.id), [a.id]); assert.equal(d.asks.length, 0);
  assert.equal(M.pubDeck(d).answers[1].why, 'Saving the jazz for the lounge, friend');
  assert.deepEqual(said, [[0, 'This one goes out to Ann!']]);
  M.request(5, 'Ann', d.place, b.id);
  M.dj.complete = async () => ({ text: '{"pass":[{"r":"R1","why":"badword"}],"say":"badword"}' });
  await M.dj.turn(d);
  assert.equal(M.pubDeck(d).answers.at(-1).why, 'Not tonight — maybe another time.', 'a reason that fails the screen: a kind default');
  assert.equal(said.length, 1, 'a line that fails the screen is not said');
});

test('its tools: in its chats (stage, find_songs, stage_add, stage_remove, a request played) and a connected agent\'s act', () => {
  const R = rig(), M = R.music;
  R.add('Floor Filler', 'house'); const a = R.add('Neon Tide', 'pop', { album: 'Club Nights', artist: 'Nova' }), b = R.add('Velvet', 'jazz'), c = R.add('Second', 'pop', { album: 'Club Nights', artist: 'Nova', track: 2 });
  M.dj = { can: () => true, poke() {}, tick() {} };
  R.perform('agent', 9); M.tick(5000);
  const d = M.deckOf('0:1:9');
  M.request(5, 'Ann', d.place, b.id, 'please');
  const t = toolbox({ agent: { id: 7, name: 'Juno' }, kind: 'chat', ctx: {}, money: null, wallet: null, people: [], idem: 'x', music: M });
  assert.ok(['find_songs', 'find_albums', 'stage', 'stage_add', 'stage_add_album', 'stage_remove', 'stage_play_request', 'stage_pass_request'].every(n => t.names.includes(n)), t.names.join());
  let [r] = t.run([{ tool: 'stage' }]);
  assert.match(r.text, /the DJ booth at «Club Nova», I am on now/); assert.match(r.text, /R1 Ann asks for «Velvet» \("please"\)/);
  [r] = t.run([{ tool: 'find_albums', words: 'club' }]); assert.match(r.text, /^A1 «Club Nights» by Nova, 2 songs/);
  [r] = t.run([{ tool: 'stage_add_album', album: 'A1' }]); assert.ok(r.ok, r.text);
  [r] = t.run([{ tool: 'stage_play_request', r: 'R1' }]); assert.ok(r.ok, r.text); assert.match(r.text, /«Velvet» for Ann is in my queue/);
  [r] = t.run([{ tool: 'stage_remove', n: 1 }]); assert.ok(r.ok, r.text);
  const W = Object.create(AgentWorld.prototype); W.music = M; W.radio = null;
  const v = W.stageAct({ id: 7, name: 'Juno' }, { action: 'stage' });
  assert.equal(v.performing, true); assert.ok(v.songs >= 1);
  assert.throws(() => W.stageAct({ id: 7 }, { action: 'stage_add', song: c.id }), e => e.code === 'already', 'the album is in its set already');
  assert.equal(W.stageAct({ id: 7 }, { action: 'stage_remove', song: a.id }).titles[0], 'Neon Tide');
  assert.throws(() => W.stageAct({ id: 8 }, { action: 'stage' }), e => e.status === 403);
  assert.ok(W.playlistAct({ id: 7, name: 'Juno' }, { action: 'find_songs', text: 'velvet' }).songs.length === 1, 'the library\'s search with no station of its own');
  void c;
});

let s, owner, ann;
const ok = hasFfmpeg();
before(async () => { s = await startServer({ population: 40 }); owner = await ownerSession(s); ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' }); });
after(async () => { await s?.stop(); });

test('over HTTP: a song with its album, the albums listed, a cover (an administrator\'s; a player\'s waits), several edited at once', { skip: !ok && 'needs ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-alb-http-')), f = path.join(dir, 'x.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=400:duration=31', '-c:a', 'libmp3lame', '-b:a', '64k', f]);
  const buf = fs.readFileSync(f);
  const up = (who, q) => who.post(`/api/music/upload?${new URLSearchParams(q)}`, buf, { 'content-type': 'audio/mpeg' });
  let r = await up(owner, { title: 'One', artist: 'Nova', genre: 'pop', album: 'Skyline', albumArtist: 'Nova', track: '1', year: '2025' });
  assert.equal(r.status, 200, r.text); const one = r.json.track;
  assert.deepEqual([one.album, one.albumArtist, one.track, one.year], ['Skyline', 'Nova', 1, 2025]);
  r = await up(owner, { title: 'Two', artist: 'Nova', genre: 'pop', album: 'skyline', albumArtist: 'nova', track: '2' });
  const lib = (await owner.get('/api/music/library')).json;
  assert.equal(lib.albums.filter(a => a.name === 'Skyline').length, 1); assert.equal(lib.albums.find(a => a.name === 'Skyline').songs, 2);
  r = await owner.post(`/api/music/cover?key=${encodeURIComponent(one.albumKey)}`, JPEG, { 'content-type': 'image/jpeg' });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.album.coverStatus, 'approved');
  const cov = await ann.get(r.json.album.cover.replace(/^/, ''));
  assert.equal(cov.status, 200, 'everyone sees an approved cover');
  assert.equal((await owner.post('/api/music/cover?key=x', Buffer.from('not an image at all, really'), { 'content-type': 'image/jpeg' })).status, 400);
  assert.equal((await ann.post(`/api/music/cover?key=${encodeURIComponent(one.albumKey)}`, JPEG, { 'content-type': 'image/jpeg' })).status, 403, 'not her album');
  r = await up(ann, { title: 'Hers', artist: 'Ann', genre: 'rock', album: 'Garage', rights: '1' });
  assert.equal(r.json.track.status, 'pending');
  r = await ann.post(`/api/music/cover?key=${encodeURIComponent(r.json.track.albumKey)}`, JPEG, { 'content-type': 'image/jpeg' });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.album.coverStatus, 'pending');
  r = await owner.post('/api/music/tracks', { ids: [one.id], patch: { genre: 'rock', year: 2026 } });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.tracks[0].genre, 'rock');
  assert.equal((await ann.post('/api/music/tracks', { ids: [one.id], patch: { genre: 'pop' } })).status, 403);
  r = await owner.post('/api/music/album', { key: one.albumKey, name: 'Skyline (Live)' });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.album.name, 'Skyline (Live)');
});
