// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A station's songs (server/radio/radio.js editPlaylist, 2026-11-25): who may change them — its administrators, its hosts'
// owners, its hosts themselves when it lets them, nobody else; adding (a station playing its genres gets its own
// playlist made of them), taking off, moving, a whole new order, back to its genres; each change logged and undoable;
// a host's changes a day; a host's tools in its chats (server/mind/tools.js) and a connected agent's act
// (server/agent-world.js); and over HTTP: /api/radio/manage and /api/radio/playlist for an administrator and a player.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Radio } from '../server/radio/radio.js';
import { PLAYLIST_EDITS, MAX_PLAYLIST } from '../shared/radio.js';
import { toolbox } from '../server/mind/tools.js';
import { AgentWorld } from '../server/agent-world.js';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

const tracks = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: i < 5 ? 'Velvet Trio' : 'Bass Crew', genre: i < 5 ? 'jazz' : 'pop', seconds: 120 + i * 7 }));
function world({ now = Date.now() } = {}) {
  const T = { t: now }, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-radio-pl-'));
  const agents = [{ id: 7, name: 'Juno', enabled: true, ownerId: 2 }, { id: 8, name: 'Milo', enabled: true, ownerId: 3 }, { id: 9, name: 'Nova', enabled: true, ownerId: 2 }];
  const R = new Radio({
    dataDir: dir, dbs: { db: { prepare: () => ({ all: () => [] }) }, worldId: 'w' }, log: null, now: () => T.t,
    music: { list: () => ({ tracks: tracks.slice() }) },
    agents: { get: id => agents.find(a => a.id === Number(id)) || null, list: () => agents, resolver: { resolveBody: () => -1 } },
    connections: { get: () => null, list: () => [] }, mind: () => null, voice: () => null, principalFor: () => ({ account: { id: 1 } }),
    econ: () => null, weather: () => null, broadcast: () => {},
  });
  R.setConfig({ hosts: { velvet: 7 } });   // Juno hosts Velvet (a city station: lounge music — the jazz songs)
  return { R, T, dir };
}
const admin = { admin: true, account: 1, name: 'Ada' }, kim = { account: 2, name: 'Kim' }, stranger = { account: 3, name: 'Ann' }, juno = { agent: 7, name: 'Juno' };

test('who may change a station\'s songs: its administrators, its hosts\' owners, its hosts (when it lets them), nobody else', () => {
  const { R } = world(), st = R.station('velvet');
  assert.equal(R.playlistRight(st, admin), 'admin');
  assert.equal(R.playlistRight(st, kim), 'owner', 'Kim owns Juno, its host');
  assert.equal(R.playlistRight(st, stranger), null, 'Ann owns no host of it');
  assert.equal(R.playlistRight(st, juno), 'host');
  assert.equal(R.playlistRight(st, { agent: 9 }), null, 'Nova (Kim\'s, but not its host) may not');
  assert.equal(R.playlistRight(R.station('bass'), juno), null, 'not a station it hosts');
  assert.deepEqual(R.hostedBy(7).map(s => s.id), ['velvet']);
  assert.throws(() => R.editPlaylist('velvet', { op: 'add', song: 't5' }, stranger), e => e.status === 403);
  R.setConfig({ station: { id: 'velvet', hostsEdit: false } });
  assert.equal(R.playlistRight(R.station('velvet'), juno), null, 'the station keeps its hosts off its songs');
  assert.equal(R.playlistRight(R.station('velvet'), kim), 'owner', 'its hosts\' owners still may');
  assert.throws(() => R.editPlaylist('velvet', { op: 'add', song: 't5' }, juno), e => e.status === 403 && /may not change/.test(e.message));
  assert.deepEqual(R.hostedBy(7), []);
});

