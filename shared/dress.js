// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The dressing: the small things a piece of furniture holds by itself, so a room looks lived in (PLAN-SURFACES.md 4.4;
// the product owner 2026-11-05: "furnishing a room must be procedurally generated based on rules, so things are placed in
// the expected and proper location"). A piece with no `on` of its own (shared/surfaces.js) is dressed by the rules
// (shared/dress-rules.js) for the floor's context (an office, a home, a café, a shop by what it sells), its class and each
// of its surfaces; from a seed made of the building's seed, the floor, the floor's roll and theme, its context, the
// piece's id, its reroll (ds) and the goods' revision, so every client draws the same things, nothing is written to the
// world, and a floor laid out again (Regenerate, a theme, a resize) is dressed anew while Reset gives back the first one.
// Pure: the client draws it (render/interiors.js), the editor turns it into the piece's own list when one of its things
// is edited (ui/editors.js), the tests check it (tests/dress.test.mjs).
//   - a floor's goods come from small pools: per tag a few models picked for that floor, at most DRESS_Q.models in all
//     (one draw each), a lower quality using the first of the same picks
//   - placed in each surface's own rules: on a desk at the back and the sides (the work area, the monitor, the keyboard
//     and the seat in front kept clear), in rows facing the aisle on a shelf, one piece in the middle of a dining table;
//     never on MVW's own things there (the surfaces' keep-outs), never where a resident's laptop or plate goes (seats)
//   - a shelf MVW draws full of books keeps them but at one end; a store shelf it draws full of boxes is drawn bare where
//     real goods stand (cuts: render/furniture.js fillKey)
import { CATALOG } from './catalog.js';
import { GOODS_REV } from './goods-catalog.js';
import { GOODS_TRIS } from './goods-tris.js';
import { surfacesOf, hostClass, onWhy, onCorners, quadsOverlap, ON_MAX } from './surfaces.js';
import { RNG } from './rng.js';
import { RULES, STORE_GOODS, ruleFor } from './dress-rules.js';
import { STORE_KINDS } from './store-goods.js';

/** Per quality: share of the rules' counts drawn, and the budgets of one floor's dressing (PLAN-SURFACES.md 9): things,
 *  triangles, distinct models (each one draw). */
export const DRESS_Q = {
  high: { density: 1, inst: 2000, tris: 300000, models: 14 },   // (measured, tools-bin/dress-check.mjs --perf: planned 3,000 /
  medium: { density: 0.65, inst: 1000, tris: 150000, models: 10 },   //  450k / 40 models on high cost a store +17 % of its frame,
  low: { density: 0.35, inst: 400, tris: 60000, models: 6 },   //  18 models an office +0.4 ms: each model is one draw, ~20 µs of JavaScript)
};
const qOf = q => DRESS_Q[q] || DRESS_Q.high;
const GAP = 0.012, EDGE = 0.012;   // m: between things in a row; kept in from a surface's edge
const r3 = v => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ what a floor is, what a shop sells
/** The words of a shop's name -> what it sells (SHOP_NAMES, shared/names.js, all 20 covered; tests/dress.test.mjs). */
const NAME_WORDS = [[/\b(shoes?|soles?|boots?|sneakers?)\b/i, 'shoes'], [/\b(grocer|grocery|market|fresh|deli)\b/i, 'grocery'],
  [/\b(mart|corner|convenience|kwik|quick)\b/i, 'convenience'], [/\b(books?|nook|library)\b/i, 'books'], [/\b(records?|music|vinyl)\b/i, 'music'],
  [/\b(gadgets?|tech|electronics?)\b/i, 'electronics'], [/\b(pixel|games?)\b/i, 'games'], [/\b(toys?)\b/i, 'toys'],
  [/\b(home|hearth|crate)\b/i, 'homeware'], [/\b(florist|bloom|flowers?)\b/i, 'florist'], [/\b(paper|supply|stationery)\b/i, 'stationery'],
  [/\b(beauty|cosmetics)\b/i, 'beauty'], [/\b(pharmacy|drugs?|chemist)\b/i, 'pharmacy'], [/\b(outfitters|outdoors?|wanderlust|camping)\b/i, 'outdoor'],
  [/\b(pets?)\b/i, 'pet'], [/\b(thread|needle|style|clothing|fashion|boutique)\b/i, 'clothing'], [/\b(goods|general)\b/i, 'general']];
