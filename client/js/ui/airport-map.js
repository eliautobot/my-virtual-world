// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The airports on the maps (2026-10-14, the product owner: "the airport doesn't appear on the map fully" - the maps drew roads and
// buildings, so of an airport only its terminal showed): its paving as seen from above - the runway (its centre line,
// thresholds), the taxiways round their curves, the apron and the helipads, the landside (drop-off lane, car park, the
// entrance road, the canopy's roof), the tower and the hangar - from shared/airport-layout.js, so the maps draw what the
// world does. Used by the world map and the radar (ui/worldmap.js) and the minimap's island view (ui/ui.js).
import { SURFACES, BENDS, FILLETS, LANDSIDE, STRUCTURES, STANDS, HELIPAD_R, RUNWAY, toWorldAt } from '/shared/airport-layout.js';
import { modulesOf, WORLD_KINDS } from '/shared/world-modules.js';
import { DOCKS, rampOf } from '/shared/dock-layout.js';

const COL = { runway: '#2c3035', taxiway: '#4b5057', apron: '#5a5f66', lane: '#41464c', park: '#4c5157', walk: '#a8a49b', roof: '#e3e5e8', terminal: '#6f8296', building: '#8b9098', pad: '#2f6b3a', mark: '#eceae2', taxi: '#d9b43a' };

/** A module's own building (an airport's terminal, a dock's store: turned with its module): the maps leave it to
 *  drawAirports, as their buildings are drawn square to the city's grid. */
export const isTerminal = B => !!B?.module;   // (a dock's store, too)

/** Draws every airport of the world into ctx: X(x), Z(z) map a world point to the canvas, s is pixels per metre; detail
 *  adds the markings and the helipads (when there is room for them). */
