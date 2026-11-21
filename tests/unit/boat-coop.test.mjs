// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Fishing together on one boat (server/world/boats.js; 2026-11-19, the product owner: "make it work like a multiplayer co-op so up to 4
// players can fish together"): another player comes aboard a boat that's out and stopped — the skipper's friend at once,
// anyone else when the skipper lets them —; the deck's room (its anglers, four players at most, the companions aboard
// counted); a crew member carried along where they stand, their deck place from their page; stepping off alongside or
// leaving (back on the dock); everyone ashore with the skipper; kept across a restart.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harbour, MAX_PLAYERS } from '../../server/world/boats.js';
import { fitToShore } from '../../shared/dock-layout.js';
import { boatSlips } from '../../shared/world-modules.js';
import { BOATS } from '../../shared/boat-model.js';

const env = { heightAt: (x) => (x > 0 ? 0.5 + x * 0.02 : x * 0.03), waterAt: (x) => (x < 0 ? { kind: 'sea', level: 0 } : null), isWater(x, z) { return !!this.waterAt(x, z); }, roads: null };
const world = { grid: { cols: 2, rows: 2 }, buildings: [], decorations: [], stations: [], worldModules: [{ kind: 'marina', ...fitToShore('marina', 40, 300, env), wy: 0, y: 2, id: 'wm1', name: 'Test Marina' }] };
const memStore = () => { const m = new Map(); return { m, save: (k, v) => m.set(k, JSON.parse(JSON.stringify(v))), load: k => m.get(k) ?? null }; };
const ws = pid => ({ pid, readyState: 1, out: [], send(s) { this.out.push(JSON.parse(s)); } });
function rig({ store = memStore(), T = { now: 1e9 } } = {}) {
  const sent = [], players = { byId: new Map(), nav: null, canPlay: () => true, toAccount: (id, m) => sent.push({ ...m, to: id }) };
  const H = new Harbour({ world: () => world, players, store, now: () => T.now, groundAt: env.heightAt, waterAt: env.waterAt });
  return { H, players, sent, store, T };
}
const person = (id, name, at) => ({ id, name, x: at.x, y: at.y, z: at.z, ctx: -1, yaw: 0, ver: 1, flags: 0 });
const lastTo = (R, id, t) => R.sent.filter(m => m.to === id && (!t || m.t === t)).at(-1);

/** A skipper (7, Kim) out of the slip and stopped a few metres off, the others on the dock beside it. */
function out(R) {
  const slip = boatSlips(world)[0], kimP = person(7, 'Kim', slip);
  R.players.byId.set(7, kimP);
  const w7 = ws(7);
  R.H.board(w7, { id: slip.id });
  R.T.now += 1000; R.H.pose(w7, { x: slip.x - 3, y: slip.y, z: slip.z, h: slip.yaw, v: 0, ts: 1 });
  const b = R.H.all.get(slip.id);
  return { slip, b, kimP, w7 };
}