/** A shop with a name that says nothing ("Store 21") sells one of these, by its building's seed. */
const STORE_PICK = [['general', 3], ['grocery', 2], ['convenience', 2], ['shoes', 1], ['clothing', 1], ['electronics', 1], ['games', 1],
  ['toys', 1], ['homeware', 1], ['books', 1], ['beauty', 1], ['pharmacy', 1], ['stationery', 1], ['florist', 0.5], ['music', 0.5],
  ['outdoor', 0.5], ['pet', 0.5]];
/** What building B's shop sells when its owner has not said: tackle (the dock store), clothes (a clothes shop), else its
 *  name's words, else a pick by its seed. */
export function storeDefault(B) {
  if (!B) return 'general';
  if (B.tackle) return 'tackle';
  if (B.clothes) return 'clothing';
  const name = String(B.shopName || B.name || '');
  for (const [re, k] of NAME_WORDS) if (re.test(name)) return k;
  return new RNG(`${B.seed ?? B.idx ?? 0}:sells`).weighted(STORE_PICK);
}
/** What shop floor L of building B sells: its own choice (lvl.goods) or the default. */
export const storeKind = (B, L) => (L?.goods && Object.hasOwn(STORE_KINDS, L.goods) ? L.goods : storeDefault(B));
/** The dressing's context of floor f (level L) of building B: 'office', 'home', 'cafe', 'restaurant', 'bar', 'gym',
 *  'arcade', 'club', 'park', 'terminal', 'shop:<what it sells>', or null (dressed by nothing). */
export function dressContext(B, f, L) {
  if (!B || !L) return null;
  const v = L.venue;
  if (v === 'shop') return 'shop:' + storeKind(B, L);
  if (v === 'cafe' || v === 'restaurant' || v === 'gym' || v === 'arcade' || v === 'club' || v === 'park') return v;
  if (v === 'lounge_bar' || v === 'lounge') return 'bar';
  if (L.theme === 'office' || L.theme === 'conference') return 'office';
  if (B.type === 'office' || B.type === 'hq') return 'office';
  if (B.type === 'apartment') return 'home';
  if (B.type === 'terminal') return 'terminal';
  if (B.type === 'park') return 'park';
  return null;
}
/** The seed of floor f's dressing (its pools and, with a piece's id and reroll, the piece's things). */
export const floorSeed = (B, f, L) => `${B?.seed ?? B?.idx ?? 0}:${f}:${L?.roll || 0}:${L?.theme || ''}:${GOODS_REV}`;

// ------------------------------------------------------------------ models
let trisMap = null;
/** Triangles of type t's dressing copy (400 when unknown). */
export function goodsTris(t) {
  if (!trisMap) { trisMap = new Map(); for (const l of GOODS_TRIS.split('\n')) { if (!l) continue; const [a, b, n] = l.split(':'); trisMap.set(`${a}:${b}`, +n); } }
  return trisMap.get(t) ?? 400;
}
const palettes = new Map();
/** The models the dressing may draw for tag (their first tag; small enough for a table or a shelf; franchise art only
 *  when fr). */
function palette(tag, fr) {
  const key = `${tag}:${fr ? 1 : 0}`;
  let p = palettes.get(key);
  if (p) return p;
  p = [];
  for (const [t, d] of Object.entries(CATALOG)) {
    if (!(d.size === 'surface' || d.onOk) || d.tags?.[0] !== tag || (d.franchise && !fr)) continue;   // (by what it is first: a table lamp is a lamp, not decor)
    const w = Math.max(d.rect[2] - d.rect[0], d.rect[3] - d.rect[1]), h = d.h - (d.lift || 0);
    if (w > 0.5 || h > 0.6 || h < (tag === 'plant' ? 0.06 : 0.004)) continue;   // (a plant, not its pot's saucer)
    p.push(t);
  }
  palettes.set(key, p);
  return p;
}
// ------------------------------------------------------------------ what fits where (P5: no big packs on a desk, no three mugs)
const DRINKWARE = /\b(mugs?|cups?|glass(es)?|tumblers?|teapot|pitcher)\b/i, PACKED = /\b(box(es)?|packs?|cartridges?|tubs?|bags|cakes|snacks|kit|games?)\b/i;
/** A thing's family for the rules' caps: 'drink' (a mug, a cup, a drink), 'pack' (a boxed pack: ink, snacks, a board
 *  game), else its first tag. */
