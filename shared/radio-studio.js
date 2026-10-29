// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Radio Studio, an interior module (shared/interior-modules.js; the product owner 2026-10-27: "the Studio building
// needs an actual studio ... studio modules, each module can have up to 3 hosts, and each module becomes essentially its
// own radio station ... placeable and resizeable"): only in a Radio Station's studio building (a world module's office,
// B.radio), placed by administrators, free; each one is a station (server/radio/radio.js makes it one, and takes it off
// the air when the studio goes). Laid out by its size in its own frame: u along its back wall, v from the back wall to
// its door. (ST4 of PLAN-SOUND-EFFECTS-AND-RADIO.md gives it the real broadcast pieces.)
import { registerInteriorKind } from './interior-modules.js';
import { CATALOG } from './catalog.js';
import { interiorBounds } from './edit.js';
import { itemAABB } from './geom.js';

const PART_HALF = 0.06;   // (half a partition wall's thickness: render/interiors.js partitions; a module's own walls stand on its sides)

export const STUDIO = registerInteriorKind({
  kind: 'studio', label: 'Radio Studio', icon: '🎙️', who: 'admin', price: 0, play: null, perFloor: 6, wall: true,
  blurb: 'A broadcast studio: each one is a station of MVW Radio, with up to three hosts at its microphones, its own playlist and its ads (Settings → Radio).',
  size: { min: [3.5, 3.0], max: [12, 9], step: 0.25 },
  allowed: B => (B?.radio ? null : 'Radio studios go in a Radio Station\'s studio building (World modules → Radio Station)'),
  fill(B, f, L, rec) {
    const { x0, z0, x1, z1, face } = rec, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // the frame: n points from the back wall to the door (face), u along the back wall (left −u, right +u)
    const n = [[0, 1], [1, 0], [0, -1], [-1, 0]][face], uA = [n[1], -n[0]];
    const W = face % 2 ? z1 - z0 : x1 - x0, D = face % 2 ? x1 - x0 : z1 - z0;
    const P = (u, v) => ({ x: cx + uA[0] * u + n[0] * (v - D / 2), z: cz + uA[1] * u + n[1] * (v - D / 2) });
    const toDoor = Math.atan2(n[0], n[1]), toBack = toDoor + Math.PI, toRight = Math.atan2(uA[0], uA[1]), toLeft = toRight + Math.PI;
    const items = [], put = (t, u, v, r) => items.push({ t, ...P(u, v), r });
    // a piece hung on a wall sits flush on its face (2026-10-28, the product owner: the clock was "on the center of the
    // wall and not on the surface"): a side along the building's own wall is its inner face already; elsewhere the module's
    // own wall stands on the side, half its thickness inward. flush(t, d): from the side to the piece's middle, its back
    // (CATALOG rect) against the wall; d: the side's outward direction.
    const ib = B ? interiorBounds(B) : null, near = (a, b) => Math.abs(a - b) < 0.06;
    const outer = d => !!ib && (d[0] > 0.5 ? near(x1, ib.x1) : d[0] < -0.5 ? near(x0, ib.x0) : d[1] > 0.5 ? near(z1, ib.z1) : near(z0, ib.z0));
    const flush = (t, d) => (outer(d) ? 0.005 : PART_HALF + 0.005) + Math.max(0, -(CATALOG[t]?.rect?.[1] ?? 0));
    const right = uA, left = [-uA[0], -uA[1]], back = [-n[0], -n[1]], front = n;
    // every piece inside the walls' faces, whatever the room's size and turn (2026-10-28, the product owner: the guest
    // table's chair "is going through the wall ... if i resize the room it will get redrawn on the incorrect location"):
    // a piece crossing a face is moved back in by as much (pushIn). Laid in the order they matter (the desk and its hosts
    // first), a piece that would stand in one laid before it is left out, or tried elsewhere (putClear); two pieces with
    // seats keep room between them to reach those seats; what hangs on a wall over others (block: false) is never in the way.
    const side = d => (outer(d) ? 0.01 : PART_HALF + 0.01);
    const inner = { x0: x0 + side([-1, 0]), x1: x1 - side([1, 0]), z0: z0 + side([0, -1]), z1: z1 - side([0, 1]) };
    const box = it => itemAABB({ ...it, r: it.r || 0 }, CATALOG[it.t].rect);
    const pushIn = it => {
      if (!CATALOG[it.t]?.rect) return it;
      const bb = box(it);
      it.x += Math.max(0, inner.x0 - bb.x0) - Math.max(0, bb.x1 - inner.x1);
      it.z += Math.max(0, inner.z0 - bb.z0) - Math.max(0, bb.z1 - inner.z1);
      return it;
    };
    const seated = it => !!CATALOG[it.t]?.slots?.length, solid = it => CATALOG[it.t]?.block !== false, SEAT_GAP = 0.35;
    const clash = (a, b) => {
      if (!solid(a) || !solid(b)) return false;
      const p = box(a), q = box(b), g = seated(a) && seated(b) ? -SEAT_GAP : 0.02;
      return p.x0 < q.x1 - g && p.x1 > q.x0 + g && p.z0 < q.z1 - g && p.z1 > q.z0 + g;
    };
    /** Piece t at the first of its places ([u, v, r]) that is inside the walls and clear of what is laid; none: left out. */
    const putClear = (t, places) => {
      for (const [u, v, r] of places) {
        const it = pushIn({ t, ...P(u, v), r }), b = box(it);
        if (b.x0 < inner.x0 - 0.01 || b.x1 > inner.x1 + 0.01 || b.z0 < inner.z0 - 0.01 || b.z1 > inner.z1 + 0.01) continue;   // (bigger than the room that way)
        if (!items.some(o => clash(it, o.t ? pushIn({ ...o }) : o))) { items.push(it); return true; }
      }
      return false;
    };
    // the back wall: acoustic panels, monitor speakers before them; the broadcast desk facing them, its hosts' chairs
    // behind it (its front, the console and the screens toward the back wall; three microphones)
    const vA = flush('acoustic_wall', back);
    put('acoustic_wall', 0, vA, toDoor);
    for (let k = 1; 2.45 * k + 1.2 < W / 2; k++) for (const s of [-1, 1]) put('acoustic_wall', s * 2.45 * k, vA, toDoor);   // (a wide room: the whole back wall)
    const roomy = D >= 3.6;
    if (roomy) put('studio_monitors', 0, 0.3, toDoor);
    put('broadcast_desk', 0, roomy ? 1.25 : 1.0, toDoor);
    if (W >= 5) for (const s of [-1, 1]) put('gear_rack', s * 2.05, 0.4, toDoor);   // racks either side of the desk
    // the side walls: the vinyl wall on the left, the clock on the right
    if (W >= 5.4 && D >= 3.2) put('vinyl_wall', -W / 2 + flush('vinyl_wall', left), Math.max(1.95, D / 2), toRight);
    const big = W >= 9 && D >= 6.5;
    if (big) put('vinyl_wall', W / 2 - flush('vinyl_wall', right), 2.0, toLeft);   // (a big room: a second wall of records, the clock past it)
    put('studio_clock', W / 2 - flush('studio_clock', right), big ? 3.75 : Math.min(1.6, D / 2), toLeft);
    // the DJ booth on the right, its DJ facing the room; the guests' table on the left by the door
    const dj = (D >= 5.1 && W >= 4.6) || W >= 7.2;
    if (dj) put('studio_dj', W / 2 - 1.3, D - 1.35, toLeft);
    // the guests' table by the door on the left (or the right, with no DJ there), its guests facing each other; the first
    // of its places clear of the rest
    if (D >= 4.6 && W >= 5) putClear('guest_table', [[-W / 2 + 1.6, D - 1.35, toRight], [-W / 2 + 1.6, D - 1.35, toDoor], [-W / 2 + 1.45, D - 1.0, toRight], ...(dj ? [] : [[W / 2 - 1.6, D - 1.35, toRight], [W / 2 - 1.6, D - 1.35, toDoor]])]);
    if (D >= 4.2 && W >= 5.4) put('record_crate', -W / 2 + 0.45, D - 0.4, toBack);
    if (!dj && D >= 3.8) put('plant_tall', W / 2 - 0.45, D - 0.45, 0);
    put('on_air_sign', 0, D - flush('on_air_sign', front), toBack);   // over the door, inside
    // every piece inside the walls' faces (pushIn), kept clear of the pieces laid before it (the end of fill)
    for (const it of items) pushIn(it);
    const kept = [];
    for (const it of items) if (!kept.some(o => clash(it, o))) kept.push(it);
    return { items: kept };
  },
});
