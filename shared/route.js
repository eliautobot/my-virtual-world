// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// GPS routes (2026-10-05: "a map that works like GTA's"): the shortest way along the world's roads and streets -
// the city's avenues and streets and the roads beyond it, one network (city-roads.js worldRoads) - from any point to any
// point, with turn-by-turn steps. A point off the roads joins the nearest road in a straight line (walking across a
// field or out of a lot). Pure: the browser routes the player (ui/worldmap.js); tests route without one.
import { pointAt } from './roads.js';
import { worldRoads } from './city-roads.js';

const JOIN = 0.6;   // m: junction arms closer than this along one road are one stop
const wrap = (s, L) => ((s % L) + L) % L;

export class Router {
  constructor(world) {
    this.net = worldRoads(world);
    this.nodes = new Map();   // key → { x, z, edges: [{ to, id, s0, s1, len }] }
    this.stops = new Map();   // road id → [{ s, key }] sorted by s
    for (const j of this.net.junctions()) {
      this.nodes.set(j.key, { x: j.x, z: j.z, edges: [] });
      for (const a of j.arms) {
        const L = this.stops.get(a.id) || this.stops.set(a.id, []).get(a.id);
        if (!L.some(q => Math.abs(q.s - a.s) < JOIN)) L.push({ s: a.s, key: j.key });
      }
    }
    for (const r of this.net.all()) {
      const G = this.net.geometry(r.id), L = (this.stops.get(r.id) || []).sort((a, b) => a.s - b.s);
      if (!G.closed) {   // open ends without a junction are stops too, so the whole road can be driven
        if (!L.length || L[0].s > JOIN) { const k = `end:${r.id}:0`, p = pointAt(G, 0, {}); this.nodes.set(k, { x: p.x, z: p.z, edges: [] }); L.unshift({ s: 0, key: k }); }
        if (L.at(-1).s < G.length - JOIN) { const k = `end:${r.id}:1`, p = pointAt(G, G.length, {}); this.nodes.set(k, { x: p.x, z: p.z, edges: [] }); L.push({ s: G.length, key: k }); }
      }
      this.stops.set(r.id, L);
      const n = L.length;
      for (let i = 0; i + 1 < n || (G.closed && n > 1 && i < n); i++) {
        const a = L[i], b = L[(i + 1) % n], s1 = i + 1 < n ? b.s : b.s + G.length;
        if (a.key === b.key && s1 - a.s < JOIN) continue;
        this.link(a.key, b.key, r.id, a.s, s1);
      }
    }
    this.bridgeEnds();
  }
  /** Road ends that stop short of another road (an island road ending at the city's edge street, say): joined to the
   *  nearest junction of another road within 60 m by a straight link, so the network is one. */
  bridgeEnds() {
    const ends = [];
    for (const j of this.net.junctions()) if (j.kind === 'end') ends.push({ key: j.key, id: j.arms[0].id });
    for (const k of this.nodes.keys()) if (k.startsWith('end:')) ends.push({ key: k, id: k.split(':')[1] });
    const roadsOf = new Map();
    for (const [id, L] of this.stops) for (const q of L) (roadsOf.get(q.key) || roadsOf.set(q.key, new Set()).get(q.key)).add(id);
    for (const E of ends) {
      const a = this.nodes.get(E.key);
      if (!a) continue;
      let best = null, bd = 60;
      for (const [k, n] of this.nodes) {
        if (k === E.key || roadsOf.get(k)?.has(E.id)) continue;
        const d = Math.hypot(n.x - a.x, n.z - a.z);
        if (d < bd) { bd = d; best = k; }
      }
      if (best && !a.edges.some(e => e.to === best)) {
        a.edges.push({ to: best, id: null, len: bd, straight: true });
        this.nodes.get(best).edges.push({ to: E.key, id: null, len: bd, straight: true });
      }
    }
  }
  link(ka, kb, id, s0, s1) {
    const len = Math.abs(s1 - s0);
    this.nodes.get(ka).edges.push({ to: kb, id, s0, s1, len });
    this.nodes.get(kb).edges.push({ to: ka, id, s0: s1, s1: s0, len });
  }
  name(id) { return this.net.get(id)?.name || 'the road'; }
  /** Where (x, z) joins the roads: { id, s, x, z, dist } on the nearest road within maxDist m, or null. */
  attach(x, z, maxDist = 2500) { return this.net.nearest(x, z, maxDist); }
  /**
   * The route from a to b ({ x, z } each): { pts: [[x, z], …], length (m), steps: [{ x, z, at (m from the start),
   * turn: 'start'|'left'|'right'|'slight left'|'slight right'|'straight'|'u-turn'|'arrive', road }] }, or null.
   */
  route(a, b) {
    const pa = this.attach(a.x, a.z), pb = this.attach(b.x, b.z);
    if (!pa || !pb) return null;
    // the two ends join the graph as temporary nodes between the stops around them on their roads
    const temp = [];
    const join = (p, key) => {
      this.nodes.set(key, { x: p.x, z: p.z, edges: [] }); temp.push(key);
      const G = this.net.geometry(p.id), L = this.stops.get(p.id) || [];
      if (!L.length) return;
      let i = L.findIndex(q => q.s > p.s); if (i < 0) i = G.closed ? 0 : L.length;
      const after = i < L.length ? L[i] : null, before = i > 0 ? L[i - 1] : G.closed ? L.at(-1) : null;
      if (after) this.link(key, after.key, p.id, p.s, after.s >= p.s ? after.s : after.s + G.length);
      if (before) this.link(key, before.key, p.id, p.s, before.s <= p.s ? before.s : before.s - G.length);
    };
    join(pa, '@a'); join(pb, '@b');
    if (pa.id === pb.id) {   // the same road: straight along it, if no stop lies between (else the graph decides)
      const G = this.net.geometry(pa.id), lo = Math.min(pa.s, pb.s), hi = Math.max(pa.s, pb.s);
      if (!(this.stops.get(pa.id) || []).some(q => q.s > lo && q.s < hi)) this.link('@a', '@b', pa.id, pa.s, pb.s);
      void G;
    }
    // Dijkstra (a hundred nodes or so)
    const dist = new Map([['@a', 0]]), prev = new Map(), done = new Set();
    for (;;) {
      let k = null, d = Infinity;
      for (const [q, v] of dist) if (!done.has(q) && v < d) { d = v; k = q; }
      if (k === null || k === '@b') break;
      done.add(k);
      for (const e of this.nodes.get(k).edges) {
        const nd = d + e.len;
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { from: k, e }); }
      }
    }
    // undo the temporary nodes
    for (const key of temp) this.nodes.delete(key);
    for (const n of this.nodes.values()) n.edges = n.edges.filter(e => !temp.includes(e.to));
    if (!prev.has('@b')) return null;
    const legs = [];
    for (let k = '@b'; k !== '@a';) { const p = prev.get(k); legs.unshift(p.e); k = p.from; }
    return this.shape(a, b, pa, pb, legs);
  }
  /** Polyline and steps from the legs. */
  shape(a, b, pa, pb, legs) {
    const pts = [], steps = [], q = {};
    let at = 0;
    const push = (x, z) => { const l = pts.at(-1); if (l) { const d = Math.hypot(x - l[0], z - l[1]); if (d < 0.5) return; at += d; } pts.push([x, z]); };
    push(a.x, a.z);
    const heading = (id, s, dir) => { const G = this.net.geometry(id); pointAt(G, G.closed ? wrap(s, G.length) : Math.max(0, Math.min(G.length, s)), q); return Math.atan2(q.dx * dir, q.dz * dir); };
    steps.push({ x: a.x, z: a.z, at: 0, turn: 'start', road: this.name(legs.find(e => e.id)?.id ?? pa.id) });
    legs.forEach((e, i) => {
      if (e.straight) { const n = this.nodes.get(e.to); push(n.x, n.z); return; }   // a link across a gap between roads
      const G = this.net.geometry(e.id), dir = e.s1 >= e.s0 ? 1 : -1, n = Math.max(1, Math.ceil(Math.abs(e.s1 - e.s0) / 8));
      if (i > 0 && !legs[i - 1].straight) {   // the turn where this leg leaves the last one
        const prevE = legs[i - 1], h0 = heading(prevE.id, prevE.s1, prevE.s1 >= prevE.s0 ? 1 : -1), h1 = heading(e.id, e.s0, dir);
        let d = h1 - h0; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        const deg = d * 180 / Math.PI, ad = Math.abs(deg);
        // the heading is measured from +z toward +x: a positive change turns to the traveller's left
        const turn = ad < 25 ? 'straight' : ad > 150 ? 'u-turn' : (deg > 0 ? 'left' : 'right');
        const turnS = ad >= 25 && ad < 55 ? `slight ${turn}` : turn;
        if (turn !== 'straight' || e.id !== prevE.id) {
          const l = pts.at(-1); steps.push({ x: l[0], z: l[1], at, turn: e.id !== prevE.id || turn !== 'straight' ? turnS : 'straight', road: this.name(e.id) });
        }
      }
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const s = e.s0 + (e.s1 - e.s0) * k / n;
        pointAt(G, G.closed ? wrap(s, G.length) : Math.max(0, Math.min(G.length, s)), q);
        push(q.x, q.z);
      }
    });
    if (!legs.length) push(pa.x, pa.z);
    push(pb.x, pb.z); push(b.x, b.z);
    steps.push({ x: b.x, z: b.z, at, turn: 'arrive', road: '' });
    return { pts, length: at, steps };
  }
}

/** How far along polyline pts (m) the point nearest (x, z) lies, and how far from it: { along, off, i }. */
export function alongRoute(pts, x, z) {
  let best = { along: 0, off: Infinity, i: 0 }, run = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, L = Math.sqrt(L2);
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const off = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (off < best.off) best = { along: run + L * t, off, i };
    run += L;
  }
  return best;
}
