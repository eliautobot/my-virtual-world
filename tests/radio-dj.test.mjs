// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A studio's DJ on the air (server/radio/radio.js djOf, castOf; 2026-10-28, the product owner: "the radio table has upto
// 3 co hosts, and the dj..." → "yes build it, test it and make sure it works as intended"): the agent on duty at the
// studio's DJ booth joins the hosts at the desk as the fourth voice (the hosts lead, the DJ closes, handing over to the
// song), with its own brain (2026-10-28: "each should speak for their own"), named as the DJ to them and they to the DJ;
// a host with no brain is in the studio but not on the mic; with no host on duty the DJ alone says a short link; the
// show is remembered by everyone on it, the DJ too; the station names its DJ; a DJ off duty is not on the air.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Radio } from '../server/radio/radio.js';
import { stationTracks, onAir } from '../shared/radio.js';

const tracks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: 'MVW Originals', genre: ['jazz', 'lounge', 'house', 'pop', 'score'][i % 5], seconds: 120 + i * 7, status: 'approved' }));
const AG = { 7: { id: 7, name: 'Rosa Vega', role: 'radio host', enabled: true, ownerId: 1, bodyRef: 'person:41' }, 11: { id: 11, name: 'Marco Lane', role: 'radio host', enabled: true, ownerId: 1, bodyRef: 'person:52' },
  12: { id: 12, name: 'Kai Dee', role: 'DJ', enabled: true, ownerId: 1, bodyRef: 'person:63' } };