test('adding to a station that plays its genres: its own playlist of what it played, then the song; take off, move, the whole order, its genres again', () => {
  const { R } = world();
  assert.deepEqual(R.playlistOf(R.station('velvet')), ['t0', 't1', 't2', 't3', 't4'], 'its genres: the jazz songs');
  let r = R.editPlaylist('velvet', { op: 'add', song: 't7' }, juno);
  assert.equal(r.mode, 'own');
  assert.deepEqual(r.playlist, ['t0', 't1', 't2', 't3', 't4', 't7'], 'nothing it played went missing');
  assert.throws(() => R.editPlaylist('velvet', { op: 'add', song: 't7' }, juno), e => e.code === 'already');
  assert.throws(() => R.editPlaylist('velvet', { op: 'add', song: 'nope' }, juno), e => e.code === 'no_song');
  r = R.editPlaylist('velvet', { op: 'add', songs: ['t8', 't9', 't0'], at: 0 }, kim);
  assert.deepEqual(r.playlist.slice(0, 3), ['t8', 't9', 't0'], 'two new ones at the top (one already on it)');
  assert.deepEqual(r.change.songs, ['t8', 't9']);
  r = R.editPlaylist('velvet', { op: 'move', song: 't7', to: 0 }, juno);
  assert.equal(r.playlist[0], 't7'); assert.equal(r.change.from, 7);
  r = R.editPlaylist('velvet', { op: 'remove', song: 't3' }, juno);
  assert.ok(!r.playlist.includes('t3'));
  assert.throws(() => R.editPlaylist('velvet', { op: 'set', songs: ['t1'] }, juno), e => e.status === 403, 'a host never replaces the whole order');
  r = R.editPlaylist('velvet', { op: 'set', songs: ['t1', 't2', 'zzz'] }, kim);
  assert.deepEqual(r.playlist, ['t1', 't2'], 'its owner may (unknown songs left out)');
  // (every song off: it starts fresh and plays nothing — 2026-11-25, "I would like to be able to clear out all the songs")
  assert.throws(() => R.editPlaylist('velvet', { op: 'clear' }, juno), e => e.status === 403, 'a host never clears its station');
  r = R.editPlaylist('velvet', { op: 'clear' }, kim);
  assert.deepEqual([r.playlist, r.mode], [[], 'own']);
  assert.deepEqual(R.playlistOf(R.station('velvet')), [], 'it plays nothing');
  assert.throws(() => R.editPlaylist('velvet', { op: 'clear' }, admin), e => e.code === 'same');
  r = R.undoPlaylist('velvet', R.logOf('velvet')[0].id, admin);
  assert.deepEqual(r.playlist, ['t1', 't2'], 'undone: its songs back');
  r = R.editPlaylist('velvet', { op: 'remove', song: 't1' }, juno); r = R.editPlaylist('velvet', { op: 'remove', song: 't2' }, juno);
  assert.deepEqual([r.playlist, r.mode], [[], 'own'], 'its last song taken off: empty, not its genres');
  r = R.editPlaylist('velvet', { op: 'set', songs: ['t1', 't2'] }, admin);
  assert.throws(() => R.editPlaylist('velvet', { op: 'mode', mode: 'genres' }, kim), e => e.status === 403, 'back to its genres: administrators');
  r = R.editPlaylist('velvet', { op: 'mode', mode: 'genres' }, admin);
  assert.equal(r.mode, 'genres'); assert.deepEqual(R.playlistOf(R.station('velvet')), ['t0', 't1', 't2', 't3', 't4']);
  const log = R.logOf('velvet');
  assert.deepEqual(log.map(e => e.op), ['mode', 'set', 'remove', 'remove', 'undo', 'clear', 'set', 'remove', 'move', 'add', 'add'], 'every change logged, newest first');
  assert.deepEqual(log.at(-1).by, { kind: 'host', agent: 7, name: 'Juno' });
  assert.ok(log.every(e => e.at > 1e12 && typeof e.id === 'string'), 'each change: its own id and when (a song\'s place never takes the time\'s)');
  assert.equal(log.at(-1).pos, 5, 'where the song went');
  assert.equal(log[6].by.kind, 'owner'); assert.equal(log[5].by.kind, 'owner', 'its clearing too');
});

