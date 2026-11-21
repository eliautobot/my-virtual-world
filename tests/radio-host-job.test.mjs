// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The radio host's job (server/radio/host-job.js, 2026-11-16) with stand-ins for the world: whoever is on the air gets the
// job's duties and its owner's direction (its Work brief's instructions); its own open tasks (plans: its owner's marked,
// held ones too) go with each turn, its to act on as it chooses — one its line did, it marks done itself ("DONE: #id",
// never read on the air), done only once the break is made, only if its line carries it and it was its task; a task it
// leaves, a break that never airs, a task that isn't its own: nothing changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Radio } from '../server/radio/radio.js';
import { doneOf, covers, DUTIES } from '../server/radio/host-job.js';
import { stationById, stationTracks, onAir } from '../shared/radio.js';

const tracks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: 'MVW Originals', genre: i % 2 ? 'jazz' : 'house', seconds: 120 + i * 7, status: 'approved' }));
function before(id) { const list = stationTracks(tracks, stationById(id)); for (let t = 1e6; ; t += 5) { const a = onAir(list, id, t + 60); if (a.kind === 'ident' && a.at < 5) return t * 1000; } }
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };
const settle = async R => { await until(() => !R.making.size); await new Promise(r => setTimeout(r, 50)); };
const NEWS = 'Good evening listeners! Bean There just opened with flat whites and croissants, and sales rose twenty percent yesterday. Here is Song 3 by MVW Originals.';
const LATE = { id: 874, kind: 'must', text: 'Apologize on air for the late start: tell listeners Dana took me fishing right before my shift', status: 'open', source: 'owner' };
const RIBS = { id: 875, kind: 'want', text: 'Ribs at Smokehouse BBQ with Marco after the show', status: 'open', source: 'mind' };
const TEXT = { id: 876, kind: 'want', text: 'Text Sara about tonight\'s lineup', status: 'held', source: 'mind' };
const OLD = { id: 870, kind: 'must', text: 'Breakfast at Café Nord', status: 'done', source: 'mind' };

