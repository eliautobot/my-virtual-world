// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The decorations' seats outdoors (2026-11-17, the product owner: "they have to be aware of all objects whether or not
// they are considered decorations — that includes docks or any other place. If the player can do it then AI agents
// should also be able to do it"). A player sits on a bench placed on open land, at a dock's picnic table, on the edge of
// a fountain someone put up beyond the city (client/js/player/player.js decorNear: any of world.decorations whose catalog
// item has slots); here an AI agent's body can too — with its owner or on its own — with the city's own slot machinery
// (the seat on its follow order, server/sim/companion-moves.js seatStep; the order 'use': ./agents.js useOrder).
//
// - The index: every decoration whose catalog item declares slots (shared/catalog.js: a bench, a picnic table, a
//   fountain — or any item added later), wherever it stands (the city's lots, open land, a dock's own decorations:
//   shared/dock-layout.js dockDecor), its slots in world coordinates as the browser has them (shared/geom.js
//   itemToLocal: the decoration is its own frame), kept while world.decorations stays the same array (the world editor
//   replaces it on every change), by 16 m cell.
// - Its height: the land's where it stands (the city's ground level, beyond the city the island's ground with its pads —
//   a dock's levelled land: Nav.groundY, as the routes walk it), the decoration's centre's, as the player's page seats
//   them (decorNear: terrain.pointHeight at the decoration).
// - A seat on one is a seat as Brain.seatInfo gives one (b, f, id: −1; dec: the decoration's id; k its slot; key
//   'd:<id>:<k>'), in plain words ("a bench at «Bayside Marina»", "a picnic table by «Elm Ave & 3rd St»", "the edge of
//   the fountain out in the country"); held by its key (Brain.reserveKey: nobody else is given it) and kept open-ended
//   while it sits there (keepSeat); a player on it (their page's PF_USING, outdoors) holds it as on any seat
//   (Brain.playerAt), and a player sitting down on one sends whoever was to be there elsewhere (playerTook → decorTook).
// - Residents' routines never use them: only orders do (a companion's seat, an order 'use' with a decoration) — the
//   city's digest is unchanged (tools/sim-digest.mjs). Nothing here draws a simulation random number.
import { CATALOG, USE_ID, USES } from '../../shared/catalog.js';
import { A, PROP, SEATED, animId } from '../../shared/anims.js';
import { GROUND_Y } from '../../shared/constants.js';
import { F_FACE, CTX_OUT, CTX_UNDER } from '../../shared/proto.js';
import { itemToLocal } from '../../shared/geom.js';
import { addressOf } from '../../shared/city.js';
import { WORLD_KINDS } from '../../shared/world-modules.js';
import { PIECE_WORDS, SEAT_NEAR } from './companion-moves.js';