/** A Radio Station building with one studio: its broadcast desk (piece 1, seats 0-2) and its DJ booth (piece 2). */
function studio({ desk = [], dj = null, reply }) {   // reply: (speaker's first name, its nth turn) → its text
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-radio-dj-')), asked = [], calls = [];
  let T = 1e12;
  const W = { buildings: [{ idx: 0, radio: true, floors: 1, lv: [0], name: 'Radio Station' }], levels: [{ mods: [{ id: 'm1', kind: 'studio', name: 'Studio One' }], items: [{ id: 1, t: 'broadcast_desk', mod: 'm1' }, { id: 2, t: 'studio_dj', mod: 'm1' }] }] };
  const holders = id => new Map(id === 1 ? desk.map((a, k) => [k, { agent: AG[a] }]) : id === 2 && dj ? [[0, { agent: AG[dj] }]] : []);
  const life = {
    participant: id => (AG[id] ? { kind: 'agent', agentId: id, id: `p${id}`, name: AG[id].name } : null),
    conversation: o => { calls.push(o); return o.who.length; },
    relationTo: () => ({ affinity: 0.3, interactions: 4, note: 'Works with me at Studio One', words: 'Getting to know' }),
  };
  const R = new Radio({
    dataDir: dir, dbs: { db: { prepare: () => ({ all: () => [] }) }, worldId: 'w' }, log: null, now: () => T,
    music: { list: (me, admin) => ({ tracks: admin ? tracks : tracks.map(({ status, ...t }) => t) }) },
    agents: { get: id => AG[id] || null, list: () => Object.values(AG), resolver: { resolveBody: r => (r ? Number(r.split(':')[1]) : -1) } },
    connections: { get: () => null, list: () => [] },
    mind: () => ({ contextOf: a => ({ personality: ['warm'], bio: `${a.name} loves music.`, memoriesShort: [] }), brainOf: a => (a.id === 11 ? { reason: 'no_brain' } : { connection: { id: 100 + a.id } }), screen: async t => ({ ok: true, text: t }) }),
    voice: () => null, principalFor: id => ({ account: { id } }), econ: () => null, weather: () => null,
    complete: async (c, req) => {
      const who = req.system.match(/^You are ([^,(]+?)(?: \(|,)/)?.[1], n = asked.filter(x => x.who === who).length;
      asked.push({ ...req, who, conn: c.id, user: req.turns.map(t => t.text).join('\n') });
      return { text: typeof reply === 'function' ? reply(who.split(' ')[0], n) : reply };
    },
    broadcast: () => {}, world: () => W, postsAt: (b, f, id) => holders(id), life: () => life,
  });
  R.syncStudios();
  const st = R.cfg.stations.find(s => s.studio);
  // a moment a minute before one of its slots
  const list = stationTracks(tracks, st);
  for (let t = 1e6; ; t += 5) { const a = onAir(list, st.id, t + 60, st.order); if (a.kind === 'ident' && a.at < 5) { T = t * 1000; break; } }
  R.setConfig({ voice: 'free' });
  return { R, st, asked, calls, dir };
}
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };

test('the DJ joins the hosts on the air: its own brain, named as the DJ, it closes with the song; a host with no brain not on the mic; the show remembered by all', async () => {
  const said = { Rosa: ['Good evening, Rosa here at the desk with Kai on the decks. What a day in the city.', 'It really was, lots going on downtown tonight.'],
    Kai: ['Evening Rosa, the decks are warm and ready for you all.', 'And I have a smooth one lined up for you, here comes Song 2.\nTOPICS: a busy evening and the next song'] };
  const w = studio({ desk: [7, 11], dj: 12, reply: (who, n) => said[who][n] });
  assert.deepEqual(w.R.castOf(w.st).map(a => a.name), ['Rosa Vega', 'Marco Lane', 'Kai Dee']);
  await w.R.tick(); assert.ok(await until(() => w.R.breaks.size === 1), 'a break was made');
  const b = w.R.state().breaks[0];
  assert.deepEqual(b.lines.map(l => l.host.name), ['Rosa Vega', 'Kai Dee', 'Rosa Vega', 'Kai Dee'], 'Marco (no brain) is not on the mic; the DJ closes');
  assert.deepEqual(w.asked.map(x => [x.who, x.conn]), [['Rosa Vega', 107], ['Kai Dee', 112], ['Rosa Vega', 107], ['Kai Dee', 112]], 'each its own brain');
  assert.equal(b.lines[3].host.body, 63, 'the DJ\'s line is spoken from its body at the booth');
  const kai = w.asked[3];
  assert.match(kai.system, /^You are Kai Dee \(the DJ\), live on the air/); assert.match(kai.system, /You are the station's DJ at the decks: your part is the music/);
  assert.match(kai.system, /Marco Lane is in the studio too but not on the mic/);
  assert.match(kai.turns.at(-1).text, /you close the break as the DJ: a last word, then introduce the next song/);
  assert.match(w.asked[0].system, /Kai Dee is the station's DJ at the decks: the hosts lead the talk/);
  // each knows the others by their part (their history: the talk carries it)
  assert.match(w.asked[0].user, /The DJ Kai Dee: getting to know/); assert.match(kai.user, /Your host Rosa Vega: getting to know/);
  assert.deepEqual(w.calls[0].who.map(x => x.agentId).sort((x, y) => x - y), [7, 11, 12], 'everyone on the show remembers it, the DJ and the one not on the mic too');
  assert.equal(w.calls[0].about, 'a busy evening and the next song');
  const one = w.R.show(w.R.shows(w.st.id, 1)[0].id);
  assert.deepEqual(one.cast.map(c => [c.name, c.part, c.spoke]), [['Rosa Vega', 'host', true], ['Marco Lane', 'host', false], ['Kai Dee', 'dj', true]]);
  assert.deepEqual(w.R.showsOf(11).map(x => x.spoke), [0], 'Marco\'s Studio: on the show, no line of its own');
});

test('no host on duty: the DJ alone says a short link, and remembers it', async () => {
  const reply = 'Kai Dee here on the decks, the city is buzzing tonight and this next one keeps it moving, here is Song 3 for you.';
  const w = studio({ desk: [], dj: 12, reply });
  assert.equal(w.R.hostOf(w.st.id)?.name, 'Kai Dee', 'the DJ leads when no host is on duty');
  await w.R.tick(); assert.ok(await until(() => w.R.breaks.size === 1), 'a link was written');
  const sys = w.asked[0].system;
  assert.match(sys, /You are Kai Dee \(the DJ\), the DJ of /); assert.match(sys, /ONE short DJ link/); assert.equal(w.asked[0].conn, 112, 'its own brain');
  const b = w.R.state().breaks[0];
  assert.ok(b.lines.length === 1 && b.lines[0].host.name === 'Kai Dee');
  assert.deepEqual(w.calls[0].who.map(x => x.agentId), [12]);
  assert.equal(w.R.state().stations.find(s => s.id === w.st.id).dj.name, 'Kai Dee', 'the station names its DJ');
});

test('a DJ off duty is not on the air: the hosts alone', async () => {
  const w = studio({ desk: [7], dj: null, reply: 'Rosa here, a lovely evening in the city and here is the next song for all of you.' });
  assert.deepEqual(w.R.castOf(w.st).map(a => a.name), ['Rosa Vega']);
  assert.equal(w.R.state().stations.find(s => s.id === w.st.id).dj, null);
  await w.R.tick(); assert.ok(await until(() => w.R.breaks.size === 1));
  assert.doesNotMatch(w.asked[0].system, /DJ/);
});
