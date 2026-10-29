// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The radio's shows, kept (server/radio/shows.js; 2026-10-28, the product owner: each on the air speaks for itself,
// "this also maintains true memories"; one conversation a break, kept and readable, never in a chat window): a station's
// recent shows, one by its id, an agent's shows (by who was on, not by name), 30 days kept, the shows kept before (a
// station's last 20 in shows.json) brought in once. And a break is ready before its slot, or not aired: brains too slow
// for the time left give no break, never one late.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ShowLog, KEEP_DAYS } from '../server/radio/shows.js';
import { Radio } from '../server/radio/radio.js';
import { stationById, stationTracks, onAir } from '../shared/radio.js';

const DAY = 86400e3, T0 = Date.UTC(2026, 9, 28, 15);

test('shows kept by day: recent, one by its id, an agent\'s; the old ones brought in once; 30 days, then let go', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-shows-'));
  fs.writeFileSync(path.join(dir, 'shows.json'), JSON.stringify({ s1a2b3c4d: [{ at: T0 - 600e3, hosts: ['Luke', 'Sara'], topics: 'rain', lines: [{ host: 'Luke', text: 'Hi.' }] }, { at: T0 - 1200e3, hosts: ['Sara'], topics: 'cafés', lines: [] }] }));
  let now = T0;
  const L = new ShowLog({ dir, now: () => now });
  assert.ok(!fs.existsSync(path.join(dir, 'shows.json')) && fs.existsSync(path.join(dir, 'shows.json.imported')), 'brought in once');
  assert.deepEqual(L.recent('s1a2b3c4d', 5).map(x => x.topics), ['rain', 'cafés'], 'newest first');
  const a = L.add('s1a2b3c4d', { air: now + 60e3, name: 'Studio 1', hosts: ['Luke', 'Ben'], topics: 'the arcade', cast: [{ id: 63, name: 'Luke', part: 'host', spoke: true }, { id: 65, name: 'Ben', part: 'dj', spoke: false }], lines: [{ id: 63, host: 'Luke', text: 'Ben is on the decks.' }] });
  assert.match(a.id, /^2026-10-28-[a-f0-9]{10}$/);
  assert.equal(L.recent('s1a2b3c4d', 1)[0].id, a.id);
  assert.equal(L.get(a.id).lines[0].text, 'Ben is on the decks.'); assert.equal(L.get('2026-10-28-0000000000'), null); assert.equal(L.get('../x'), null);
  assert.deepEqual(L.ofAgent(65).map(x => x.id), [a.id], 'Ben was on it (in the studio, no line)');
  assert.deepEqual(L.ofAgent(63, 10, 'Luke').map(x => x.topics), ['the arcade', 'rain'], 'Luke: by who was on; the old ones (names only) by its name');
  assert.deepEqual(L.ofAgent(99), []);
  assert.equal(L.add('../etc', { hosts: [] }), null, 'a station id is a word');
  // the days go after KEEP_DAYS
  now = T0 + (KEEP_DAYS + 1) * DAY;
  L.add('s1a2b3c4d', { hosts: ['Sara'], topics: 'a new month', cast: [], lines: [] });
  L.prune();
  assert.deepEqual(fs.readdirSync(path.join(dir, 'shows', 's1a2b3c4d')), [new Date(now).toISOString().slice(0, 10) + '.jsonl']);
  assert.deepEqual(L.recent('s1a2b3c4d', 5).map(x => x.topics), ['a new month']);
});

test('a break is ready before its slot, or not aired: brains in time, it is ready; brains too slow, no break, never a late one', async () => {
  const tracks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: 'MVW', genre: 'jazz', seconds: 150, status: 'approved' }));
  const list = stationTracks(tracks, stationById('velvet'));
  let t0 = 0; for (let t = 1e6; ; t += 5) { const x = onAir(list, 'velvet', t + 120); if (x.kind === 'ident' && x.at < 5) { t0 = t * 1000; break; } }   // (its slot about 2 minutes off)
  const run = async ms => {
    const started = Date.now(), now = () => t0 + (Date.now() - started) * 200;   // (the world's clock fast: a brain's 50 ms is 10 s, 400 ms 80 s)
    const agents = [{ id: 7, name: 'Rosa', enabled: true }, { id: 11, name: 'Marco', enabled: true }], asked = [];
    const R = new Radio({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-slow-')), dbs: { db: { prepare: () => ({ all: () => [] }) }, worldId: 'w' }, now,
      music: { list: () => ({ tracks }) }, agents: { get: id => agents.find(a => a.id === Number(id)) || null, list: () => agents, resolver: { resolveBody: () => -1 } },
      connections: { get: () => null, list: () => [] }, mind: () => ({ contextOf: () => ({}), brainOf: a => ({ connection: { id: a.id } }), screen: async t => ({ ok: true, text: t }) }),
      voice: () => null, principalFor: () => ({}), econ: () => null, weather: () => null, broadcast: () => {},
      complete: async (c, req) => { asked.push(req.timeoutMs); await new Promise(r => setTimeout(r, ms)); return { text: 'A fine evening in the city, and here is more to talk about tonight.' }; } });
    R.setConfig({ station: { ...R.station('velvet'), hosts: [7, 11] } }); R.setConfig({ voice: 'free' });
    await R.tick(); await new Promise(r => setTimeout(r, ms * 6 + 200));
    return { R, asked, b: [...R.breaks.values()][0] };
  };
  const ok = await run(50);
  assert.ok(ok.b, `made in time (${JSON.stringify(ok.R.adminView().last)})`);
  assert.ok(ok.b.made <= ok.b.at * 1000 - 1000, `ready, recorded, before its slot (${(ok.b.at * 1000 - ok.b.made) / 1000} s before)`);
  assert.ok(ok.b.lines.length >= 2, `${ok.b.lines.length} lines`);
  assert.ok(ok.asked.every(ms => ms <= 30000), `each turn waits only for the time left (${ok.asked})`);
  const slow = await run(400);
  assert.equal(slow.R.breaks.size, 0, 'brains too slow: nothing aired');
  assert.ok(['too_short', 'no_time', 'late'].includes(slow.R.adminView().last.velvet?.error), JSON.stringify(slow.R.adminView().last));
});