const U = USE_ID;
const CELL = 16;   // m: the index's cells (a decoration's slots are within a few metres of it)
const EDGE_M = 40;   // m: just past the city's streets, a place is still named by its nearest corner
const DIRECT_M = 20;   // m: a walk this short to a decoration goes straight there when nothing is in the way
const EMPTY = Object.freeze([]);
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export const DECOR_SEATS = {
  /** The decorations with slots: { of (world.decorations), byId: Map id → entry, cell: Map 'i,j' → [entry] }; entry:
   *  { id, t, x, z, mod: { id, name } | null, slots: [{ k, lx, lz, ax, az (world), yaw (world), anim, use, uid, y, prop, dur,
   *  seated, moveIn }] } — the same slot records as a building's (server/sim/windex.js), in the world's frame. */
  decorIndex() {
    const W = this.W, list = W.decorations || EMPTY, c = this._decor;
    if (c && c.of === list && c.mods === W.worldModules && c.roads === W.roads) return c;
    const byId = new Map(), cell = new Map(), mods = W.worldModules || EMPTY;
    for (const d of list) {
      const def = d && CATALOG[d.t];
      if (!def?.slots?.length || typeof d.id !== 'string' || !Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
      const it = { x: d.x, z: d.z, r: d.r || 0 };
      const slots = def.slots.map((s, k) => {
        const p = itemToLocal(it, s.x, s.z), q = itemToLocal(it, s.ax ?? s.x, s.az ?? s.z), anim = animId(s.anim);
        return { k, lx: p.x, lz: p.z, ax: q.x, az: q.z, yaw: s.yaw + it.r, anim, use: s.use, uid: U[s.use] ?? 0, y: s.y || 0,
          prop: PROP[s.prop || 'none'] || 0, dur: s.dur || null, seated: SEATED.has(anim), moveIn: hyp(p.x, p.z, q.x, q.z) > 0.05 };
      });
      // (a world module's own — a dock's benches and picnic tables: its name for the words)
      const m = d.mod ? mods.find(x => x && x.id === d.mod) : null;
      const e = { id: d.id, t: d.t, x: d.x, z: d.z, r: it.r, slots, mod: m ? { id: m.id, name: String(m.name || WORLD_KINDS[m.kind]?.label || '').slice(0, 40) } : null, place: null };
      byId.set(d.id, e);
      const key = `${Math.floor(d.x / CELL)},${Math.floor(d.z / CELL)}`;
      (cell.get(key) || cell.set(key, []).get(key)).push(e);
    }
    return (this._decor = { of: list, mods: W.worldModules, roads: W.roads, byId, cell });
  },
  /** Decoration id's entry (decorIndex's), or null (gone, or nothing to use on it). */
  decorEntry(id) { return id === undefined || id === null ? null : this.decorIndex().byId.get(String(id)) || null; },
  /** The decorations with slots whose centre is within r m of (x, z). */
  decorNear(x, z, r) {
    const I = this.decorIndex(), out = [], n = Math.ceil(r / CELL), i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
    if (!I.byId.size || !Number.isFinite(x) || !Number.isFinite(z)) return out;
    for (let i = i0 - n; i <= i0 + n; i++) for (let j = j0 - n; j <= j0 + n; j++) for (const e of I.cell.get(`${i},${j}`) || EMPTY) if (hyp(e.x, e.z, x, z) <= r) out.push(e);
    return out;
  },
  /** What being at slot s of a decoration is (its act's use): its own — but nothing is served on open land, so a seat
   *  that is for a meal (a picnic table's: what feeds, shared/catalog.js USES) is only sat at ('relax'); null: nothing to
   *  do there without someone serving it. */
  decorAct(s) {
    const u = USES[s?.use];
    if (!u) return null;
    if ((u.rate?.hunger || 0) > 0 || (u.once?.hunger || 0) > 0) return s.seated ? 'relax' : null;
    return s.use;
  },
  /** A decoration's slot key (its reservations, Brain.res): 'd:<id>:<k>' — never a building's 'b:f:id:k'. */
  decorKey(id, k) { return 'd:' + id + ':' + k; },
  /** The land's height at (x, z): the city's ground level, beyond it the island's (with the pads: a dock's land). */
  landY(x, z) {
    const n = this.nav;
    if (!n.beyond(x, z)) return GROUND_Y;
    n.walk();
    return n.groundY(x, z);
  },
  /** Where it is, in words: the world module it belongs to (a marina's name), else the address (the city's corner — also
   *  just past its streets —, the road out in the country). */
  decorPlace(e) {
    if (e.place === null) {
      const n = this.nav, g = n.g, out = Math.max(g.minX - e.x, e.x - g.maxX, g.minZ - e.z, e.z - g.maxZ);
      e.place = e.mod?.name || (out > 0 && out <= EDGE_M ? addressOf(g, e.x, e.z) : n.addressAt(e.x, e.z)) || '';
    }
    return e.place;
  },
  /** Seat k of decoration e in plain words: "a bench at «Bayside Marina»", "a picnic table by «Elm Ave & 3rd St»". */
  decorWords(e) {
    const name = String(CATALOG[e.t]?.name || 'seat').replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase().slice(0, 40) || 'seat';
    const w = PIECE_WORDS[e.t] || `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`, pl = this.decorPlace(e);
    if (!pl) return w;
    return e.mod ? `${w} at «${pl}»` : /^out in the country$/i.test(pl) ? `${w} out in the country` : `${w} by «${pl}»`;
  },
  /** Slot k of decoration id as Brain.seatInfo gives a seat (b, f, id: −1; dec, k, key), or null. */
  decorInfo(id, k) {
    const e = this.decorEntry(id), s = e?.slots[k];
    if (!s) return null;
    return { b: -1, f: -1, id: -1, dec: e.id, k, key: this.decorKey(e.id, k), ctx: CTX_OUT, x: s.lx, z: s.lz, use: s.use, item: e.t, words: this.decorWords(e), venue: null, place: this.decorPlace(e), mod: e.mod?.id || null };
  },
  /** A player on slot k of decoration id (its place, outdoors), for a stay in win (by default now). */
  decorPlayerOn(id, k, win = null) { const s = this.decorEntry(id)?.slots[k]; return !!s && this.playerAt(s.lx, s.lz, CTX_OUT, win); },
  /** Is slot k of decoration id held by someone else (or a player on it) at any time in win (by default now)? */
  decorTaken(id, k, who, win = null) { return this.heldBy(this.decorKey(id, k), who, win) || this.decorPlayerOn(id, k, win); },
  /** Whether slot k of decoration id is free for body a from now on (Brain.seatFree's rule: over its seat's hold). */
  decorFree(a, id, k) { const now = this.sim.now(); return !this.decorTaken(id, k, a.i, [now, now + this.wm(30)]); },   // (as Brain.seatFree: over the hold a companion's seat is renewed for, SEAT_HOLD)
  /** The seat a body at (x, z) outdoors is on (within SEAT_NEAR of a seated slot of a decoration), as decorInfo, or null. */
  decorSeatAt(x, z) {
    let best = null, bd = SEAT_NEAR;
    for (const e of this.decorNear(x, z, 6)) for (const s of e.slots) {
      if (!s.seated) continue;
      const d = hyp(s.lx, s.lz, x, z);
      if (d < bd) { bd = d; best = { e, s }; }
    }
    return best ? this.decorInfo(best.e.id, best.s.k) : null;
  },
  /** The best free decoration seat for body a to sit with someone (Brain.pickSeat's rule): on their decoration (ls) first,
   *  else the nearest within radius of near — { seat (decorInfo), score } | { any: true } (all taken) | null (none). */
  decorPick(a, near, ls, uses, radius) {
    let best = null, bs = Infinity, any = false;
    const list = this.decorNear(near.x, near.z, radius + 4);
    if (ls?.dec !== undefined && !list.some(e => e.id === ls.dec)) { const e = this.decorEntry(ls.dec); if (e) list.push(e); }
    for (const e of list) for (const s of e.slots) {
      if (!uses.has(s.use)) continue;
      const same = ls?.dec !== undefined && e.id === ls.dec;
      if (same && s.k === ls.k) continue;   // (theirs)
      const d = hyp(s.lx, s.lz, near.x, near.z);
      if (!same && d > radius) continue;
      any = true;
      const score = same ? d - 1000 : d;
      if (score < bs && this.decorFree(a, e.id, s.k)) { bs = score; best = { e, s }; }
    }
    return best ? { seat: this.decorInfo(best.e.id, best.s.k), score: bs } : any ? { any: true } : null;
  },
  /**
   * Travel to slot k of decoration id and settle into it (Brain.slotBegin for a decoration): held for a over o.win (by
   * default from now on) unless o.noReserve; outdoors, at the land's height. → a settle record as slotBegin's (for
   * slotHold: b, f, id −1; dec; sk its key) or null (gone, or taken then).
   */
  decorBegin(a, P, id, k, o = {}) {
    const e = this.decorEntry(id), s = e?.slots[k];
    if (!s) return null;
    const sk = this.decorKey(e.id, k);
    if (!o.noReserve && !this.reserveKey(a, sk, o.win || [P.t, Infinity], () => this.decorPlayerOn(e.id, k, o.win || [P.t, Infinity]))) return null;
    // (the land under it — the page seats a player at the decoration's own ground, decorNear — and where one stands up)
    const ctx = CTX_OUT, y = this.landY(e.x, e.z), yaw = s.yaw, aw = { x: s.ax, z: s.az }, sw = { x: s.lx, z: s.lz };
    const use = o.use != null ? (U[o.use] ?? U.idle) : s.uid, anim = o.anim ?? s.anim, prop = o.prop ?? s.prop;
    const st = { b: -1, f: -1, id: -1, k, dec: e.id, s, aw, sw, y, yaw, ctx, use, anim, prop, arrive: P.t, sk };
    if (P.seat && P.seat.key === sk) { P.meta.dest = ctx; return st; }   // (already sitting here: just keep going)
    if (P.tele) {
      P.tele = false;
      if (!P.place(sw.x, y + s.y, sw.z, ctx, yaw)) P.jump(sw.x, y + s.y, sw.z, ctx, yaw);
      P.meta.dest = ctx;
      return st;
    }
    // to where one steps up to it, at its own pace (Brain.slotBegin's): straight there when close and nothing is in the
    // way (the players' own rules: sim.leads.clear), else along the city's ways
    if (P.ctx === CTX_UNDER) P.ctx = CTX_OUT;
    const ya = this.landY(aw.x, aw.z), far = this.sameSpace(P.ctx, ctx) ? hyp(P.x, P.z, aw.x, aw.z) : Infinity, clear = this.sim.leads?.clear;
    if (far > 0.05) {
      const t0 = P.t, opt = this.topt(a, o.travel || {}, P.t);
      if (far <= DIRECT_M && clear && clear(P.x, P.z, aw.x, aw.z, CTX_OUT)) P.move(aw.x, ya, aw.z, opt.speed, opt.anim, opt.use, { ctx, prop: opt.prop });
      else this.router.travel(P, { ctx, x: aw.x, z: aw.z }, opt);
      if (!(P.t > t0)) { if (!o.noReserve) this.unreserve(a, sk); return null; }
    }
    st.arrive = P.t;
    if (s.moveIn) {
      P.seg(0.35, aw.x, ya, aw.z, yaw, A.idle, use, prop, F_FACE, ctx, { nocut: 1 });
      P.seg(Math.max(0.8, hyp(aw.x, aw.z, sw.x, sw.z) / 1.1), sw.x, y + s.y, sw.z, yaw, anim, use, prop, F_FACE, ctx, { nocut: 1 });
    } else {
      if (hyp(P.x, P.z, sw.x, sw.z) > 0.03 || Math.abs(P.y - y - s.y) > 0.02) P.move(sw.x, y + s.y, sw.z, 0.9, A.walk, use, { ctx });
      P.seg(0.3, sw.x, y + s.y, sw.z, yaw, A.idle, use, prop, 0, ctx);
    }
    P.meta.dest = ctx;
    return st;
  },
  /**
   * A round of an order to use a decoration (kind 'use' with o.decor, o.use — the interaction registry's, an agent on
   * its own: server/interactions/sources/decor.js): the free slot of it with that use nearest it, for the slot's own time
   * (what is left of the order at most) — a rest on the bench, as a resident's visit there (nothing is bought: open land
   * sells nothing). False: the decoration is gone or every slot of it is taken (the order ends: not possible).
   */
  decorUse(a, P, o) {
    const e = this.decorEntry(o.decor);
    if (!e) return false;
    const left = Math.max(1, (o.until - P.t) * this.clock.dayScale / 60), one = e.slots.find(s => s.use === o.use);
    const span = Array.isArray(one?.dur) ? [Math.min(one.dur[0], left), Math.min(one.dur[1], left)] : [Math.min(10, left), Math.min(25, left)];
    const d = this.wm((span[0] + span[1]) / 2);
    const free = e.slots.filter(s => s.use === o.use && !this.decorTaken(e.id, s.k, a.i, [P.t, P.t + d + this.wm(30)]))
      .sort((p, q) => hyp(p.lx, p.lz, P.x, P.z) - hyp(q.lx, q.lz, P.x, P.z));
    for (const s of free.slice(0, 3)) {
      const use = this.decorAct(s);
      if (!use) return false;
      const st = this.decorBegin(a, P, e.id, s.k, { use, win: [P.t, Infinity] });
      if (!st) continue;
      const hs = this.slotHold(a, P, st, d);
      this.act(a, 'visit', use, P, { b: -1, f: -1, id: -1, k: s.k, dec: e.id, ctx: CTX_OUT, arrive: st.arrive, ...hs, place: this.decorPlace(e) });
      return true;
    }
    return false;
  },
  /** A player sat down at (x, z) outdoors: whoever was to be on a decoration's slot there within `soon` sim seconds goes
   *  elsewhere (Brain.playerTook). → how many. */
  decorTook(x, z, near, soon) {
    const now = this.sim.now();
    let n = 0;
    for (const e of this.decorNear(x, z, 6)) for (const s of e.slots) {
      if (hyp(s.lx, s.lz, x, z) > near) continue;
      for (const r of [...(this.res.get(this.decorKey(e.id, s.k)) || EMPTY)]) {
        const a = r[2] > now && r[1] < now + soon ? this.sim.agents[r[0]] : null;
        if (a?.plan) { this.interruptSoon(a); n++; }
      }
    }
    return n;
  },
};