test('come aboard: the skipper\'s friend at once, anyone else asks and the skipper decides; carried along where they stand', () => {
  const R = rig(), { slip, b, w7 } = out(R);
  R.H.friends = (a, x) => (a === 7 && x === 8) || (a === 8 && x === 7);
  const ann = person(8, 'Ann', slip), bo = person(9, 'Bo', slip);
  R.players.byId.set(8, ann); R.players.byId.set(9, bo);
  const w8 = ws(8), w9 = ws(9);
  R.H.join(w8, { id: slip.id });
  const s8 = w8.out.at(-1);
  assert.equal(s8.ok, true, 'a friend comes straight aboard');
  assert.equal(s8.guest, true); assert.equal(s8.skipperName, 'Kim'); assert.equal(s8.id, slip.id);
  assert.equal(ann.boatId, slip.id); assert.equal(R.H.boatOf(8), b); assert.deepEqual(R.H.playersOn(b), [7, 8]);
  assert.ok(lastTo(R, 7, 'bcrew')?.crew.some(c => c.name === 'Ann'), 'the skipper\'s page told');
  // not a friend: asks
  R.H.join(w9, { id: slip.id });
  assert.equal(w9.out.at(-1).ok, false); assert.equal(w9.out.at(-1).pending, true, 'asked, waiting');
  assert.equal(bo.boatId ?? null, null, 'not aboard yet');
  const ask = lastTo(R, 7, 'bask');
  assert.equal(ask.from, 9); assert.equal(ask.name, 'Bo');
  R.H.answer(ws(8), { who: 9, yes: true });
  assert.equal(bo.boatId ?? null, null, 'only the skipper answers');
  R.H.answer(w7, { who: 9, yes: true });
  assert.equal(bo.boatId, slip.id, 'let aboard');
  assert.equal(lastTo(R, 9, 'bstate').guest, true);
  const spots = [...b.guests.values()].map(g => g.spot);
  assert.equal(new Set(spots).size, 2, 'each at a fishing spot of their own');
  // carried along: the skipper drives on; the crew where they stand on the deck
  for (let k = 2; k <= 6; k++) { R.T.now += 1000; R.H.pose(w7, { x: slip.x - 3 - 4 * (k - 1), y: slip.y, z: slip.z, h: slip.yaw, v: 4, ts: k }); }
  const g8 = b.guests.get(8), hm = R.H.helmOf(b, b.pose, g8.dk.at);
  assert.ok(Math.hypot(ann.x - hm.x, ann.z - hm.z) < 1e-6, 'Ann carried along with the boat at her place on the deck');
  // her page says where she walked: a place on the deck, not over the side
  const D = BOATS[b.type].deck.spots[0];
  R.H.deck(w8, { dk: [D.x, D.y, D.z, 0.4, 3] });
  assert.deepEqual(b.guests.get(8).dk.at, [D.x, D.y, D.z]); assert.equal(ann.clip, 3);
  R.H.deck(w8, { dk: [40, 0, 0, 0, 0] });
  assert.deepEqual(b.guests.get(8).dk.at, BOATS[b.type].helm, 'off the deck: refused (the helm, as a skipper\'s would be)');
  // the pages near draw everyone aboard on its deck (riding it, not trailing it): the skipper's own page too
  const look = id => { const pg = ws(id); pg.view = { x: b.pose.x, z: b.pose.z }; R.H.ver++; R.H.tick([pg]); return pg.out.at(-1); };
  const seen = look(99).aboard.map(r => [r[0], r[1]]), mine = look(7).aboard.map(r => [r[0], r[1]]);
  assert.deepEqual(seen.sort(), [[slip.id, 7], [slip.id, 8], [slip.id, 9]], 'a bystander\'s page: the skipper and the crew on the boat');
  assert.deepEqual(mine.filter(r => r[1] !== 7).sort(), [[slip.id, 8], [slip.id, 9]], 'the skipper\'s page: its crew on its own boat');
  assert.deepEqual(look(99).aboard.find(r => r[1] === 8).slice(2, 5), [...BOATS[b.type].helm], 'where she stands on it (her last place: by the helm)');
  // under way: nobody else gets on
  const cy = person(10, 'Cy', b.pose); R.players.byId.set(10, cy);
  R.H.friends = () => true;
  const w10 = ws(10); R.H.join(w10, { id: slip.id });
  assert.equal(w10.out.at(-1).ok, false); assert.match(w10.out.at(-1).text, /under way/);
  // a crew member can't steer: their page's poses are not the boat's
  const before = { ...b.pose }; R.H.pose(w8, { x: before.x + 1, y: before.y, z: before.z, h: 0, v: 0, ts: 99 });
  assert.equal(b.pose.x, before.x, 'only the skipper drives');
});