export function family(t) {
  const d = CATALOG[t], tag = d?.tags?.[0];
  if (!d) return '';
  if (tag === 'mug' || tag === 'drink' || DRINKWARE.test(d.name)) return 'drink';
  if (tag !== 'storage-box' && PACKED.test(d.name)) return 'pack';
  return tag;
}
const SCATTER_W = 0.35, SCATTER_AREA = 0.12;   // m, share: a scattered thing's largest side and its footprint's share of the top
const sideOf = t => { const r = CATALOG[t].rect; return Math.max(r[2] - r[0], r[3] - r[1]); };
const areaOf = t => { const r = CATALOG[t].rect; return (r[2] - r[0]) * (r[3] - r[1]); };
/** Does model t belong on a piece dressed by rule r (its size, its name)? Rows (shelves) take any size that fits. */
function fitsRule(r, t) {
  const d = CATALOG[t];
  if (r.avoid && r.avoid.test(d.name)) return false;
  if (r.layout === 'row') return true;
  return sideOf(t) <= (r.tagW?.[d.tags?.[0]] ?? r.maxW ?? SCATTER_W);
}

/** The rules of context ctx, each with the tags it draws from (shares of its weights) as the floor's pools see them. */
function ctxRules(ctx) {
  const shop = ctx.startsWith('shop:'), G = shop ? STORE_GOODS[ctx.slice(5)] : null, out = [];
  const shares = tags => { const sum = Object.values(tags || {}).reduce((a, b) => a + b, 0) || 1; return Object.entries(tags || {}).map(([t, w]) => [t, w / sum]); };
  for (const r0 of RULES) {
    if (r0.none || !r0.ctx.some(c => c === '*' || c === ctx || (shop && c === 'shop'))) continue;
    const r = r0.store ? { ...r0, tags: G?.tags, avoid: G?.avoid } : r0;
    out.push({ r, tags: [...shares(r.tags), ...shares(r.extra)] });
  }
  return out;
}
/**
 * A floor's pools: per tag the models its pieces draw from, { tag: [type, ...] }, at most DRESS_Q[q].models in all; a lower
 * quality takes the first of the same picks. fseed: floorSeed(...). The models a floor has most use for come first: each
 * rule weighs by its `pool` (an office's desks), a tag's models are those its rules allow (shared/dress-rules.js maxW,
 * avoid), the ones its main rule allows and prefers first (small desk things on an office floor).
 */
