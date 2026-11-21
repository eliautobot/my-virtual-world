// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing docks' boats on the server (docs/features/fishing.md §Boats): one per slip (shared/world-modules.js
// boatSlips), as the airport's aircraft (server/world/aircraft.js). A player on the dock beside a free boat takes it
// (bboard) and drives it in the browser (shared/boat-model.js); the server takes its poses (bpose: ten a second, each
// checked against the boat's top speed — a jump is refused and the skipper corrected), keeps the skipper's player at its
// helm (so the area of interest, the online list and proximity chat follow, and others see them standing there), and
// sends everyone near the boats that are out of their slips (harbour: five a second, nearby ones only; the ids of every
// boat out to all, so no moored copy is drawn twice). Stopped alongside a dock or the shore, the skipper steps off
// (bexit); a boat left away from its slip waits a few minutes, then the harbour master brings it back. Leaving Play
// mode while out: the boat goes home and the skipper stands on the dock beside its slip.
// A restart of the server (2026-11-19, the product owner: out fishing with Lara and Sam, the server restarted — the boat gone, all three of
// them in the water; then a new boat "wasn't moving"): the boats out are saved (the store's harbour.json: where each is,
// whose, who of the companions is aboard at which spot) and back where they were after it; the skipper's page, when it
// connects again within RESUME_MS, is back at the helm (resume), the companions back at their spots (onResume: server/play/
// fishing-crew.js resumeCrew). A page still driving a boat the harbour doesn't give it is told so (bgone) and lets it go —
// never two boats, one moving on the page and one standing still on the server.
// Fishing together (2026-11-19, the product owner: "make it work like a multiplayer co-op so up to 4 players can fish together"): other
// players come aboard a boat that's out and stopped (bjoin) — its skipper's friends straight away, anyone else when the
// skipper lets them (bask → banswer) — as its crew: up to the boat's anglers (shared/boat-model.js), players and companions
// together, four players at most. A crew member walks the deck and fishes (bdeck: where they stand, what they do), carried
// along with the boat; steps off alongside a dock or the shore (bexit) or leaves (bleave: back on the dock by its slip);
// all of them ashore with their skipper when the boat goes in. Kept across a restart as the skipper is.
import { boatSlips, moduleDecks, deckUnder } from '../../shared/world-modules.js';
import { BOATS, maxBoatSpeed, deckFloor } from '../../shared/boat-model.js';

const BOARD_RANGE = 7.5;        // m from the boat's middle (from the walkway at its stern, or a dock alongside)
const NEAR = 3000;              // m: boats this far from a viewer are sent with their poses
const PARK_MS = 5 * 60e3;       // a boat left away from its slip waits this long for its skipper
const HOME_RANGE = 14;          // m: left this close to its slip, it goes straight back in
const STOP = 1.5;               // m/s: slow enough to step off
const RESUME_MS = 10 * 60e3;    // a skipper away when the server restarted: its boat waits this long for it, out where it was
const SAVE_MS = 5000;           // the boats out are saved at most this often (and when the server stops)
const RESTORE_MAX_MS = 60 * 60e3;   // a save older than this (the server long down): the boats are back in their slips
const GONE_MS = 2000;           // a page driving a boat it doesn't have is told so at most this often
export const MAX_PLAYERS = 4;   // players on one boat at most (its skipper and its crew), however many anglers it takes
const ASK_MS = 40e3;            // a request to come aboard waits this long for the skipper's answer (their note shows 30 s)
const JOIN_RANGE = 9;           // m from the boat's middle: close enough to step aboard (from a dock alongside, or the shore)
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