test('undo: an add taken off, a removed song back where it was, a move moved back; a station playing its genres before plays them again', () => {
  const { R } = world();
  const a = R.editPlaylist('velvet', { op: 'add', song: 't6' }, juno).change;
  const b = R.editPlaylist('velvet', { op: 'remove', song: 't1' }, juno).change;
  const c = R.editPlaylist('velvet', { op: 'move', song: 't6', to: 0 }, juno).change;
  assert.throws(() => R.undoPlaylist('velvet', c.id, juno), e => e.status === 403, 'a host does not undo');
  assert.throws(() => R.undoPlaylist('velvet', c.id, stranger), e => e.status === 403);
  let r = R.undoPlaylist('velvet', c.id, kim);
  assert.equal(r.playlist.at(-1), 't6', 'moved back');
  assert.throws(() => R.undoPlaylist('velvet', c.id, admin), e => e.code === 'already');
  r = R.undoPlaylist('velvet', b.id, admin);
  assert.equal(r.playlist[1], 't1', 'back where it was');
  r = R.undoPlaylist('velvet', a.id, admin);
  assert.equal(r.mode, 'genres', 'its first change undone: it plays its genres again');
  assert.equal(R.logOf('velvet')[0].op, 'undo');
  assert.deepEqual(R.logOf('velvet').filter(e => e.undone).length, 3);
});

test('a host\'s changes a day; the log keeps the newest; a playlist is at most MAX_PLAYLIST songs', () => {
  const { R, T } = world();
  R.editPlaylist('velvet', { op: 'add', song: 't5' }, juno);
  for (let k = 1; k < PLAYLIST_EDITS.agentPerDay; k++) R.editPlaylist('velvet', { op: 'move', song: 't5', to: k % 2 }, juno);
  assert.throws(() => R.editPlaylist('velvet', { op: 'move', song: 't5', to: 3 }, juno), e => e.status === 429);
  assert.ok(R.editPlaylist('velvet', { op: 'move', song: 't5', to: 3 }, kim), 'its owner has no daily limit');
  T.t += 86400000;
  assert.ok(R.editPlaylist('velvet', { op: 'move', song: 't5', to: 2 }, juno), 'a new day');
  for (let k = 0; k < PLAYLIST_EDITS.keep + 10; k++) R.editPlaylist('velvet', { op: 'move', song: 't5', to: k % 3 }, admin);
  assert.equal(R.logOf('velvet').length, PLAYLIST_EDITS.keep);
  assert.ok(MAX_PLAYLIST >= 100);
});

