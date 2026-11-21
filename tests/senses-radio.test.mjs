// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The car radio in an agent's senses (docs/features/awareness.md §2, §5): what a station has on the air in words
// (server/radio/radio.js nowWords: the song, the jingle, a host's break) and a driver's page saying which station its car
// plays (WebSocket radio_tune → server/senses/car-radio.js → senses.tuned), heard by an agent riding with them
// (senses.radioIn) — only while that player drives; cleared when they stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Radio } from '../server/radio/radio.js';
import { Senses } from '../server/senses/senses.js';
import { CarRadio, TUNE_GAP_MS } from '../server/senses/car-radio.js';
import { stationById, stationTracks, onAir } from '../shared/radio.js';

const tracks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: 'MVW Originals', genre: i % 2 ? 'jazz' : 'house', seconds: 120 + i * 7, status: 'approved' }));
const radioOf = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-radio-words-'));
  const R = new Radio({ dataDir: dir, dbs: { db: { prepare: () => ({ all: () => [] }) }, worldId: 'w' }, log: null, music: { list: () => ({ tracks }) },
    agents: { get: () => null, list: () => [] }, connections: { get: () => null, list: () => [] }, broadcast: () => {} });
  return { R, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
};
/** The first moment from t on when station id plays `kind` ('song' or 'ident'). */
function when(id, kind, t = 1e6) {
  const list = stationTracks(tracks, stationById(id));
  for (const end = t + 86400; t < end; t += 1) { const a = onAir(list, id, t); if (a?.kind === kind && a.at > 1) return { t, a }; }
  throw new Error(`${id} never plays a ${kind}`);
}

test('nowWords: the song on the air, the jingle between songs, a host\'s break (who speaks, with whom, over which song); no such station', () => {
  const { R, done } = radioOf();
  try {
    const s = when('velvet', 'song');
    assert.equal(R.nowWords('velvet', s.t), `«Velvet 88.3» — playing «${s.a.track.title}» by MVW Originals`);
    const j = when('velvet', 'ident');
    assert.equal(R.nowWords('velvet', j.t), '«Velvet 88.3» — the station\'s jingle, between songs');
    assert.match(R.nowWords('bass', when('bass', 'song').t), /^«Bass Island 99\.9» — playing «Song \d»/);
    assert.equal(R.nowWords('grapevine', 1e6), '«The Grapevine 1040 AM» — nothing on the air', 'a station with no songs it may play');
    // a break: over the start of the song after the slot, line by line
    const at = j.t + j.a.left;   // (the song after the jingle starts)
    R.breaks.set('k1', { key: 'k1', station: 'velvet', at, lines: [{ host: { id: 7, name: 'Rosa Vega' }, text: 'Good evening, Velvet listeners.', seconds: 4 }, { host: { id: 11, name: 'Marco Lane' }, text: 'Rain later tonight, folks.', seconds: 4 }] });
    const next = onAir(stationTracks(tracks, stationById('velvet')), 'velvet', at + 1).track.title;
    assert.equal(R.nowWords('velvet', at + 1), `«Velvet 88.3» — Rosa Vega is on the air (with Marco Lane), over «${next}» by MVW Originals`);
    assert.match(R.nowWords('velvet', at + 6), /^«Velvet 88\.3» — Marco Lane is on the air \(with Rosa Vega\)/);
    assert.match(R.nowWords('velvet', at + 30), /^«Velvet 88\.3» — playing /, 'the break is over');
    assert.equal(R.nowWords('nope'), null);
  } finally { done(); }
});

test('radio_tune: a driver\'s station reaches the senses (and an agent riding in their car hears it); a walker\'s does not; getting out clears it', () => {
  const now = { t: 1e12 };
  const players = { byId: new Map([[5, { id: 5, name: 'Kim', vehicleId: 'c1' }], [6, { id: 6, name: 'Sam', vehicleId: null }]]) };
  const senses = new Senses({ dbs: { db: { prepare: () => ({ all: () => [], run: () => {} }) }, worldId: 'w' }, sim: () => null, agents: {}, life: () => null, players, now: () => now.t });
  const { R, done } = radioOf();
  try {
    senses.radioWords = id => R.nowWords(id, when(id, 'song').t);
    const cr = new CarRadio({ senses: () => senses, players, known: id => !!R.station(id), now: () => now.t });
    cr.fromPage({ pid: 5 }, { t: 'radio_tune', station: 'velvet' });
    assert.equal(senses.tuned.get(5).station, 'velvet');
    const riding = { car: { riding: true, driverId: 5 } };
    assert.match(senses.radioIn(senses.env(), riding), /^«Velvet 88\.3» — playing «Song \d» by MVW Originals$/);
    assert.equal(senses.radioIn(senses.env(), { car: { riding: true, driverId: 6 } }), null, 'another driver\'s car');
    // too soon after the last: held, then the last word wins on the sweep
    now.t += 100;
    cr.fromPage({ pid: 5 }, { t: 'radio_tune', station: 'sunday' });
    cr.fromPage({ pid: 5 }, { t: 'radio_tune', station: 'bass' });
    assert.equal(senses.tuned.get(5).station, 'velvet');
    now.t += TUNE_GAP_MS;
    cr.sweep();
    assert.equal(senses.tuned.get(5).station, 'bass');
    assert.match(senses.radioIn(senses.env(), riding), /^«Bass Island 99\.9» — playing /);
    // off; a station that isn't one; a walker; a guest's connection
    now.t += TUNE_GAP_MS;
    cr.fromPage({ pid: 5 }, { t: 'radio_tune', station: null });
    assert.equal(senses.tuned.has(5), false, 'off');
    now.t += TUNE_GAP_MS;
    cr.fromPage({ pid: 5 }, { t: 'radio_tune', station: 'pirate-radio' });
    cr.fromPage({ pid: 5 }, { t: 'radio_tune', station: { evil: 1 } });
    assert.equal(senses.tuned.has(5), false);
    assert.equal(cr.stats.refused, 2);
    cr.fromPage({ pid: 6 }, { t: 'radio_tune', station: 'velvet' });
    assert.equal(senses.tuned.has(6), false, 'only a player at the wheel tunes a car');
    cr.fromPage({ pid: null, P: {} }, { t: 'radio_tune', station: 'velvet' });
    assert.equal(senses.tuned.size, 0);
    // on again, then out of the car: the sweep clears it
    now.t += TUNE_GAP_MS;
    cr.fromPage({ pid: 5 }, { t: 'radio_tune', station: 'bass' });
    assert.equal(senses.tuned.get(5).station, 'bass');
    players.byId.get(5).vehicleId = null;
    cr.sweep();
    assert.equal(senses.tuned.has(5), false, 'stopped driving');
    assert.equal(cr.stats.cleared, 1);
    cr.attach(); cr.stop();
  } finally { done(); senses.stop(); }
});