export function dressPools(ctx, fseed, q = 'high') {
  if (!ctx) return {};
  const fr = !!STORE_GOODS[ctx.slice(5)]?.franchise, CR = ctxRules(ctx), W = new Map(), main = new Map(), users = new Map();
  for (const { r, tags } of CR) for (const [t, w0] of tags) {
    const w = w0 * (r.pool ?? 1);
    if (w > (W.get(t) || 0)) { W.set(t, w); main.set(t, r); }
    (users.get(t) || users.set(t, []).get(t)).push(r);
  }
  const G = STORE_GOODS[ctx.slice(5)];
  if (G) { const sum = Object.values(G.tags).reduce((a, b) => a + b, 0); for (const [t, w] of Object.entries(G.tags)) W.set(t, (W.get(t) || 0) + 2 * w / sum); }   // (a shop is mostly what it sells)
  // per tag its candidates in the floor's order: those every rule of the tag allows (one model, many pieces) and its main
  // rule prefers, then those every rule allows, then those its main rule allows, then the others' only
  const cands = new Map();
  for (const t of W.keys()) {
    const m = main.get(t), U = users.get(t) || [];
    const rank = x => (U.every(r => fitsRule(r, x)) ? (m.prefer?.test(CATALOG[x].name) ? 0 : 1) : fitsRule(m, x) ? 2 : 3);
    const order = new RNG(`${fseed}:${ctx}:${t}`).shuffle(palette(t, fr).filter(x => U.some(r => fitsRule(r, x))));
    cands.set(t, order.map((x, i) => [rank(x), i, x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(e => e[2]));
  }
  const live = [...W].filter(([t]) => cands.get(t).length).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const alloc = cap => {
    const sum = live.reduce((a, [, w]) => a + w, 0) || 1, K = new Map(live.map(([t, w]) => [t, Math.min(cands.get(t).length, Math.round(cap * w / sum))]));
    for (const { r, tags } of CR) {   // (every rule keeps a model of the tag it wants most, but the rare pieces')
      if ((r.pool ?? 1) < 1) continue;
      const own = tags.filter(([t]) => cands.get(t)?.length).sort((a, b) => b[1] - a[1]);
      if (own.length && !own.some(([t]) => K.get(t) > 0)) K.set(own[0][0], 1);
    }
    let tot = [...K.values()].reduce((a, b) => a + b, 0);
    while (tot > cap) {   // (over: the largest give one back, then the least wanted go)
      let best = null; for (const [t, k] of K) if (k > 1 && (!best || k > K.get(best))) best = t;
      if (!best) for (let i = live.length - 1; i >= 0; i--) if (K.get(live[i][0]) > 0) { best = live[i][0]; break; }
      if (!best) break;
      K.set(best, K.get(best) - 1); tot--;
    }
    return K;
  };
  const hi = alloc(DRESS_Q.high.models), mine = alloc(qOf(q).models), out = {};
  for (const [t] of live) {
    const n = Math.min(hi.get(t) || 0, mine.get(t) || 0); if (!n) continue;
    out[t] = cands.get(t).slice(0, n);   // (the first n of the same order at every quality)
  }
  return out;
}

// ------------------------------------------------------------------ one piece
const rectQ = ([x0, z0, x1, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
/** Where people sit or work at host it's surface S (its slots): 0.6 m wide at the edge they face, up to 0.45 m in (a
 *  third of the top's depth: a café table keeps its middle), host frame. */
export function seatZones(it, S) {
  const out = [], dz = Math.max(0.15, Math.min(0.45, 0.35 * (S.z1 - S.z0))), dx = Math.max(0.15, Math.min(0.45, 0.35 * (S.x1 - S.x0)));   // (a small table keeps its middle)
  for (const sl of CATALOG[it.t]?.slots || []) {
    if (!(/^sit/.test(sl.anim || '') || ['work', 'eat', 'meeting', 'prep'].includes(sl.use))) continue;
    const { x, z } = sl;
    if (z > S.z1 && z - S.z1 <= 0.9 && x > S.x0 - 0.3 && x < S.x1 + 0.3) out.push([x - 0.3, S.z1 - dz, x + 0.3, S.z1 + 0.05]);
    else if (z < S.z0 && S.z0 - z <= 0.9 && x > S.x0 - 0.3 && x < S.x1 + 0.3) out.push([x - 0.3, S.z0 - 0.05, x + 0.3, S.z0 + dz]);
    else if (x > S.x1 && x - S.x1 <= 0.9 && z > S.z0 - 0.3 && z < S.z1 + 0.3) out.push([S.x1 - dx, z - 0.3, S.x1 + 0.05, z + 0.3]);
    else if (x < S.x0 && S.x0 - x <= 0.9 && z > S.z0 - 0.3 && z < S.z1 + 0.3) out.push([S.x0 - 0.05, z - 0.3, S.x0 + dx, z + 0.3]);
  }
  return out;
}
/** A model's footprint turned by r (0, ±π/2, π): [w along x, d along z, x0, z0] of the turned rect. */
function turned(t, r) {
  const [x0, z0, x1, z1] = CATALOG[t].rect, k = Math.round(r / (Math.PI / 2)) & 3;
  if (k === 0) return [x1 - x0, z1 - z0, x0, z0];
  if (k === 2) return [x1 - x0, z1 - z0, -x1, -z1];
  if (k === 1) return [z1 - z0, x1 - x0, z0, -x1];   // (yaw +90: x' = z, z' = -x)
  return [z1 - z0, x1 - x0, -z1, x0];
}
const height = t => CATALOG[t].h - (CATALOG[t].lift || 0);

/**
 * The things piece `it` ({ t, id, ds?, m? }) holds by itself on a floor of context ctx with pools (dressPools) and seed
 * fseed (floorSeed) at quality q: { list: [{ t, s, x, z, r }], cuts: [[y, top, x0, z0, x1, z1]] (where MVW's own fill is
 * drawn bare: render/furniture.js fillKey), tris }, or null when it holds nothing. Every thing passes shared/surfaces.js
 * checkOn (the server's check), so the list can become the piece's own as it is.
 */
export function dressHost(it, ctx, pools, fseed, q = 'high') {
  if (!ctx || !it || Array.isArray(it.on)) return null;
  const surfs = surfacesOf(it);
  if (!surfs.length) return null;
  const cls = hostClass(it), mvwFill = !(typeof it.m === 'string' && it.m);
  const R = new RNG(`${fseed}:${ctx}:${it.id}:${it.ds || 0}`), Q = qOf(q);
  const list = [], cuts = [], placed = surfs.map(() => []);
  let tris = 0;
  // one thing tried at e: inside its surface, clear of its keep-outs, the seats, the others and outside the region
  const tryPut = (e0, keep) => {
    const e = { t: e0.t, s: e0.s, x: r3(e0.x), z: r3(e0.z), r: r3(Math.atan2(Math.sin(e0.r), Math.cos(e0.r))) };   // (as stored: shared/surfaces.js cleanOn)
    if (list.length >= cap || onWhy(surfs, e)) return false;
    const C = onCorners(e);
    for (const k of keep) if (quadsOverlap(C, rectQ(k), 0)) return false;
    for (const P of placed[e.s]) if (quadsOverlap(P, C, -0.004)) return false;   // (a few mm apart)
    placed[e.s].push(C); list.push(e); tris += goodsTris(e.t); count(e.t);
    return true;
  };
  // a model of tag-weighted kind that passes ok (from the pool, starting at a seeded place: neighbours differ)
  const pickModel = (tags, ok) => {
    const entries = Object.entries(tags).filter(([t, w]) => w > 0 && pools[t]?.length);
    if (!entries.length) return null;
    for (let k = 0; k < 6; k++) {
      const tag = R.weighted(entries), P = pools[tag], i0 = R.int(0, P.length - 1);
      for (let j = 0; j < P.length; j++) { const t = P[(i0 + j) % P.length]; if (CATALOG[t] && ok(t)) return t; }
    }
    return null;
  };
  // what the piece holds so far, for its rules' caps (one mug, one boxed pack on a desk; a model once on a scattered top)
  const nModel = new Map(), nFam = new Map();
  const capsOk = (rule, t) => {
    if (rule.layout === 'row') return true;
    if (!rule.repeat && nModel.get(t)) return false;
    const f = family(t), cap = rule.caps?.[f] ?? (f === 'drink' || f === 'pack' ? 1 : Infinity);
    return (nFam.get(f) || 0) < cap;
  };
  const count = t => { nModel.set(t, (nModel.get(t) || 0) + 1); const f = family(t); nFam.set(f, (nFam.get(f) || 0) + 1); };
  const dressed = surfs.filter(S => ruleFor(ctx, cls, S.kind)).length;
  let cap = ON_MAX;   // (things on one surface at most: a fair share of the piece's ON_MAX, so its last shelves get theirs)
  surfs.forEach((S, s) => {
    const rule = ruleFor(ctx, cls, S.kind);
    if (!rule || (rule.chance !== undefined && !R.chance(rule.chance))) return;
    cap = list.length + Math.floor(ON_MAX / dressed);
    // the region dressed: the whole surface, or one end of a shelf of MVW's books (the rest keeps them)
    let x0 = S.x0, x1 = S.x1;
    const fill = mvwFill && S.fill;
    if (fill && rule.half) { const L = (x1 - x0) * rule.half; if (s % 2) x0 = x1 - L; else x1 = x0 + L; }
    const out = [];   // (keep-outs of the region: what is outside it on this surface)
    if (x0 > S.x0) out.push([S.x0 - 1, S.z0 - 1, x0, S.z1 + 1]);
    if (x1 < S.x1) out.push([x1, S.z0 - 1, S.x1 + 1, S.z1 + 1]);
    if (fill) cuts.push([S.y, S.y + Math.min(S.clear, 0.6) + 0.03, x0 - (x0 > S.x0 ? 0.01 : 0.04), S.z0 - 0.04, x1 + (x1 < S.x1 ? 0.01 : 0.04), S.z1 + 0.04]);
    const keep = [...out, ...(rule.seat ? seatZones(it, S) : [])];
    const maxH = Math.min(S.clear - 0.01, rule.maxH ?? 0.6), top = (x1 - x0) * (S.z1 - S.z0);
    const fitsH = t => height(t) <= maxH && fitsRule(rule, t) && capsOk(rule, t) && (rule.layout === 'row' || areaOf(t) <= SCATTER_AREA * top);
    if (rule.layout === 'row') rowLayout(S, s, x0, x1, rule, keep, fitsH);
    else {
      const len = x1 - x0, dens = Q.density;
      const want = rule.per ? R.float(rule.per[0], rule.per[1]) * len : R.int(rule.n?.[0] ?? 1, rule.n?.[1] ?? 2);
      let n = Math.floor(want * dens + R.next());
      if (rule.layout === 'centre') {   // one piece in the middle, then the extras
        const t = pickModel(rule.tags, t => fitsH(t) && Math.max(...turned(t, 0).slice(0, 2)) < Math.min(len, S.z1 - S.z0) - 0.04);
        if (t) tryPut({ t, s, x: (x0 + x1) / 2, z: (S.z0 + S.z1) / 2, r: R.float(-Math.PI, Math.PI) }, keep);
        n = Math.floor((rule.n ? R.int(rule.n[0], rule.n[1]) : 0) * dens + R.next());
      }
      for (let i = 0; i < n; i++) scatterOne(S, s, x0, x1, rule.extra && rule.layout === 'centre' ? rule.extra : rule.tags, rule.place, keep, fitsH);
    }
  });
  function scatterOne(S, s, x0, x1, tags, place, keep, fitsH) {
    const t = pickModel(tags, t => fitsH(t) && Math.max(...turned(t, 0).slice(0, 2)) < Math.min(x1 - x0, S.z1 - S.z0) - 0.02);
    if (!t) return;
    const d = CATALOG[t], xc = (x0 + x1) / 2, zc = (S.z0 + S.z1) / 2, hw = (x1 - x0) / 2, back = S.side === 'b' ? 1 : -1;
    for (let k = 0; k < 14; k++) {
      const x = Math.round(R.float(x0, x1) / 0.02) * 0.02, z = Math.round(R.float(S.z0, S.z1) / 0.02) * 0.02;
      if (place === 'back' && S.side !== 'fb' && (z - zc) * back < 0 && Math.abs(x - xc) < 0.6 * hw) continue;   // (the front middle: where someone works or is served)
      const r = d.round ? R.float(-Math.PI, Math.PI) : d.front ? (S.side === 'b' ? Math.PI : 0) + R.float(-0.35, 0.35) : R.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) + R.float(-0.15, 0.15);
      if (tryPut({ t, s, x, z, r }, keep)) return;
    }
  }
  function rowLayout(S, s, x0, x1, rule, keep, fitsH) {
    const rows = S.side === 'fb' ? [[(S.z0 + S.z1) / 2, S.z1, 0], [S.z0, (S.z0 + S.z1) / 2, Math.PI]] : [[S.z0, S.z1, S.side === 'b' ? Math.PI : 0]];
    const facings = rule.facings || [1, 2], fill = Math.min(1, (rule.fill ?? 0.8) * Q.density);
    const side = R.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;   // (things side-on all point one way along a shelf)
    for (const [z0, z1, face] of rows) {
      const len = x1 - x0 - 2 * EDGE, depth = z1 - z0 - 2 * EDGE, groups = [];
      let used = 0;
      for (let k = 0; k < 40 && used < fill * len && list.length + groups.reduce((a, g) => a + g.n, 0) < cap; k++) {
        // a model that fits the row facing out, or side-on (a shoe on a shallow shelf)
        let r = face;
        const t = pickModel(rule.tags, t => {
          if (!fitsH(t)) return false;
          const a = turned(t, face), b = turned(t, face + Math.PI / 2);
          return (a[1] <= depth && a[0] <= len - used) || (b[1] <= depth && b[0] <= len - used);
        });
        if (!t) { used += 0.05; continue; }
        const a = turned(t, face);
        if (!(a[1] <= depth && a[0] <= len - used)) r = face + side;
        const [w] = turned(t, r), n = Math.max(1, Math.min(R.int(facings[0], facings[1]), Math.floor((len - used + GAP) / (w + GAP))));
        groups.push({ t, r, w, n });
        used += n * (w + GAP);
      }
      if (!groups.length) continue;
      // the space left: between the groups at random (a shelf not quite full)
      const slack = Math.max(0, len - used), cut = groups.map(() => R.next()), cs = cut.reduce((a, b) => a + b, 0) + R.next() || 1;
      let x = x0 + EDGE;
      groups.forEach((g, i) => {
        x += slack * cut[i] / cs;
        const [w, dz, rx0, rz0] = turned(g.t, g.r);
        for (let k = 0; k < g.n; k++) {
          // its front at the row's aisle edge (face 0: z1, face π: z0), its left side at x
          const zc = face === 0 ? (z1 - EDGE) - (rz0 + dz) : (z0 + EDGE) - rz0;
          tryPut({ t: g.t, s, x: x - rx0, z: zc, r: g.r }, keep);
          x += w + GAP;
        }
      });
    }
  }
  return list.length || cuts.length ? { list, cuts, tris } : null;
}

// ------------------------------------------------------------------ a whole floor (the tests; the client works piece by piece)
/** The dressing of floor f (level L) of building B at quality q: { ctx, hosts: Map(id -> dressHost result), inst, tris,
 *  models (distinct types) } before any budget (the client keeps the nearest pieces within DRESS_Q: dressBudget). */
export function dressFloor(B, f, L, q = 'high') {
  const ctx = dressContext(B, f, L), out = { ctx, hosts: new Map(), inst: 0, tris: 0, models: new Set() };
  if (!ctx || !L) return out;
  const fseed = floorSeed(B, f, L), pools = dressPools(ctx, fseed, q);
  for (const it of L.items || []) {
    const r = dressHost(it, ctx, pools, fseed, q);
    if (!r) continue;
    out.hosts.set(it.id, r); out.inst += r.list.length; out.tris += r.tris;
    for (const e of r.list) out.models.add(e.t);
  }
  return out;
}
/** Which pieces' dressing is drawn: `order` the dressed pieces nearest first ([{ list, tris }]); taken while the floor's
 *  things, triangles and models keep within DRESS_Q[q] (a piece that would pass is skipped: farther ones may still fit).
 *  -> a Set of the indexes taken. */
export function dressBudget(order, q = 'high') {
  const B = qOf(q), take = new Set(), models = new Set();
  let inst = 0, tris = 0;
  order.forEach((h, i) => {
    if (!h?.list?.length) { if (h) take.add(i); return; }
    const add = h.list.filter(e => !models.has(e.t)).map(e => e.t), nm = new Set(add).size;
    if (inst + h.list.length > B.inst || tris + h.tris > B.tris || models.size + nm > B.models) return;
    take.add(i); inst += h.list.length; tris += h.tris; for (const t of add) models.add(t);
  });
  return take;
}