test('a host\'s tools in its chats (server/mind/tools.js): its playlist, songs to add, add, take off, move — and none for an agent that hosts nothing', () => {
  const { R } = world();
  const box = (id, name) => toolbox({ agent: { id, name }, kind: 'chat', ctx: {}, money: null, wallet: null, people: [], idem: 'x', radio: R });
  assert.deepEqual(box(8, 'Milo').names, [], 'Milo hosts nothing: no tools');
  const t = box(7, 'Juno');
  assert.deepEqual(t.names, ['playlist', 'find_songs', 'playlist_add', 'find_albums', 'playlist_add_album', 'playlist_remove', 'playlist_move']);
  assert.match(t.menuText().join('\n'), /playlist_add/);
  let [r] = t.run([{ tool: 'playlist' }]);
  assert.ok(r.ok); assert.match(r.text, /«Velvet» 88\.3 FM: 5 songs \(it plays its genres/);
  [r] = t.run([{ tool: 'find_songs', words: 'bass crew' }]);
  assert.match(r.text, /^S1 «Song \d» by Bass Crew/);
  const [add] = t.run([{ tool: 'playlist_add', song: 'S1' }]);
  assert.ok(add.ok, add.text); assert.match(add.text, /^done: added «Song \d» to «Velvet» \(6 songs now\)/); assert.match(add.say, /Velvet's playlist/);
  const [mv] = t.run([{ tool: 'playlist_move', n: 6, to: 1 }]);
  assert.ok(mv.ok, mv.text); assert.match(mv.text, /is number 1 on «Velvet»/);
  const [rm] = t.run([{ tool: 'playlist_remove', n: 1 }]);
  assert.ok(rm.ok, rm.text);
  const [bad] = t.run([{ tool: 'playlist_remove', n: 99 }]);
  assert.equal(bad.ok, false);
  assert.equal(R.logOf('velvet').length, 3, 'its three changes logged as its own');
  assert.ok(R.logOf('velvet').every(e => e.by.kind === 'host' && e.by.name === 'Juno'));
});

test('a connected agent\'s act (server/agent-world.js): playlist, find_songs, add, move, remove; refused when it hosts nothing', () => {
  const { R } = world();
  const W = Object.create(AgentWorld.prototype); W.radio = R;
  const me = { id: 7, name: 'Juno' };
  const v = W.playlistAct(me, { action: 'playlist' });
  assert.equal(v.songs, 5); assert.equal(v.list[0].id, 't0'); assert.match(v.note, /first change/);
  const found = W.playlistAct(me, { action: 'find_songs', text: 'pop' }).songs;
  assert.ok(found.length >= 5 && found.every(s => s.genre === 'pop'));
  let r = W.playlistAct(me, { action: 'playlist_add', song: found[0].id });
  assert.equal(r.ok, true); assert.equal(r.songs, 6);
  r = W.playlistAct(me, { action: 'playlist_move', n: 6, to: 1 });
  assert.equal(r.change.to, 1);
  r = W.playlistAct(me, { action: 'playlist_remove', song: 't0' });
  assert.equal(r.songs, 5);
  assert.throws(() => W.playlistAct({ id: 8, name: 'Milo' }, { action: 'playlist' }), e => e.status === 403);
  assert.throws(() => W.playlistAct(me, { action: 'playlist_add', song: found[0].id }), e => e.code === 'already');
});

let s, owner, ann;
before(async () => {
  s = await startServer({ population: 60, agents: 1 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
});
after(async () => { await s?.stop(); });

test('over HTTP: an administrator sees every station and changes its songs; a player who owns no host sees none and may not', async () => {
  const v = (await owner.get('/api/radio/manage')).json;
  assert.equal(v.admin, true);
  assert.deepEqual(v.stations.map(x => x.id), ['velvet', 'bass', 'sunday', 'grapevine']);
  assert.ok(v.stations.every(x => x.right === 'admin' && Array.isArray(x.songs) && Array.isArray(x.log)));
  assert.ok(Array.isArray(v.agents) && v.config);
  const a = (await ann.get('/api/radio/manage')).json;
  assert.deepEqual(a, { admin: false, stations: [], limits: a.limits });
  let r = await ann.post('/api/radio/playlist', { station: 'velvet', op: 'add', song: 'x' });
  assert.equal(r.status, 403, r.text);
  r = await owner.post('/api/radio/playlist', { station: 'velvet', op: 'add', song: 'nope' });
  assert.equal(r.status, 404, r.text); assert.equal(r.json.code, 'no_song');
  r = await owner.post('/api/radio/playlist', { station: 'nope', op: 'add', song: 'x' });
  assert.equal(r.status, 404);
  r = await owner.post('/api/radio/playlist/undo', { station: 'velvet', change: 'nope' });
  assert.equal(r.status, 404);
  r = await owner.post('/api/radio/admin', { station: { id: 'velvet', hostsEdit: false } });
  assert.equal(r.status, 200, r.text);
  assert.equal((await owner.get('/api/radio/manage')).json.stations[0].hostsEdit, false);
});