test('the deck\'s room: the boat\'s anglers shared by players and companions, four players at most', () => {
  const R = rig(), { slip, b } = out(R);
  R.H.friends = () => true;
  const A = BOATS[b.type].anglers;
  assert.ok(A <= MAX_PLAYERS || MAX_PLAYERS === 4);
  let companions = 1;
  R.H.crewCount = () => companions;
  const ids = [], pages = new Map();
  for (let k = 0; k < A + 1; k++) {
    const id = 20 + k; ids.push(id);
    R.players.byId.set(id, person(id, `P${k}`, slip));
    const w = ws(id); pages.set(id, w); R.H.join(w, { id: slip.id });
  }
  const aboard = R.H.playersOn(b);
  assert.equal(aboard.length, Math.min(MAX_PLAYERS, A - companions), `players aboard: the anglers less the companion (${aboard.join(', ')})`);
  const refused = ids.filter(id => !aboard.includes(id));
  assert.ok(refused.length >= 1);
  assert.match(pages.get(refused[0]).out.at(-1).text, /full/, 'refused, plainly');
  companions = 0;
  const w = ws(refused[0]); R.H.join(w, { id: slip.id });
  assert.equal(R.H.playersOn(b).length, Math.min(MAX_PLAYERS, A), 'room when the companion is gone');
});

test('stepping off and leaving; everyone ashore with the skipper; the skipper gone; a restart', () => {
  const R = rig(), { slip, b, w7, kimP } = out(R);
  R.H.friends = () => true;
  const ann = person(8, 'Ann', slip), bo = person(9, 'Bo', slip);
  R.players.byId.set(8, ann); R.players.byId.set(9, bo);
  const w8 = ws(8), w9 = ws(9);
  R.H.join(w8, { id: slip.id }); R.H.join(w9, { id: slip.id });
  // out at sea, under way: Ann can't step off — she leaves: the harbour launch takes her back to the dock
  for (let k = 2; k <= 9; k++) { R.T.now += 1000; R.H.pose(w7, { x: slip.x - 3 - 6 * (k - 1), y: slip.y, z: slip.z, h: slip.yaw, v: 6, ts: k }); }
  R.H.exit(w8);
  assert.equal(ann.boatId, b.id); assert.match(w8.out.at(-1).text, /stop/i);
  R.H.leave(w8);
  assert.equal(ann.boatId, null); assert.equal(R.H.boatOf(8), null);
  const dock = R.H.besideSlip(b);
  assert.ok(Math.hypot(ann.x - dock.x, ann.z - dock.z) < 0.01, 'back on the dock by the slip');
  assert.match(lastTo(R, 8, 'pmoved').text, /launch/);
  assert.deepEqual(R.H.playersOn(b), [7, 9]);
  // the restart: Bo kept aboard with the boat; back where he stood when he is back
  R.H.close();
  const saved = R.store.m.get('harbour').boats[0];
  assert.deepEqual(saved.guests.map(g => [g.account, g.name]), [[9, 'Bo']]);
  R.T.now += 30000;
  const B = rig({ store: R.store, T: R.T }), b2 = B.H.all.get(slip.id);
  const bo2 = person(9, 'Bo', { x: 0, y: 0, z: 0 }), eli2 = person(7, 'Kim', { x: 0, y: 0, z: 0 });
  B.players.byId.set(9, bo2); B.players.byId.set(7, eli2);
  assert.equal(B.H.resume(9), b2, 'Bo back aboard (the skipper not back yet)');
  assert.equal(bo2.boatId, slip.id); assert.equal(B.H.stateFor(9).guest, true, 'his page told: aboard as crew');
  assert.equal(B.H.resume(7), b2); assert.equal(eli2.boatId, slip.id, 'Kim back at the helm');
  // the skipper's page closes for good: the crew back on the dock, the boat home
  B.H.forgetAccount(7);
  assert.equal(bo2.boatId, null); assert.equal(b2.mode, 'slip');
  assert.match(B.sent.filter(m => m.to === 9 && m.t === 'pmoved').at(-1).text, /left/);
  void kimP;
});

