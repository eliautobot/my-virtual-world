// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Walking on a dock's decks (shared/dock-layout.js: a marina's or a lake dock's pier, gangway, float and fingers) for the
// bodies the simulation moves: the city's ways (the router, the players' ground) stop at the water's edge, so a body
// going to someone out on a pier must take the dock's own way — from its quay down the pier, the gangway and the float —
// and back up the same way (2026-11-17, the product owner: on the pier his companions "run the opposite way almost like
// they lost my location": the router, asked for a point over the water, took them off along the streets).
// One place for that way: companions following their owner (./companion-moves.js goToward) and the fishing crew walking
// down to a boat (server/play/fishing-crew.js) use it.
import { DOCKS, dockDecks, deckTop } from '../../shared/dock-layout.js';
import { toWorldAt, toFrame } from '../../shared/airport-layout.js';
import { modulesOf } from '../../shared/world-modules.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SAME_M = 0.6;   // m: two route points this close are the same corner (where a way up meets a way down)

/** The way from dock kind's quay to its float at f (dock frame: [[s, f]], s from the quay's edge, f along it). */
export function dockRoute(kind, f) {
  const d = DOCKS[kind].decks, pier = d.find(x => x.kind === 'pier'), gang = d.find(x => x.kind === 'gang'), flt = d.find(x => x.kind === 'float');
  const pf = (pier.f0 + pier.f1) / 2, gs = (gang.s0 + gang.s1) / 2, fs = (flt.s0 + flt.s1) / 2, f0 = flt.f0 + 0.6;
  return [[1.5, pf], [gs, pf], [gs, f0], [fs, f0], [fs, clamp(f, flt.f0 + 0.6, flt.f1 - 0.6)]];
}
/** The way up from a point on dock m's decks to its quay: [[s, f]] (dock frame) — from the float and its fingers by the
 *  gangway and the pier, from the pier or its head along it, from anywhere else straight up. Its last point is the quay. */
export function dockRouteUp(m, x, z) {
  const d = DOCKS[m.kind].decks, pier = d.find(k => k.kind === 'pier'), flt = d.find(k => k.kind === 'float'), q = toFrame(m, x, z);
  const pf = (pier.f0 + pier.f1) / 2;
  if (q.s > flt.s0 - 14 && q.s < flt.s1 + 1 && q.f > flt.f0 - 0.5) return [...dockRoute(m.kind, q.f)].reverse();
  if (q.f > pier.f0 - 30 && q.f < pier.f1 + 1 && q.s < -1) return [[q.s, pf], [1.5, pf]];
  return [[1.5, q.f]];
}
/** World points with heights on dock m's decks (the land's level off them) for dock-frame points [[s, f]]. */
export function dockPoints(m, sf) {
  const decks = dockDecks(m);
  return sf.map(([s, f]) => {
    const p = toWorldAt(m, s, f);
    let y = null; for (const D of decks) { const t = deckTop(D, p.x, p.z, 0.3); if (t !== null && (y === null || t > y)) y = t; }
    return { x: p.x, y: y ?? m.y, z: p.z };
  });
}

const lengthOf = pts => pts.reduce((n, p, k) => (k ? n + Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z) : 0), 0);
/** Whether a straight walk from p to q stays on dock m's decks (or its quay's edge): sampled every half metre. */
function onDecks(world, m, p, q) {
  const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.5));
  for (let k = 0; k <= n; k++) {
    const x = p.x + (q.x - p.x) * k / n, z = p.z + (q.z - p.z) * k / n;
    if (!deckAt(world, x, z, 0.1) && Math.abs(toFrame(m, x, z).s - 1.5) > 0.6) return false;
  }
  return true;
}
/** The docks of a world with their decks, kept while its modules stay the same. */
const cache = new WeakMap();
function docksOf(world) {
  const list = modulesOf(world);
  let c = cache.get(world);
  if (!c || c.list !== list) {
    c = { list, docks: list.filter(m => DOCKS[m.kind] && Number.isFinite(m.y)).map(m => ({ m, decks: dockDecks(m) })) };
    cache.set(world, c);
  }
  return c.docks;
}
/** The dock deck under (x, z): { m (the dock), y (the deck's top) }, or null (not on a dock). */
export function deckAt(world, x, z, g = 0.3) {
  for (const D of docksOf(world)) {
    let y = null;
    for (const d of D.decks) { const t = deckTop(d, x, z, g); if (t !== null && (y === null || t > y)) y = t; }
    if (y !== null) return { m: D.m, y };
  }
  return null;
}
/**
 * The way from `from` to `to` (both outdoors: { x, z }) when either is on a dock's decks: { land (a point on land to get
 * to first by the city's ways, or null: it is on the deck already), pts (then along the decks, with their heights, to
 * `to` — or, leaving the dock, up to its quay), then (a point on land to go on to by the city's ways, or null) } — or null
 * when neither is on a dock.
 */
export function dockWay(world, from, to) {
  const A = deckAt(world, from.x, from.z), B = deckAt(world, to.x, to.z);
  if (!A && !B) return null;
  const up = (m, p) => dockPoints(m, dockRouteUp(m, p.x, p.z));
  const end = B ? [{ x: to.x, y: B.y, z: to.z }] : [];
  if (A && B && A.m.id === B.m.id) {
    // (on the same dock: the shortest of the ways along its decks — straight there when the decks carry it, else up its
    //  way as far as a straight walk on the decks reaches the way down to them)
    const ua = [{ x: from.x, y: A.y, z: from.z }, ...up(A.m, from)], ub = [{ x: to.x, y: B.y, z: to.z }, ...up(B.m, to)];
    let best = null, bl = Infinity;
    for (let i = 0; i < ua.length; i++) for (let j = 0; j < ub.length; j++) {
      if (!onDecks(world, A.m, ua[i], ub[j])) continue;
      const path = [...ua.slice(1, i + 1), ...ub.slice(0, j + 1).reverse()], l = lengthOf([ua[0], ...path]);
      if (l < bl) { bl = l; best = path; }
    }
    return { land: null, pts: best || [...ua.slice(1), ...[...ub].reverse()], then: null };
  }
  if (A && B) return { land: null, pts: up(A.m, from), then: null };   // (one dock to another: up to this one's quay — the next round goes on from the land)
  if (A) { const ua = up(A.m, from); return { land: null, pts: ua, then: { x: to.x, z: to.z } }; }   // (off the dock: up to its quay, then the city's ways)
  const ub = [...up(B.m, to)].reverse();
  return { land: ub[0], pts: [...ub.slice(1), ...end], then: null };   // (on to the dock: to its quay, then down)
}