export class Harbour {
  /** @param o { world(), players (server/world/players.js), now?, log?, groundAt(x, z), waterAt(x, z) } */
  constructor({ world, players, now = () => Date.now(), log = null, groundAt = () => 0, waterAt = () => null, store = null }) {
    Object.assign(this, { world, players, now, log, groundAt, waterAt, store });
    this.all = new Map();       // slip id → boat
    this.bySkipper = new Map(); // account id → boat
    this.byGuest = new Map();   // account id → the boat it is aboard as crew (b.guests: account id → { name, spot, dk })
    this.asks = new Map();      // account id → { boat, at }: asked its skipper to come aboard
    // whether two accounts are friends (their friends come straight aboard): set by the server (server/world/friends.js)
    this.friends = () => false;
    // the companions aboard a boat — how many (the deck's room is shared with them): set by the server (fishing-crew)
    this.crewCount = () => 0;
    this.ver = 0; this.sentVer = -1; this.lastFull = 0; this.decksOf = null; this.decks = [];
    // the companions aboard (server/play/fishing-crew.js rows: [boat id, body index, spot, phase, seq]), sent with the boats
    this.crewRows = () => [];
    // the companions aboard a boat, to save with it ([{ agent, spot }]), and putting them back aboard when its skipper is
    // back after a restart ((boat, [{ agent, spot }]) → …): server/play/fishing-crew.js (set by the server)
    this.crewOf = () => [];
    this.onResume = null;
    this.savedVer = -1; this.savedAt = 0; this.closed = false;
    this.sync();
    this.restore();
  }
  /** The slips changed (a dock placed, moved or removed): new boats in new slips, gone ones gone. */
  sync() {
    const seen = new Set();
    for (const s of boatSlips(this.world())) {
      seen.add(s.id);
      const home = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, deck: s.deck };
      const b = this.all.get(s.id);
      if (b) { b.home = home; if (b.mode === 'slip') b.pose = this.slipPose(b); continue; }
      const n = { id: s.id, type: s.kind, module: s.module, home, mode: 'slip', skipper: null, skipperName: '', pose: null, at: 0, returnAt: 0 };
      n.pose = this.slipPose(n);
      this.all.set(s.id, n);
    }
    for (const [id, b] of this.all) if (!seen.has(id)) { if (b.skipper != null) this.release(b, null, 'The dock closed'); this.all.delete(id); }
    this.ver++;
  }
  slipPose(b) { return { x: b.home.x, y: b.home.y, z: b.home.z, h: b.home.yaw, p: 0, r: 0, v: 0, l: 0 }; }
  place(b) { return b.pose || this.slipPose(b); }
  decksNow() { const W = this.world(); if (this.decksOf !== W.worldModules) { this.decksOf = W.worldModules; this.decks = moduleDecks(W); } return this.decks; }
  /** Where the skipper stands at the helm (shared/boat-model.js BOATS helm) — or at a point H of the deck — for a pose. */
  helmOf(b, pose, H = BOATS[b.type].helm) {
    const c = Math.cos(pose.h), s = Math.sin(pose.h);
    return { x: pose.x + H[0] * c + H[2] * s, y: pose.y + H[1], z: pose.z - H[0] * s + H[2] * c };
  }
  /**
   * Where on the deck the client says its player is, and what they're doing (dk: [x, y, z, facing, clip], the boat's
   * frame — the fishing game's walking about): { at, yaw, clip } if it's somewhere one can stand on that boat
   * (shared/boat-model.js deckFloor), else the helm.
   */
  deckOf(b, dk) {
    const helm = { at: BOATS[b.type].helm, yaw: 0, clip: 0 };
    if (!Array.isArray(dk) || dk.length < 5) return helm;
    const [x, y, z, yaw] = dk.slice(0, 4).map(num), clip = (num(dk[4]) | 0) & 127;
    if (![x, y, z, yaw].every(Number.isFinite)) return helm;
    const fl = deckFloor(b.type, x, z);
    if (fl == null || Math.abs(fl - y) > 0.06) return { ...helm, clip };
    return { at: [r2(x), fl, r2(z)], yaw: r3(Math.max(-7, Math.min(7, yaw))), clip };
  }

  // ---------------------------------------------------------------- messages
  board(ws, m) {
    const P = this.players, p = ws.pid != null ? P.byId.get(ws.pid) : null;
    const no = text => this.send(ws, { t: 'bstate', ok: false, text });
    if (!p || !P.canPlay(ws)) return no('Enter Play mode to take a boat');
    if (p.vehicleId || p.aircraftId) return no('Leave the vehicle first');
    if (p.boatId) return no('You are in a boat already');
    if (p.ctx !== -1) return no('Walk down to the boat first');
    const b = this.all.get(String(m.id || ''));
    if (!b) return no('That boat is not here any more');
    if (b.skipper != null) return no(`${b.skipperName || 'Someone'} has it out`);
    const at = this.place(b);
    if (Math.hypot(p.x - at.x, p.z - at.z) > BOARD_RANGE || Math.abs(p.y - at.y) > 4) return no('Walk down to it first');
    b.skipper = p.id; b.skipperName = p.name || ''; b.mode = 'out'; b.at = this.now(); b.ts = null; b.returnAt = 0;
    this.bySkipper.set(p.id, b);
    p.boatId = b.id; p.clip = 0; const hm = this.helmOf(b, at); p.x = hm.x; p.y = hm.y; p.z = hm.z; p.yaw = at.h; p.ver++; p.dirty = true;
    this.ver++;
    this.send(ws, { t: 'bstate', ok: true, id: b.id, type: b.type, pose: at, home: b.home, module: b.module });
  }
  pose(ws, m) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null, b = p ? this.bySkipper.get(p.id) : null;
    if (!b) { if (p) this.gone(ws, p); return; }
    const x = num(m.x), y = num(m.y), z = num(m.z), h = num(m.h), pi = num(m.p), ro = num(m.r);
    if (![x, y, z, h].every(Number.isFinite)) return;
    const now = this.now(), last = b.pose;
    // how long passed: by arrival, or the boat's own clock (ts) when that says more — never more than really passed
    let dt = (now - b.at) / 1000;
    const ts = num(m.ts);
    if (Number.isFinite(ts)) {
      if (b.ts == null || ts < b.ts) Object.assign(b, { ts0: ts, at0: now });
      else dt = Math.max(dt, Math.min(ts - b.ts, (now - b.at0) / 1000 + 2 - (b.ts - b.ts0)));
    }
    dt = Math.max(0.05, dt);
    const d = Math.hypot(x - last.x, z - last.z);
    if (d > maxBoatSpeed(b.type) * dt * 1.5 + 4 || y < b.home.y - 4 || y > b.home.y + 6) {   // faster than it goes, or off the water: put back
      this.send(ws, { t: 'bcorr', pose: last });
      b.at = now;
      return;
    }
    if (Number.isFinite(ts)) b.ts = ts;
    b.pose = { x: r2(x), y: r2(y), z: r2(z), h: r3(h), p: r3(Number.isFinite(pi) ? Math.max(-0.6, Math.min(0.6, pi)) : 0), r: r3(Number.isFinite(ro) ? Math.max(-0.6, Math.min(0.6, ro)) : 0),
      v: r2(Math.max(-15, Math.min(60, num(m.v) || 0))), l: Math.max(-1, Math.min(1, num(m.l) || 0)), an: m.an ? 1 : 0 };
    b.at = now;
    const dk = this.deckOf(b, m.dk), hm = this.helmOf(b, b.pose, dk.at);
    b.dk = dk;   // (where the skipper stands on deck: the pages near draw them on it — tick aboard)
    p.x = hm.x; p.y = hm.y; p.z = hm.z; p.yaw = b.pose.h + dk.yaw; p.clip = dk.clip; p.ctx = -1; p.lastAt = now; p.ver++; p.dirty = true;
    // (its crew carried along where they stand on the deck)
    if (b.guests?.size) for (const [id, g] of b.guests) { const q = this.players.byId.get(id); if (q && q.boatId === b.id) this.placeGuest(b, q, g.dk); }
    this.ver++;
  }
  /** Off the boat: stopped, alongside a dock or the shore — on to its deck or the dry land beside the boat. */
  exit(ws) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null;
    if (p && this.byGuest.has(p.id)) return this.guestExit(ws, p);
    const b = p ? this.bySkipper.get(p.id) : null;
    if (!b) return;
    const pose = b.pose;
    if (Math.abs(pose.v) > STOP) return this.send(ws, { t: 'bstate', ok: false, text: 'Stop first (Space: the lever to neutral)' });
    const point = this.stepOff(b, pose);
    if (!point) return this.send(ws, { t: 'bstate', ok: false, text: 'Bring it alongside a dock or the shore to step off' });
    const near = Math.hypot(pose.x - b.home.x, pose.z - b.home.z) < HOME_RANGE;
    this.release(b, point, near ? 'Back in its slip' : 'You stepped ashore');
    if (near) this.home(b); else { b.mode = 'moored'; b.returnAt = this.now() + PARK_MS; }
    this.ver++;
  }
  /** The skipper leaves Play mode while out: the boat goes home, the skipper stands on the dock beside its slip. */
  leave(ws) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null;
    if (p && this.byGuest.has(p.id)) return this.guestLeave(p);
    const b = p ? this.bySkipper.get(p.id) : null;
    if (!b) return;
    const pose = b.pose, near = Math.hypot(pose.x - b.home.x, pose.z - b.home.z) < HOME_RANGE;
    const point = Math.abs(pose.v) <= STOP ? this.stepOff(b, pose) : null;
    if (point && !near) { this.release(b, point, 'You stepped ashore'); b.mode = 'moored'; b.returnAt = this.now() + PARK_MS; }
    else { this.release(b, this.besideSlip(b), near ? 'Back in its slip' : 'You left the helm — the harbour master brought the boat back to its slip'); this.home(b); }
    this.ver++;
  }
  // ---------------------------------------------------------------- its crew of players (fishing together)
  /** The boat account id is on — at its helm or aboard as crew —, or null. */
  boatOf(id) { return this.bySkipper.get(id) || this.byGuest.get(id) || null; }
  /** The players aboard boat b: its skipper first, then its crew. */
  playersOn(b) { return b?.skipper != null ? [b.skipper, ...(b.guests ? b.guests.keys() : [])] : []; }
  /** Room aboard b for one more: its anglers less its players and the companions aboard; four players at most. */
  roomOn(b) {
    let comp = 0; try { comp = this.crewCount(b.id) || 0; } catch { comp = 0; }
    const players = this.playersOn(b).length;
    return players < MAX_PLAYERS && players + comp < BOATS[b.type].anglers;
  }
  /** A fishing spot of b for a new crew member: one nobody of its crew of players stands at, the bow and sides first. */
  guestSpot(b) {
    const S = BOATS[b.type], taken = new Set([...(b.guests?.values() || [])].map(g => g.spot));
    const order = S.deck.spots.map((sp, k) => k).sort((x, y) => (S.deck.spots[x].name === 'stern') - (S.deck.spots[y].name === 'stern'));
    return order.find(k => !taken.has(k)) ?? 0;
  }
  /**
   * A player asks to come aboard boat m.id (out, its skipper aboard, stopped, close by): its skipper's friend comes straight
   * aboard; anyone else waits for the skipper's answer (bask to the skipper's pages; banswer). Refusals are said plainly.
   */
  join(ws, m) {
    const P = this.players, p = ws.pid != null ? P.byId.get(ws.pid) : null;
    const no = text => this.send(ws, { t: 'bstate', ok: false, text });
    if (!p || !P.canPlay(ws)) return no('Enter Play mode to go aboard');
    if (p.vehicleId || p.aircraftId) return no('Leave the vehicle first');
    if (p.boatId) return no('You are in a boat already');
    const b = this.all.get(String(m.id || ''));
    const why = this.cantJoin(b, p);
    if (why) return no(why);
    if (this.friends(b.skipper, p.id)) return this.aboard(b, p, ws);
    const was = this.asks.get(p.id);
    if (was && was.boat === b.id && this.now() - was.at < ASK_MS) return this.send(ws, { t: 'bstate', ok: false, pending: true, text: `Waiting for ${b.skipperName || 'the skipper'} to answer` });
    this.asks.set(p.id, { boat: b.id, at: this.now() });
    this.players.toAccount(b.skipper, { t: 'bask', from: p.id, name: String(p.name || 'Someone').slice(0, 40) });
    this.send(ws, { t: 'bstate', ok: false, pending: true, text: `Asked ${b.skipperName || 'the skipper'} to let you aboard…` });
  }
  /** Why player p can't come aboard b now (or null). */
  cantJoin(b, p) {
    if (!b || b.mode !== 'out' || b.skipper == null || b.resumeUntil) return 'Nobody has that boat out';
    if (b.skipper === p.id) return 'It is your own boat';
    if (p.ctx !== -1) return 'Walk down to the boat first';
    const at = this.place(b);
    if (Math.hypot(p.x - at.x, p.z - at.z) > JOIN_RANGE + BOATS[b.type].L / 2 || Math.abs(p.y - at.y) > 4) return 'Get closer to the boat first';
    if (Math.abs(at.v || 0) > STOP) return `${b.skipperName || 'The skipper'}'s boat is under way — wait for it to stop`;
    if (!this.roomOn(b)) return `${b.skipperName || 'The skipper'}'s ${BOATS[b.type].label} is full`;
    return null;
  }
  /** The skipper's answer to a request to come aboard: { who, yes }. */
  answer(ws, m) {
    const s = ws.pid != null ? this.players.byId.get(ws.pid) : null, b = s ? this.bySkipper.get(s.id) : null;
    const who = Number(m.who), ask = this.asks.get(who);
    if (!b || !ask || ask.boat !== b.id) return;
    this.asks.delete(who);
    const p = this.players.byId.get(who);
    if (!p) return;
    if (!m.yes) { this.players.toAccount(who, { t: 'bstate', ok: false, text: `${b.skipperName || 'The skipper'} said not this time` }); return; }
    if (this.now() - ask.at > ASK_MS) { this.players.toAccount(who, { t: 'bstate', ok: false, text: 'That took too long — ask again' }); return; }
    const why = p.boatId ? 'You are in a boat already' : this.cantJoin(b, p);
    if (why) { this.players.toAccount(who, { t: 'bstate', ok: false, text: why }); return; }
    this.aboard(b, p, null);
  }
  /** Player p aboard b as its crew, at a fishing spot (o.spot, o.dk: where they were, back after a restart). */
  aboard(b, p, ws, o = {}) {
    b.guests ||= new Map();
    const S = BOATS[b.type], spot = Number.isInteger(o.spot) && S.deck.spots[o.spot] ? o.spot : this.guestSpot(b), sp = S.deck.spots[spot];
    const dk = o.dk || { at: [sp.x, sp.y, sp.z], yaw: sp.yaw, clip: 0 };
    b.guests.set(p.id, { name: String(p.name || '').slice(0, 40), spot, dk });
    this.byGuest.set(p.id, b); this.asks.delete(p.id);
    p.boatId = b.id; p.clip = 0; this.placeGuest(b, p, dk);
    this.ver++;
    const msg = this.guestState(b, p.id, o.resumed);
    if (ws) this.send(ws, msg); else this.players.toAccount(p.id, msg);
    if (!o.resumed) this.players.toAccount(b.skipper, { t: 'bcrew', text: `${p.name || 'Someone'} came aboard`, crew: this.crewList(b) });
    try { this.onCrew?.(b); } catch (e) { this.log?.warn?.('[boats] the crew changed:', e.message); }
  }
  /** What a crew member's page needs: the boat (driven by its skipper), where they stand on it. */
  guestState(b, id, resumed = false) {
    const g = b.guests?.get(id);
    return { t: 'bstate', ok: true, guest: true, id: b.id, type: b.type, pose: b.pose, home: b.home, module: b.module, skipper: b.skipper, skipperName: b.skipperName, spot: g?.spot ?? 0, dk: g?.dk || null, crew: this.crewList(b), ...(resumed ? { resumed: true } : {}) };
  }
  crewList(b) { return this.playersOn(b).map(id => ({ id, name: id === b.skipper ? b.skipperName : b.guests?.get(id)?.name || '', skipper: id === b.skipper })); }
  /** Where crew member p stands now (the boat's pose and their place on its deck). */
  placeGuest(b, p, dk) {
    const hm = this.helmOf(b, b.pose, dk.at);
    p.x = hm.x; p.y = hm.y; p.z = hm.z; p.yaw = b.pose.h + (dk.yaw || 0); p.clip = dk.clip || 0; p.ctx = -1; p.lastAt = this.now(); p.ver++; p.dirty = true;
  }
  /** A crew member's page: where they stand on the deck and what they're doing (dk, as a skipper's bpose carries it). */
  deck(ws, m) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null, b = p ? this.byGuest.get(p.id) : null;
    if (!b) { if (p && !this.bySkipper.has(p.id)) this.gone(ws, p); return; }
    const g = b.guests.get(p.id), dk = this.deckOf(b, m.dk);
    g.dk = dk; this.placeGuest(b, p, dk);
  }
  /** A crew member steps off (the boat stopped alongside a dock or the shore). */
  guestExit(ws, p) {
    const b = this.byGuest.get(p.id), pose = b.pose;
    if (Math.abs(pose.v) > STOP) return this.send(ws, { t: 'bstate', ok: false, text: `Wait for ${b.skipperName || 'the skipper'} to stop` });
    const point = this.stepOff(b, pose);
    if (!point) return this.send(ws, { t: 'bstate', ok: false, text: `${b.skipperName || 'The skipper'} has to bring her alongside a dock or the shore for you to step off` });
    this.guestOff(b, p.id, point, 'You stepped ashore');
  }
  /** A crew member leaves (Play mode left, the page closed): ashore alongside when they can, else on the dock by the slip. */
  guestLeave(p) {
    const b = this.byGuest.get(p.id), pose = b.pose, point = Math.abs(pose.v) <= STOP ? this.stepOff(b, pose) : null;
    this.guestOff(b, p.id, point || this.besideSlip(b), point ? 'You stepped ashore' : 'You left the boat — the harbour launch took you back to the dock');
  }
  /** Crew member id off boat b (at point, told text; no point: just off — their page gone). */
  guestOff(b, id, point, text) {
    b.guests?.delete(id); this.byGuest.delete(id);
    const p = this.players.byId.get(id);
    if (p && p.boatId === b.id) {
      p.boatId = null; p.clip = 0;
      if (point) { p.x = point.x; p.y = point.y; p.z = point.z; p.ctx = -1; }
      p.ver++; p.dirty = true; p.lastAt = this.now();
      if (text) this.players.toAccount(id, { t: 'pmoved', x: p.x, y: p.y, z: p.z, ctx: -1, yaw: p.yaw, seq: p.seq, text, boat: 'out', home: true });
    }
    if (b.skipper != null && b.skipper !== id) this.players.toAccount(b.skipper, { t: 'bcrew', text: `${p?.name || 'Your crew'} got off`, crew: this.crewList(b) });
    this.ver++;
    try { this.onCrew?.(b); } catch (e) { this.log?.warn?.('[boats] the crew changed:', e.message); }
  }
  /** A dock's deck or the dry shore beside the boat within a stride, else null: { x, y, z }. */
  stepOff(b, pose) {
    const S = BOATS[b.type], decks = this.decksNow(), nav = this.players.nav, h = pose.h, fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
    for (const side of [1, -1]) for (const out of [S.B / 2 + 0.6, S.B / 2 + 1.4, S.B / 2 + 2.4]) for (const along of [0, -S.L * 0.3, S.L * 0.3, -S.L * 0.48]) {
      const x = pose.x + rx * side * out + fx * along, z = pose.z + rz * side * out + fz * along;
      const top = deckUnder(decks, x, z, pose.y + 2.5, 3);
      if (top !== null && top > pose.y - 1) return { x, y: top, z };
      if (!this.waterAt(x, z) && (!nav || nav.ok(x, z, -1))) { const g = this.groundAt(x, z); if (Math.abs(g - pose.y) < 2.5) return { x, y: g, z }; }
    }
    for (const along of [S.L / 2 + 0.8, S.L / 2 + 1.8]) {   // off the bow on to a dock or the beach it nosed up to
      const x = pose.x + fx * along, z = pose.z + fz * along, top = deckUnder(decks, x, z, pose.y + 2.5, 3);
      if (top !== null && top > pose.y - 1) return { x, y: top, z };
      if (!this.waterAt(x, z) && (!nav || nav.ok(x, z, -1))) { const g = this.groundAt(x, z); if (Math.abs(g - pose.y) < 2.5) return { x, y: g, z }; }
    }
    return null;
  }
  /** A page driving a boat this harbour doesn't give its player (the server restarted, the boat was taken home): told to let
   *  it go, where its player is (once every GONE_MS at most). */
  gone(ws, p) {
    const now = this.now();
    if (now - (ws.bgoneAt || 0) < GONE_MS) return;
    ws.bgoneAt = now;
    this.send(ws, { t: 'bgone', x: p.x, y: p.y, z: p.z, ctx: p.ctx, text: 'The boat is not yours any more — it went back to its slip' });
  }
  // ---------------------------------------------------------------- across a restart
  /** The boats away from their slips, as saved: [{ id, type, mode, pose, skipper, skipperName, returnAt, crew }]. */
  snapshot() {
    const out = [];
    for (const b of this.all.values()) {
      if (b.mode === 'slip') continue;
      let crew = [];
      try { crew = b.skipper != null ? (b.crewWaiting || this.crewOf(b.id) || []) : []; } catch { crew = []; }
      const guests = b.skipper != null ? (b.guestsWaiting || [...(b.guests || new Map())].map(([account, g]) => ({ account, name: g.name, spot: g.spot, dk: g.dk }))) : [];
      out.push({ id: b.id, type: b.type, mode: b.mode, pose: b.pose, skipper: b.skipper, skipperName: b.skipperName, returnAt: b.returnAt || 0,
        crew: crew.filter(c => Number.isInteger(c?.agent) && Number.isInteger(c?.spot)).slice(0, 8).map(c => ({ agent: c.agent, spot: c.spot })),
        guests: guests.filter(g => Number.isInteger(g?.account) && Number.isInteger(g?.spot)).slice(0, MAX_PLAYERS - 1).map(g => ({ account: g.account, name: String(g.name || '').slice(0, 40), spot: g.spot, dk: g.dk || null })) });
    }
    return out;
  }
  save(now = this.now()) {
    if (!this.store || this.closed) return;
    const boats = this.snapshot();
    // (nothing out, and nothing out when last saved: no file written — none to keep, none in a backup)
    if (!boats.length && !this.savedAny) { this.savedVer = this.ver; this.savedAt = now; return; }
    try { this.store.save('harbour', { at: now, boats }); this.savedVer = this.ver; this.savedAt = now; this.savedAny = boats.length > 0; }
    catch (e) { this.log?.warn?.('[boats] saving the harbour failed:', e.message); }
  }
  /** The server stops: the boats out saved as they are now, and nothing written after. */
  close() { this.save(); this.closed = true; }
  /** After a restart: the boats out back where they were — a skipper's kept for it (RESUME_MS), a moored one waiting on. */
  restore() {
    let saved = null;
    try { saved = this.store?.load?.('harbour') || null; } catch { saved = null; }
    if (!saved || !Array.isArray(saved.boats)) return;
    this.savedAny = saved.boats.length > 0;   // (a file with boats in it: cleared when none is out any more)
    const now = this.now(), at = Number(saved.at) || 0;
    if (!(now - at >= 0 && now - at < RESTORE_MAX_MS)) return;
    let n = 0;
    for (const x of saved.boats) {
      const b = this.all.get(String(x?.id || '')), q = x?.pose;
      if (!b || b.type !== x.type || !q || ![q.x, q.y, q.z, q.h].every(Number.isFinite)) continue;
      b.pose = { x: q.x, y: q.y, z: q.z, h: q.h, p: Number(q.p) || 0, r: Number(q.r) || 0, v: 0, l: 0, an: q.an ? 1 : 0 };
      b.at = now; b.ts = null;
      if (x.mode === 'out' && x.skipper != null && !this.bySkipper.has(x.skipper)) {
        Object.assign(b, { mode: 'out', skipper: x.skipper, skipperName: String(x.skipperName || '').slice(0, 40), returnAt: 0, resumeUntil: now + RESUME_MS,
          crewWaiting: Array.isArray(x.crew) ? x.crew.filter(c => Number.isInteger(c?.agent) && Number.isInteger(c?.spot)).slice(0, 8) : [],
          guestsWaiting: Array.isArray(x.guests) ? x.guests.filter(g => Number.isInteger(g?.account) && g.account !== x.skipper && Number.isInteger(g?.spot)).slice(0, MAX_PLAYERS - 1) : [] });
        this.bySkipper.set(x.skipper, b);
      } else { b.mode = 'moored'; b.skipper = null; b.skipperName = ''; b.returnAt = now + Math.max(60e3, Math.min(PARK_MS, (Number(x.returnAt) || 0) - at)); }
      n++;
    }
    if (n) { this.ver++; this.log?.info?.(`[boats] after the restart: ${n} boat(s) back out where they were`); }
  }
  /**
   * Account id's page connected: its boat kept for it across a restart — back at its helm (the page told with stateFor's
   * resumed bstate), the companions that were aboard back at their spots (onResume). → the boat, or null.
   */
  resume(id) {
    const p = this.players.byId.get(id);
    // (one of its crew of players, back: aboard again where they stood — the skipper back or not yet)
    if (p && !p.boatId && !this.bySkipper.has(id)) for (const g of this.all.values()) {
      const w = g.guestsWaiting?.find(x => x.account === id);
      if (!w || g.skipper == null) continue;
      g.guestsWaiting = g.guestsWaiting.filter(x => x !== w);
      const dk = w.dk && Array.isArray(w.dk.at) ? { at: w.dk.at.slice(0, 3).map(Number), yaw: Number(w.dk.yaw) || 0, clip: 0 } : null;
      this.aboard(g, p, null, { spot: w.spot, dk: dk && dk.at.every(Number.isFinite) ? dk : null, resumed: true });
      return g;
    }
    const b = this.bySkipper.get(id);
    if (!b || !b.resumeUntil || !p) return null;
    p.boatId = b.id; p.clip = 0;
    const hm = this.helmOf(b, b.pose); p.x = hm.x; p.y = hm.y; p.z = hm.z; p.ctx = -1; p.yaw = b.pose.h; p.ver++; p.dirty = true; p.lastAt = this.now();
    const crew = b.crewWaiting || [];
    b.resumeUntil = 0; b.crewWaiting = null; b.at = this.now(); b.ts = null;
    this.ver++;
    try { this.onResume?.(b, crew); } catch (e) { this.log?.warn?.('[boats] the crew back aboard:', e.message); }
    return b;
  }
  /** Whether agent id was aboard a boat kept for its skipper after a restart (it goes back aboard when they are back). */
  crewWaitingFor(agentId) { for (const b of this.all.values()) if (b.crewWaiting?.some(c => c.agent === Number(agentId))) return b; return null; }
  besideSlip(b) { const d = b.home.deck; return d ? { x: d.x, y: d.y, z: d.z } : { x: b.home.x, y: b.home.y + 1, z: b.home.z }; }
  release(b, point, text) {
    // (its crew of players ashore with it: stepping off alongside together, or back on the dock by its slip)
    for (const id of [...(b.guests?.keys() || [])]) this.guestOff(b, id, point || this.besideSlip(b), point ? `${b.skipperName || 'The skipper'} brought her in — you stepped ashore` : `${b.skipperName || 'The skipper'} left the boat — the harbour launch took you back to the dock`);
    b.guestsWaiting = null;
    const p = this.players.byId.get(b.skipper);
    this.bySkipper.delete(b.skipper);
    b.skipper = null; b.skipperName = '';
    if (!p) return;
    p.boatId = null; p.clip = 0;
    if (point) { p.x = point.x; p.y = point.y; p.z = point.z; p.ctx = -1; }
    p.ver++; p.dirty = true; p.lastAt = this.now();
    this.players.toAccount(p.id, { t: 'pmoved', x: p.x, y: p.y, z: p.z, ctx: -1, yaw: p.yaw, seq: p.seq, text, boat: 'out', home: true });
  }
  home(b) { b.mode = 'slip'; b.pose = this.slipPose(b); b.returnAt = 0; }
  /**
   * A player gone. Their page closed (keep: the last tab, past the reload grace — players.js remove): the boat waits out
   * where it is for them, its crew aboard, as across a restart (RESUME_MS; back: resume) — never sent home with their
   * trip and companions the moment a page reloads slowly (2026-11-20, the product owner: "the page was restarted and the boat is gone,
   * I was at sea"). Their account deleted (no keep): the boat home now. → where they are to be found meanwhile (their
   * saved place: beside the slip — never out in the sea, should the boat go home without them), or null.
   */
  forgetAccount(id, { keep = false } = {}) {
    const g = this.byGuest.get(id);
    if (g) {   // (one of a boat's crew: off it — kept for them to come back aboard, while the boat is out)
      const w = g.guests?.get(id), at = this.besideSlip(g);
      if (keep && w && g.skipper != null) { (g.guestsWaiting ||= []).push({ account: id, name: w.name, spot: w.spot, dk: w.dk }); g.guestsWaiting = g.guestsWaiting.slice(-(MAX_PLAYERS - 1)); }
      g.guests?.delete(id); this.byGuest.delete(id); this.ver++;
      if (g.skipper != null) this.players.toAccount(g.skipper, { t: 'bcrew', text: `${w?.name || 'Your crew'} is away for a moment`, crew: this.crewList(g) });
      try { this.onCrew?.(g); } catch { /* the crew's own */ }
      return at;
    }
    const b = this.bySkipper.get(id); if (!b) return null;
    const at = this.besideSlip(b);
    if (keep && b.mode === 'out') {
      // (waiting for them out where it is: its crew of players waits aboard, its companions stay at their spots)
      b.resumeUntil = this.now() + RESUME_MS; b.at = this.now(); b.ts = null;
      try { b.crewWaiting = this.crewOf(b.id) || []; } catch { b.crewWaiting = []; }
      b.pose = { ...b.pose, v: 0, l: 0 };
      this.ver++;
      return at;
    }
    for (const gid of [...(b.guests?.keys() || [])]) this.guestOff(b, gid, at, `${b.skipperName || 'The skipper'} left — the harbour launch took you back to the dock`);
    this.bySkipper.delete(id); b.skipper = null; b.skipperName = ''; b.guestsWaiting = null; b.resumeUntil = 0; b.crewWaiting = null;
    this.home(b); this.ver++;
    return at;
  }
  /** A player's "aboard" that no boat backs any more (a boat gone home without them): let go. → true when it was. */
  heal(p) {
    if (!p?.boatId) return false;
    const b = this.boatOf(p.id);
    if (b && b.id === p.boatId) return false;
    p.boatId = null; p.clip = 0; p.ver++; p.dirty = true;
    this.log?.info?.(`[boats] ${p.name || p.id} was aboard a boat that is gone: let go`);
    return true;
  }
  /** A page asks where its player is (it loaded, or lost track): its boat's state again — or, none, its stale "aboard"
   *  let go and the page told so (bstate none: nothing to draw). */
  resync(ws) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null;
    if (!p) return;
    this.heal(p);
    try { this.resume(p.id); } catch (e) { this.log?.warn?.('[boats] back aboard:', e.message); }
    const st = this.stateFor(p.id);
    this.send(ws, st || { t: 'bstate', ok: false, none: true });
  }
  /** About five times a second: moored boats whose wait is over go home; everyone near a boat out hears of it. */
  tick(clients) {
    const now = this.now();
    for (const b of this.all.values()) if (b.mode === 'moored' && b.skipper == null && b.returnAt && now > b.returnAt) { this.home(b); this.ver++; }
    // (a skipper not back after the restart in time: its boat home, its crew with it)
    for (const b of this.all.values()) if (b.resumeUntil && now > b.resumeUntil) {
      const at = this.besideSlip(b);
      for (const gid of [...(b.guests?.keys() || [])]) this.guestOff(b, gid, at, `${b.skipperName || 'The skipper'} didn't come back — the harbour launch took you back to the dock`);
      // (the skipper — and the crew that were away — kept beside the slip: their saved place, never out in the sea)
      for (const id of [b.skipper, ...(b.guestsWaiting || []).map(g => g.account)]) { try { this.players.placeSaved?.(id, at); } catch { /* their own */ } }
      const sp = this.players.byId.get(b.skipper);
      if (sp && sp.boatId === b.id) sp.boatId = null;
      this.bySkipper.delete(b.skipper); b.skipper = null; b.skipperName = ''; b.resumeUntil = 0; b.crewWaiting = null; b.guestsWaiting = null; this.home(b); this.ver++;
    }
    // (requests to come aboard nobody answered)
    for (const [id, a] of this.asks) if (now - a.at > ASK_MS) { this.asks.delete(id); this.players.toAccount(id, { t: 'bstate', ok: false, text: 'No answer from the skipper — try again in a moment' }); }
    if (this.ver !== this.savedVer && now - this.savedAt >= SAVE_MS) this.save(now);
    const away = [...this.all.values()].filter(b => b.mode !== 'slip');
    if (this.ver === this.sentVer && now - this.lastFull < 2000) return;
    this.sentVer = this.ver; this.lastFull = now;
    const ids = away.map(b => b.id);
    let crew = [];
    try { crew = this.crewRows() || []; } catch (e) { this.log?.warn?.('[boats] the crew rows:', e.message); }
    for (const ws of clients || []) {
      if (ws.readyState !== 1) continue;
      const vx = ws.view?.x, vz = ws.view?.z, me = ws.pid;
      const nearBoats = away.filter(b => b.skipper !== me && (!Number.isFinite(vx) || Math.hypot(b.pose.x - vx, b.pose.z - vz) < NEAR));
      const near = nearBoats.map(b => [b.id, b.type, b.mode === 'out' ? 1 : 0, b.pose.x, b.pose.y, b.pose.z, b.pose.h, b.pose.p, b.pose.r, b.pose.v, b.pose.l, b.skipperName]);
      // (the companions on the boats drawn here and on this page's own: render/boat-crew.js)
      const drawn = crew.length ? new Set([...nearBoats.map(b => b.id), this.boatOf(me)?.id]) : null;
      const rows = drawn ? crew.filter(r => drawn.has(r[0])) : [];
      // (the players aboard the boats drawn here — the skipper, the crew — where they stand on each deck: drawn on it, riding
      //  it, not trailing it by the stream's delay — client player/remote.js)
      const aboard = [], mine = me != null ? this.boatOf(me) : null;
      for (const b of mine && !nearBoats.includes(mine) ? [...nearBoats, mine] : nearBoats) {
        if (b.mode !== 'out' || b.skipper == null || b.resumeUntil) continue;
        const sk = b.dk || { at: BOATS[b.type].helm, yaw: 0 };
        aboard.push([b.id, b.skipper, ...sk.at, sk.yaw || 0]);
        for (const [id, g] of b.guests || []) aboard.push([b.id, id, ...g.dk.at, g.dk.yaw || 0]);
      }
      ws.send(JSON.stringify({ t: 'harbour', away: ids, near, ...(rows.length ? { crew: rows } : {}), ...(aboard.length ? { aboard } : {}) }));
    }
  }
  send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  /** What a newly connected page needs (its own boat, if out: after a reload it is back at the helm). */
  stateFor(accountId) {
    const g = this.byGuest.get(accountId);
    if (g) return this.guestState(g, accountId, true);   // (one of a boat's crew: back aboard it)
    const b = this.bySkipper.get(accountId); return b ? { t: 'bstate', ok: true, id: b.id, type: b.type, pose: b.pose, home: b.home, module: b.module, resumed: true, crew: this.crewList(b) } : null;
  }
}