test('in with the skipper alongside: the crew steps ashore with them', () => {
  const R = rig(), { slip, b, w7 } = out(R);
  R.H.friends = () => true;
  const ann = person(8, 'Ann', slip); R.players.byId.set(8, ann);
  R.H.join(ws(8), { id: slip.id });
  // back in the slip, stopped: the skipper steps off — Ann with them
  R.T.now += 1000; R.H.pose(w7, { x: slip.x, y: slip.y, z: slip.z, h: slip.yaw, v: 0, ts: 50 });
  R.H.exit(w7);
  assert.equal(b.skipper, null); assert.equal(ann.boatId, null, 'ashore with the skipper');
  assert.equal(R.H.byGuest.size, 0);
  assert.ok(Math.abs(ann.y - slip.y) < 6);
});

test('a page closed out at sea: the boat waits for its skipper (crew and all) and they are kept beside the slip meanwhile; back in time: at the helm; not back: the boat home, every one of them beside its slip; an "aboard" no boat backs: let go', () => {
  const R = rig(), { slip, b, w7, kimP } = out(R);
  R.H.friends = () => true;
  const ann = person(8, 'Ann', slip); R.players.byId.set(8, ann);
  R.H.join(ws(8), { id: slip.id });
  for (let k = 2; k <= 6; k++) { R.T.now += 1000; R.H.pose(w7, { x: slip.x - 3 - 6 * (k - 1), y: slip.y, z: slip.z, h: slip.yaw, v: 0, ts: k }); }
  const placed = [];
  R.players.placeSaved = (id, at) => placed.push([id, at]);
  // Ann's page goes (past its grace): off the boat for now, her place kept aboard; Kim's: the boat waits out there
  const atA = R.H.forgetAccount(8, { keep: true }); R.players.byId.delete(8);
  const at = R.H.forgetAccount(7, { keep: true }); R.players.byId.delete(7);
  const dock = R.H.besideSlip(b);
  assert.deepEqual([at, atA], [dock, dock], 'where they are to be found meanwhile: beside the slip, never in the sea');
  assert.equal(b.mode, 'out'); assert.equal(R.H.boatOf(7), b, 'the boat waits for him out where it was');
  assert.ok(b.resumeUntil > R.T.now);
  assert.deepEqual(b.guestsWaiting.map(g => g.account), [8], 'Ann\'s place kept');
  R.H.close(); assert.deepEqual(R.store.m.get('harbour').boats[0].guests.map(g => g.account), [8], '(and across a restart)');
  // Kim back within the wait: at the helm, out at sea
  R.T.now += 60e3;
  const eli2 = person(7, 'Kim', dock); R.players.byId.set(7, eli2);
  assert.equal(R.H.resume(7), b);
  assert.equal(eli2.boatId, b.id); assert.ok(Math.hypot(eli2.x - b.pose.x, eli2.z - b.pose.z) < 5, 'at the helm');
  assert.equal(R.H.stateFor(7).resumed, true);
  // he goes again, and stays away: the boat home after the wait, both kept beside the slip
  R.H.forgetAccount(7, { keep: true }); R.players.byId.delete(7);
  R.T.now += 11 * 60e3; R.H.tick([]);
  assert.equal(b.mode, 'slip', 'home');
  assert.equal(R.H.boatOf(7), null);
  assert.deepEqual(placed.map(p => p[0]).sort(), [7, 8], 'the skipper and the crew that were away: beside the slip');
  void kimP; void w7;
  // a player whose boat went home without them, "aboard" still: let go
  const ghost = person(9, 'Cy', slip); ghost.boatId = slip.id; R.players.byId.set(9, ghost);
  assert.equal(R.H.heal(ghost), true); assert.equal(ghost.boatId, null);
  assert.equal(R.H.heal(ghost), false, 'nothing to let go twice');
  // an account deleted (no keep): the boat home at once
  const R2 = rig(), o2 = out(R2);
  R2.H.forgetAccount(7);
  assert.equal(o2.b.mode, 'slip');
});