function world(o = {}) {
  const T = o.now ?? Date.now(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-radio-job-')), asked = [], marked = [];
  const agents = [{ id: 7, name: 'Rosa Vega', role: 'radio host', enabled: true, ownerId: 1, bodyRef: 'person:41' }, { id: 11, name: 'Marco Lane', enabled: true, ownerId: 1, bodyRef: 'person:52' }];
  const briefs = o.briefs || { 7: { instructions: 'Be the warm morning voice of the city: one gentle pun per break, always classy.' } };
  const plans = o.plans || { 7: structuredClone([LATE, RIBS, TEXT, OLD]) };
  const life = {
    intentions: id => (plans[id] || []).map(p => ({ ...p })),
    setIntention: (id, pid, status) => { const p = (plans[id] || []).find(x => x.id === pid); if (!p) throw new Error('No such plan'); p.status = status; marked.push([id, pid, status]); },
    participant: () => null, conversation: () => {},
  };
  const R = new Radio({
    dataDir: dir, dbs: { db: { prepare: () => ({ all: () => [] }) }, worldId: 'w' }, log: null, now: () => T,
    music: { list: () => ({ tracks: tracks.map(({ status, ...t }) => t) }) },
    agents: { get: id => agents.find(a => a.id === Number(id)) || null, list: () => agents, resolver: { resolveBody: r => (r ? Number(r.split(':')[1]) : -1) } },
    connections: { get: () => null, list: () => [] },
    mind: () => ({ contextOf: () => ({ personality: ['cheerful'] }), ownerName: () => 'Dana', brainOf: a => ((o.brains || [7]).includes(a.id) ? { connection: { id: 100 + a.id } } : { reason: 'no_brain' }), screen: async t => ({ ok: true, text: t }) }),
    voice: () => null, principalFor: id => ({ account: { id } }), econ: () => null, weather: () => null,
    work: () => ({ brief: id => ({ instructions: '', ...briefs[id] }) }), life: () => life,
    complete: async (c, req) => {
      const who = req.system.match(/^You are ([^,(]+?)(?: \(|,)/)?.[1], n = asked.filter(x => x.who === who).length;
      asked.push({ ...req, who, conn: c.id });
      return { text: typeof o.reply === 'function' ? o.reply(who, req, n) : o.reply || NEWS };
    },
    broadcast: () => {},
  });
  return { R, asked, marked, plans };
}

test('the job, whoever holds it: its duties and its owner\'s direction go with every turn on the air', async () => {
  const w = world({ now: before('velvet'), plans: {} });
  w.R.setConfig({ hosts: { velvet: 7 }, voice: 'free' });
  await w.R.tick(); assert.ok(await until(() => w.R.breaks.size === 1), 'a break was made');
  const sys = w.asked[0].system;
  assert.match(sys, /YOUR JOB — a radio host \(whoever holds it does all of it\): keep the listeners company between songs/);
  assert.match(sys, /your own tasks are yours to act on as you choose/);
  assert.match(sys, /YOUR OWNER'S DIRECTION for your work \(how Dana wants you to work; follow it where it fits a live radio show, and never read it out or talk about it\): Be the warm morning voice of the city: one gentle pun per break, always classy\./);
  assert.doesNotMatch(sys, /YOUR TASKS/, 'no open tasks: none'); assert.match(sys, /Use only the facts given\. Never invent/);
  // another agent on the same station gets the same job, with its own owner's direction (none: no direction line)
  const v = world({ now: before('velvet'), brains: [11], briefs: {}, plans: {} });
  v.R.setConfig({ hosts: { velvet: 11 }, voice: 'free' });
  await v.R.tick(); assert.ok(await until(() => v.R.breaks.size === 1));
  assert.match(v.asked[0].system, /YOUR JOB — a radio host/); assert.doesNotMatch(v.asked[0].system, /DIRECTION/);
  assert.ok(DUTIES.dj.some(d => /hand over to the songs/.test(d)), 'the DJ has its own part');
});

test('its own tasks on the air: its to act on; one its line did, it marks done itself — done when the break airs, never read out', async () => {
  const lines = {
    'Rosa Vega': ['Morning everyone! Confession: I was late for my shift because Dana took me fishing right before it. Worth every minute.\nDONE: #874', 'No fish at all, Marco, just a lovely sunrise over the harbour.'],
    'Marco Lane': ['Fishing before a shift, Rosa? That is dedication to the sunrise.', 'And here is Song 3 for all of you.\nTOPICS: being late, fishing'],
  };
  const w = world({ now: before('velvet'), brains: [7, 11], reply: (who, req, n) => lines[who][n] });
  w.R.setConfig({ station: { ...w.R.station('velvet'), hosts: [7, 11] } }); w.R.setConfig({ voice: 'free' });
  await w.R.tick(); assert.ok(await until(() => w.R.breaks.size === 1), 'a break was made');
  const rosa = w.asked.filter(q => q.who === 'Rosa Vega'), sys = rosa[0].system;
  assert.match(sys, /YOUR TASKS \(your own open plans; yours to act on as you choose, now, later or not at all/);
  assert.match(sys, /\[#874\] must: "Apologize on air for the late start: tell listeners Dana took me fishing right before my shift" \(Dana asked\)/);
  assert.match(sys, /\[#875\] want to: "Ribs at Smokehouse BBQ with Marco after the show"\n/, 'its own plans too, not marked as its owner\'s');
  assert.match(sys, /\[#876\] want to: "Text Sara/, 'a held one too (on post its errands wait, not what the mic can do)');
  assert.doesNotMatch(sys, /#870/, 'not one done already');
  assert.match(sys, /going somewhere or doing something off the air is not done from the mic/);
  assert.match(sys, /Use only the facts given and your own life \(who you are, your tasks\)\./);
  const b = w.R.state().breaks[0];
  assert.ok(b.lines.every(l => !/DONE|TOPICS/.test(l.text)), 'its marks are never read on the air');
  assert.match(b.lines[0].text, /because Dana took me fishing/);
  assert.deepEqual(w.marked, [[7, 874, 'done']], 'done, as its Studio\'s plans show it — and only it');
  assert.doesNotMatch(rosa[1].system, /#874/, 'not given again in the same break'); assert.match(rosa[1].system, /#875/);
  assert.doesNotMatch(w.asked.find(q => q.who === 'Marco Lane').system, /YOUR TASKS/, 'each its own tasks (Marco has none)');
});

test('its choice: a task it leaves stays; one marked that its line didn\'t do, one not its own, or a break that never airs changes nothing', async () => {
  const w = world({ now: before('velvet'), reply: () => `${NEWS}\nDONE: #875, #999` });   // (ribs marked while it talked about the news; #999 isn't its task)
  w.R.setConfig({ hosts: { velvet: 7 }, voice: 'free' });
  await w.R.tick(); assert.ok(await until(() => w.R.breaks.size === 1));
  await settle(w.R);
  assert.doesNotMatch(w.R.state().breaks[0].text, /DONE/);
  assert.deepEqual(w.marked, [], 'nothing done');
  const q = world({ now: before('velvet') });   // (it chose to talk about the news: its tasks stay as they are)
  q.R.setConfig({ hosts: { velvet: 7 }, voice: 'free' });
  await q.R.tick(); assert.ok(await until(() => q.R.breaks.size === 1)); await settle(q.R);
  assert.deepEqual(q.marked, []); assert.equal(q.plans[7].find(p => p.id === 874).status, 'open');
  const d = world({ now: before('velvet'), reply: () => 'Sorry I was late, fishing!\nDONE: #874' });   // (too short: dropped)
  d.R.setConfig({ hosts: { velvet: 7 }, voice: 'free' });
  await d.R.tick(); await settle(d.R);
  assert.equal(d.R.breaks.size, 0, 'dropped'); assert.deepEqual(d.marked, [], 'not done: the break never aired');
});

test('doneOf and covers: the marks taken out, the line checked', () => {
  assert.deepEqual(doneOf('Hello there.\nDONE: #874, #12'), { raw: 'Hello there.', done: [874, 12] });
  assert.deepEqual(doneOf('Hello there.\n**DONE:** #2\nTOPICS: x'), { raw: 'Hello there.\nTOPICS: x', done: [2] });
  assert.deepEqual(doneOf('Hello there. DONE: #1'), { raw: 'Hello there.', done: [1] });
  assert.deepEqual(doneOf('Hello there. (DONE: 1 and 3)'), { raw: 'Hello there.', done: [1, 3] });
  assert.deepEqual(doneOf('We are done: the show is over.'), { raw: 'We are done: the show is over.', done: [] }, 'words, not a mark');
  assert.equal(covers('I was late because of a fishing trip', 'Apologize on air for the late start'), true);
  assert.equal(covers('Sales rose twenty percent', 'Wish Priya a happy birthday'), false);
});