export function drawAirports(ctx, world, X, Z, s, { detail = true } = {}) {
  for (const m of modulesOf(world)) {
    if (DOCKS[m.kind]) { drawDock(ctx, m, X, Z, s); continue; }
    if (m.kind !== 'airport') continue;
    const P = (a, f) => { const p = toWorldAt(m, a, f); return [X(p.x), Z(p.z)]; };
    const shape = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); for (const [a, f] of pts) { const q = P(a, f); ctx.lineTo(q[0], q[1]); } ctx.closePath(); ctx.fill(); };
    const rect = (s0, f0, s1, f1, col) => shape([[s0, f0], [s1, f0], [s1, f1], [s0, f1]], col);
    for (const [s0, f0, s1, f1, kind] of SURFACES) if (COL[kind]) rect(s0, f0, s1, f1, COL[kind]);
    // the taxiway's bends and the fillets in the corners (as the world draws them: render/airport.js)
    for (const B of BENDS) { const pts = [[B.s, B.f]]; for (let k = 0; k <= 10; k++) { const a = B.a0 + (B.a1 - B.a0) * k / 10; pts.push([B.s + Math.cos(a) * B.r, B.f + Math.sin(a) * B.r]); } shape(pts, COL.taxiway); }
    for (const F of FILLETS) {
      const pts = [[F.s, F.f]];
      for (let k = 0; k <= 8; k++) { const t = k / 8 * Math.PI / 2, a = 1 - Math.sin(t), b = 1 - Math.cos(t); pts.push([F.s + F.r * (F.u[0] * a + F.w[0] * b), F.f + F.r * (F.u[1] * a + F.w[1] * b)]); }
      shape(pts, F.s > 60 ? COL.apron : COL.taxiway);
    }
    // the landside: the drop-off lane, the car park and the entrance road; the terminal, the canopy's roof before it
    const L = LANDSIDE, C = L.canopy, [e0, e1] = L.entry;
    rect(L.lane, L.f0, L.median, L.f1, COL.lane);
    rect(L.park, L.f0, L.parkEnd, L.f1, COL.park);
    rect(L.median, e0, L.edge, e1, COL.lane);
    for (const B of STRUCTURES) if (B.building) rect(B.s0, B.f0, B.s1, B.f1, COL.terminal);
    rect(L.front, C.f0, C.s1, C.f1, COL.roof);
    for (const B of STRUCTURES) if (!B.building && B.kind !== 'column') rect(B.s0, B.f0, B.s1, B.f1, COL.building);
    if (!detail) continue;
    // helipads; the runway's centre line, its thresholds; the taxiway's centre line (once there is room for them)
    if (s > 0.12) for (const st of STANDS) if (st.type === 'heli') {
      const [x, z] = P(st.s, st.f), r = HELIPAD_R * s;
      ctx.fillStyle = COL.pad; ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.fill();
      if (r > 4) { ctx.strokeStyle = COL.mark; ctx.lineWidth = Math.max(1, 0.6 * s); ctx.beginPath(); ctx.arc(x, z, r * 0.88, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (s > 0.08) {
      const W = RUNWAY.w / 2, half = RUNWAY.len / 2, lw = Math.max(0.6, 0.9 * s);
      for (let f = -half + 120; f < half - 120; f += 50) rect(-lw / s / 2, f, lw / s / 2, f + 28, COL.mark);
      for (const end of [-1, 1]) for (let a = -W + 3; a <= W - 4; a += 2.6) { const f = end * (half - 6); rect(a, Math.min(f, f - end * 30), a + 1.5, Math.max(f, f - end * 30), COL.mark); }
      rect(55 - lw / s / 2, -322, 55 + lw / s / 2, 322, COL.taxi);
    }
  }
}
const DCOL = { walk: '#b9b4aa', asphalt: '#4b4e53', pavers: '#bfae94', gravel: '#a39882', ramp: '#a9a49b', wood: '#8a6a4b', float: '#c9ccd0' };
/** A fishing dock (shared/dock-layout.js): its paving, the launch ramp, the piers and floating docks over the water. */
function drawDock(ctx, m, X, Z, s) {
  if (!Number.isFinite(m.y)) return;
  const K = DOCKS[m.kind], P = (a, f) => { const p = toWorldAt(m, a, f); return [X(p.x), Z(p.z)]; };
  const rect = (s0, f0, s1, f1, col) => { ctx.fillStyle = col; ctx.beginPath(); for (const [a, f] of [[s0, f0], [s1, f0], [s1, f1], [s0, f1]]) { const q = P(a, f); ctx.lineTo(q[0], q[1]); } ctx.closePath(); ctx.fill(); };
  for (const [s0, f0, s1, f1, kind] of K.plan.surfaces) rect(s0, f0, s1, f1, DCOL[kind]);
  const R = rampOf(m); rect(R.s0, R.f0, R.s1, R.f1, DCOL.ramp);
  const grow = Math.max(0, 1.2 / s - 1);   // (thin decks a pixel wide at least)
  for (const d of K.decks) rect(d.s0 - grow / 2, d.f0 - grow / 2, d.s1 + grow / 2, d.f1 + grow / 2, d.kind === 'float' || d.kind === 'finger' || d.kind === 'gang' ? DCOL.float : DCOL.wood);
  const st = K.store; rect(st.s0, st.f0, st.s1, st.f1, '#8b9098');
}
/** The airports and docks as places on the maps: { kind: 'airport' | 'dock', name, x, z (its door), icon }. */
export function airportPlaces(world) {
  return modulesOf(world).filter(m => m.kind === 'airport' || DOCKS[m.kind]).map(m => {
    if (DOCKS[m.kind]) { const d = DOCKS[m.kind].door, p = toWorldAt(m, d.s, d.f); return { kind: 'dock', name: m.name || WORLD_KINDS[m.kind].label, x: p.x, z: p.z, icon: WORLD_KINDS[m.kind].icon, module: m.id }; }
    const p = toWorldAt(m, 200, -25); return { kind: 'airport', name: m.name || 'Airport', x: p.x, z: p.z, icon: '✈️', module: m.id };
  });
}
