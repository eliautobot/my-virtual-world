// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The island around the city (WP4.2, WP4.16): terrain tiles in a distance-based quadtree (full 8 ft detail near the
// camera, coarser with distance), built in a worker and swapped in only when a whole subtree is ready (no holes, no
// overlaps), the endless ocean, the lakes, and natural scatter (trees, bushes, rocks) as instanced meshes on the
// nearest tiles. Budgets per quality level: tile resolution, detail distance, scatter radius, shadows.
import * as THREE from 'three';
import { GU, wettable, uploadUsed } from './scene.js';
import { Ocean, shoreFoam, waveHeight, underwater, withUnderside } from './water.js';
import { OceanWaves } from './ocean-fft.js';
import { groundDetail } from './ground-detail.js';
import { rf } from '../core/render-flags.js';
import { bakeGround } from './ground-bake.js';
import { countrysideMaterial, countrysideMesh, COUNTRYSIDE_R, SMALL_K } from './countryside.js';
import { natureModels } from './nature-models.js';
import { buildingPads } from '/shared/island-build.js';
import { hasCity } from '/shared/city.js';
import { bus } from '../core/state.js';
import { MARKS_U, MARKS_GLSL, hullsUpdate } from './water-marks.js';
import { toWorld } from '/shared/geom.js';
import { CHUNK_M, tarnShore, lakeShore } from '/shared/terrain.js';
import { SNOW_LINE } from '/shared/biome.js';
import { fadeable, FADE_S, FADE_GLSL, holeable, holeUniforms, HOLE_N } from './fade.js';

// n0: cells per full-detail tile (50 = the canonical 8 ft grid), n: cells for coarser tiles, split: detail distance
// in tile sizes, scatter: radius (m) and instance caps, shadowR: scatter within this radius casts shadows, lodR: trees
// within it are drawn in full detail (render/nature-models.js), grassR / grassCap: grass tufts and wild flowers; ocean: the
// sea's wave simulation (render/ocean-fft.js: samples across, cascade sizes) - none: the simpler Gerstner sea.
const Q = {
  low: { n0: 25, n: 16, split: 0.75, scatterR: 0, scatterCap: 0, shadowR: 0, minLevel: 1, maxTiles: 40, uploads: 1, uploadMs: 2, gm: 32, ocean: null },
  medium: { n0: 25, n: 40, split: 0.85, poolBudget: 300e3, scatterR: 280, scatterCap: 9000, shadowR: 0, lodR: 70, grassR: 45, grassCap: 7000, minLevel: 0, maxTiles: 60, uploads: 1, uploadMs: 3, gm: 48, ocean: { n: 64, sizes: [420, 90, 19] } },
  high: { n0: 50, n: 50, split: 1.25, poolBudget: 600e3, scatterR: 520, scatterCap: 40000, shadowR: 170, lodR: 170, grassR: 95, grassCap: 32000, minLevel: 0, maxTiles: 90, uploads: 2, uploadMs: 4, gm: 96, ocean: { n: 128, sizes: [503, 67, 11.3] } },
};
// Ground heights the browser keeps (shared/terrain.js GroundQuery: 400 ft chunks, ~10 KB each): enough for everything
// asking each frame - residents, cars, animals, boats - over the view, so none is recomputed frame after frame.
const GROUND_CHUNKS = 384;
const ROOT_LEVEL = 7;
// Streaming ahead (2026-10-04: driving, "the other area takes time to load and suddenly appears"): tiles are built
// for where the camera will be LOOK_S seconds on (at most LOOK_MAX m), and finer ones out to MARGIN x the distance they
// are switched in at, all round - ready before they are needed; behind what is wanted now in the queue (AHEAD_M).
const LOOK_S = 3, LOOK_MAX = 600, MARGIN = 1.35, AHEAD_M = 150;
// The coarsest tiles that carry trees (thinned: terrain.worker.js treeLevel) - past them, no trees stand
const FAR_TREE_LEVEL = 2;
const PIN_LEVEL = 5;   // tiles this coarse (≈ 3.9 km) cover the island from the start and are always kept
const tileDist = (m, c) => { const S = CHUNK_M * 2 ** m.level, dx = Math.max(m.x0 - c.x, 0, c.x - m.x0 - S), dz = Math.max(m.z0 - c.z, 0, c.z - m.z0 - S); return dx * dx + dz * dz; };   // 400 ft × 2^7 ≈ 15.6 km: a couple of roots cover the island and its shelf

/**
 * Shapes a unit disc (in the xz plane, round the origin) to a tarn's water: out to ext × r along its wandering shore
 * (shared/terrain.js tarnShore), but no further than just past where its river leaves, so no sheet of still water
 * lies over the river's channel falling away. Returns each vertex's distance out (0..1) for the shading.
 */
function tarnWater(geo, k, ext) {
  const pos = geo.attributes.position, edge = new Float32Array(pos.count), oa = Math.atan2(k.outlet.z - k.z, k.outlet.x - k.x);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), f = Math.hypot(x, z), a = Math.atan2(z, x);
    let da = Math.abs(a - oa); if (da > Math.PI) da = 2 * Math.PI - da;
    const R = k.r * Math.min(ext * tarnShore(k, a), da < 0.5 ? 1.17 + (ext - 1.17) * (da / 0.5) ** 2 : Infinity);
    pos.setXYZ(i, x * R, 0, z * R); edge[i] = f;
  }
  pos.needsUpdate = true; geo.computeBoundingSphere();
  return edge;
}

export class Terrain {
  constructor(stage, world, { quality = 'high', groundY = 0.15 } = {}) {
    this.stage = stage; this.world = world; this.cfg = Q[quality] || Q.high; this.quality = quality;
    this.params = world.terrain;
    this.group = new THREE.Group(); this.group.name = 'terrain';
    this.tiles = new Map();          // key → { mesh, scatter: [meshes], level, tx, tz, box }
    this.pending = new Map();        // key → requested
    this.ready = [];                 // built tiles waiting to become meshes (upload budget)
    this.readyKeys = new Set();
    this.shown = new Set();
    this.indexCache = new Map();
    this.lakes = [];
    const g = world.grid, hr = g.road / 2;
    // The city's road edge: terrain is held below it so the city's own ground shows (none without a city).
    const X0 = -g.nx * (g.bw + g.road) / 2 - hr, Z0 = -g.nz * (g.bd + g.road) / 2 - hr;
    this.hole = hasCity(g) ? { x0: X0 + 0.01, z0: Z0 + 0.01, x1: -X0 - 0.01, z1: -Z0 - 0.01 } : null;
    // No polygon offset: the generator keeps the natural plain 5 cm below the city's apron, so they never coincide.
    this.uSurf = { value: 1 };   // how far the surf washes up the beach (render/water.js)
    // ground detail last, so it is drawn before the surf and the rain darken it (render/ground-detail.js)
    // one material per tile (its ground map, render/ground-detail.js), all sharing one compiled program
    // (the sea floor seen through the full sea's clear water: render/water.js underwater)
    // the ground's costliest detail drawn once into textures (render/ground-bake.js; render flag 'bake')
    if (rf('bake')) { try { this.bake = bakeGround(stage.renderer, quality === 'high' ? 1024 : 512); } catch (e) { console.warn('[mvw] ground bake failed; drawing it per pixel', e); this.bake = null; } }
    this.uw = (m, o) => (this.cfg.ocean ? underwater(m, world.terrain.seaLevel, o) : m);
    this.groundMat = map => this.uw(groundDetail(shoreFoam(wettable(new THREE.MeshStandardMaterial({ vertexColors: !map, roughness: 0.96, metalness: 0 }), { darken: 0.22, gloss: 0.35 }), world.terrain.seaLevel, this.uSurf, this.sea.u), { lite: quality !== 'high', sea: world.terrain.seaLevel, map, bake: this.bake?.texture || null }));
    // Several workers build tiles side by side (2026-10-03: crossing the map took seconds): as many as the device
    // has cores to spare, up to four. The first also answers depth maps and map pictures.
    // (?tw=n for a test)
    const nW = Number(new URLSearchParams(location.search).get('tw')) || Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    this.pads = buildingPads(world);
    this.workers = Array.from({ length: nW }, (_, i) => {
      const w = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = e => this.onMessage(e.data, i);
      w.postMessage({ op: 'init', params: this.params, roads: world.roads || null, pads: this.pads, hole: this.hole, noiseTex: rf('noise') });
      return w;
    });
    this.worker = this.workers[0];
    this.busy = new Array(nW).fill(0);   // tiles each worker is building
    this.fades = new Map();              // tile key → { dir: +1 in | −1 out, start (s) }
    this.dfades = new Map();             // tile key → when what stands on it arrived (s): fading in
    this.detailReady = [];
    this.buildOcean();
    this.mat = this.groundMat(null);
    this.buildScatterKinds();
    // crops, hedges, fences, walls and bales on the nearest tiles (render/countryside.js)
    this.csR = COUNTRYSIDE_R[quality] ?? COUNTRYSIDE_R.high;
    this.csMat = countrysideMaterial(this.csR); this.csSmallMat = countrysideMaterial(this.csR * SMALL_K);
    this.stats = { tiles: 0, triangles: 0, scatter: 0, builds: 0 };
    this.epoch = 0;   // bumped when the roads change: tiles built for older roads are dropped
    this.ground = null;   // GroundQuery (same heights as the server) once the generator module is loaded
    import('/shared/terrain.js').then(async T => {
      const island = new T.Island(this.params, { roads: world.roads || null, pads: this.pads });
      this.ground = new T.GroundQuery(island, { maxChunks: GROUND_CHUNKS });
      bus.emit('ground');   // (what stands on the land beyond the city - decorations, a dock's rocks - on it from the start)
      if (island.rivers?.length) { const { RiversLayer } = await import('./rivers.js'); this.rivers = new RiversLayer(island, this.waterNormal); this.group.add(this.rivers.group); }
      if (island.roads) {
        const { IslandRoadsLayer } = await import('./island-roads.js');
        this.roadLayer = new IslandRoadsLayer(island.roads, { cityRect: this.hole, seabed: (x, z) => island.baseHeight(x, z), extraCuts: await this.cityCuts(), ground: (x, z) => this.pointHeight(x, z) });
        this.group.add(this.roadLayer.group);
      }
      this.buildYards();
    });
  }
  /**
   * The roads (WP4.4) or the buildings beyond the city (WP4.6) changed: the ground is graded to the new roads and
   * building pads, so the tiles near anything that changed are rebuilt (each replaces the shown one when ready), and the
   * road surfaces, the height queries and the trees beside roads follow. Call with the world's new roads; the pads come
   * from its buildings.
   */
  async setGround(roads, params = this.params) {
    const before = new Map((this.world.roads || []).map(r => [r.id, JSON.stringify(r)])), after = new Map((roads || []).map(r => [r.id, JSON.stringify(r)]));
    const changed = [...(this.world.roads || []), ...(roads || [])].filter(r => before.get(r.id) !== after.get(r.id));
    const pads = buildingPads({ ...this.world, roads: roads || [] }), oldPads = new Set((this.pads || []).map(p => JSON.stringify(p))), newPads = new Set(pads.map(p => JSON.stringify(p)));
    const padChanges = [...(this.pads || []).filter(p => !newPads.has(JSON.stringify(p))), ...pads.filter(p => !oldPads.has(JSON.stringify(p)))];
    // Terrain strokes (WP4.7): the ground around every stroke added, changed or taken back is rebuilt.
    const oldE = new Map((this.params.edits || []).map(e => [e.id, JSON.stringify(e)])), newE = new Map((params.edits || []).map(e => [e.id, JSON.stringify(e)]));
    const editChanges = [...(this.params.edits || []), ...(params.edits || [])].filter(e => oldE.get(e.id) !== newE.get(e.id));
    // Islands of the chain added or taken away (WP4.15): all the ground round them.
    const oldI = new Map((this.params.islands || []).map(I => [I.id, JSON.stringify(I)])), newI = new Map((params.islands || []).map(I => [I.id, JSON.stringify(I)]));
    const isleChanges = [...(this.params.islands || []), ...(params.islands || [])].filter(I => oldI.get(I.id) !== newI.get(I.id));
    if (!changed.length && !padChanges.length && !editChanges.length && !isleChanges.length && params === this.params) return;
    this.world.roads = roads || [];
    this.pads = pads;
    this.params = params;
    this.epoch++;
    for (const w of this.workers) w.postMessage({ op: 'ground', params, roads: this.world.roads, pads });
    const T = await import('/shared/terrain.js'), { alignmentGeometry } = await import('/shared/roads.js'), { roadShifts } = await import('/shared/island-roads.js');
    const oldRoads = this.ground?.island.roads || null;
    const island = new T.Island(this.params, { roads: this.world.roads, pads });
    this.ground = new T.GroundQuery(island, { maxChunks: GROUND_CHUNKS });
    // the new ground is in (it came after the edit's own events): what stands on it - a dock's rocks, the decorations
    // (a new dock's benches) - is laid again on it (2026-10-15, the product owner: a marina placed showed neither until
    // a reload)
    bus.emit('ground');
    if (editChanges.some(e => e.kind === 'pond')) this.setLakes(island.lakes);
    if (changed.length) {
      if (this.roadLayer) { this.group.remove(this.roadLayer.group); this.roadLayer.dispose(); this.roadLayer = null; }
      if (island.roads) { const { IslandRoadsLayer } = await import('./island-roads.js'); this.roadLayer = new IslandRoadsLayer(island.roads, { cityRect: this.hole, seabed: (x, z) => island.baseHeight(x, z), extraCuts: await this.cityCuts(), ground: (x, z) => this.pointHeight(x, z) }); this.group.add(this.roadLayer.group); }
    }
    // Tiles touching what changed (road corridors, junction pads and grading blend; building pads) are rebuilt.
    const pad = 60, boxes = [];
    for (const r of changed) { try { const b = alignmentGeometry(r).bbox; boxes.push({ x0: b.x0 - pad, z0: b.z0 - pad, x1: b.x1 + pad, z1: b.z1 + pad }); } catch { /* skipped */ } }
    // A road joined by another changes too, though its record didn't (2026-10-13: "after connecting it has terrain
    // issues"): the junction takes a shared height, so the old road is re-profiled through it and its junction pad is
    // new - the ground there was graded to the old heights, and grass showed through the road. Every stretch whose
    // profile moved and every junction pad that came, went or changed is rebuilt as well.
    if (changed.length) for (const b of roadShifts(oldRoads, island.roads)) boxes.push({ x0: b.x0 - pad, z0: b.z0 - pad, x1: b.x1 + pad, z1: b.z1 + pad });
    for (const p of padChanges) { const R = Math.hypot(p.hw, p.hd) + (p.blend || 8) + 4; boxes.push({ x0: p.x - R, z0: p.z - R, x1: p.x + R, z1: p.z + R }); }
    for (const e of editChanges) { const R = e.r * 1.3 + 8; boxes.push({ x0: e.x - R, z0: e.z - R, x1: e.x + R, z1: e.z + R }); }
    for (const I of isleChanges) { const R = I.radius * 1.8; boxes.push({ x0: I.center.x - R, z0: I.center.z - R, x1: I.center.x + R, z1: I.center.z + R }); }
    for (const [k, t] of this.tiles) {
      if (!boxes.some(b => t.x0 < b.x1 && t.x0 + t.S > b.x0 && t.z0 < b.z1 && t.z0 + t.S > b.z0)) continue;
      if (this.shown.has(k)) t.stale = true; else { this.disposeTile(t); this.tiles.delete(k); }
    }
    this.pending.clear(); this.busy.fill(0); this.ready = []; this.readyKeys.clear(); this.detailReady = [];
    for (const t of this.tiles.values()) if (t.detail === 'asked') t.detail = undefined;   // asked of the old ground: ask again
    this.buildYards();
  }
  /** Paved paths from the doors of buildings beyond the city straight out to the back of their road, on the ground. */
  buildYards() {
    if (this.yards) { this.group.remove(this.yards); this.yards.geometry.dispose(); this.yards = null; }
    const net = this.roadNet; if (!net) return;
    const pos = [], idx = [];
    for (const B of this.world.buildings || []) {
      if (!B || B.gone || B.base === undefined || !B.door) continue;
      const r = (B.rot || 0) * Math.PI / 180, fx = Math.sin(r), fz = Math.cos(r), rx = Math.cos(r), rz = -Math.sin(r), hw = B.door.w / 2 + 0.4;
      const a = toWorld(B, B.door.x, B.d / 2);
      let L = 0;
      const onRoad = L => { const near = net.nearest(a.x + fx * L, a.z + fz * L, 40); return !!near && near.dist <= net.profiles[net.get(near.id).profile].outerHalf / 1e6; };
      for (; L < 45; L += 0.5) if (onRoad(L)) break;
      if (L >= 45) continue;   // no road straight ahead: no path
      // to the back of the sidewalk exactly, not over it (2026-10-14: the path lay over the sidewalk's edge)
      { let lo = Math.max(0, L - 0.5), hi = L; for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (onRoad(m)) hi = m; else lo = m; } L = lo; }
      // on a grid's lots (render/lot-ground.js) flat on the lot as in the city; elsewhere a little over the ground
      const lift = this.ground?.island.underAt?.(a.x, a.z) ? 0.012 : 0.05;
      const n = Math.max(1, Math.ceil(L / 1.5)), v0 = pos.length / 3;
      for (let k = 0; k <= n; k++) for (const side of [-1, 1]) {
        const x = a.x + fx * L * k / n + rx * hw * side, z = a.z + fz * L * k / n + rz * hw * side;
        pos.push(x, this.heightAt(x, z) + lift, z);
      }
      for (let k = 0; k < n; k++) { const q = v0 + k * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.yardMat ||= wettable(new THREE.MeshStandardMaterial({ color: 0xb9b3a7, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }), { darken: 0.2, gloss: 0.3 });
    this.yards = new THREE.Mesh(g, this.yardMat); this.yards.receiveShadow = true; this.yards.name = 'yards';
    this.group.add(this.yards);
  }
  /** Ground height (m) at (x, z), the same function the server uses; the city plain before the generator loads. */
  /** Where the city's own junctions take over the roads that join it (shared/city-roads.js): those stretches are theirs. */
  async cityCuts() { const { cityRoadSet } = await import('/shared/city-roads.js'); return cityRoadSet(this.world.grid, this.world.roads)?.islandCuts || null; }
  heightAt(x, z) { return this.ground ? this.ground.height(x, z) : this.params.plainY; }
  /** The ground's height at one point, worked out there (not from the cached 8 ft grid around it): for one-off queries
   *  scattered over the island - street furniture, flight planning - where heightAt would build a whole 122 m chunk of
   *  2601 heights per query (7 s of the phone's start-up, 2026-10-04). Within centimetres of heightAt. */
  pointHeight(x, z) { return this.ground ? this.ground.island.height(x, z) : this.params.plainY; }
  /** The top of whatever is at (x, z): the ground, or the water over it (sea, lake or river). */
  surfaceAt(x, z) {
    const h = Math.max(this.params.seaLevel, this.heightAt(x, z)), w = this.ground?.water(x, z);
    return w && w.level > h ? w.level : h;
  }
  /** Sea or lake at (x, z) (players stop at the shoreline). */
  isWater(x, z) { return this.ground ? !!this.ground.water(x, z) : false; }
  /** Where a ray (THREE.Ray) first meets the island's ground or the sea's surface: { x, y, z }, or null. */
  rayHit(ray) {
    if (!this.ground) return null;
    const o = ray.origin, d = ray.direction, sea = this.params.seaLevel;
    const above = t => { const x = o.x + d.x * t, z = o.z + d.z * t; return o.y + d.y * t - Math.max(sea, this.heightAt(x, z)); };
    let t0 = 0, t = 1;
    for (let k = 0; k < 400 && t < 20000; k++) {
      if (above(t) < 0) {
        for (let i = 0; i < 24; i++) { const m = (t0 + t) / 2; if (above(m) < 0) t = m; else t0 = m; }
        const x = o.x + d.x * t, z = o.z + d.z * t;
        return { x, y: Math.max(sea, this.heightAt(x, z)), z };
      }
      t0 = t; t += Math.max(1, t * 0.03);
    }
    return null;
  }
  /** The island's road network (shared/roads.js RoadNetwork), or null before it loads or without roads. */
  get roadNet() { return this.ground?.island.roads?.net || null; }
  /** The camera's target rides on the ground, so panning over hills keeps them in view. */
  followGround(cam, dt) {
    if (!this.ground || cam.followLock) return;
    const h = this.surfaceAt(cam.goal.x, cam.goal.z), k = Math.min(1, dt * 5);   // (on a lake, its water: never under it)
    cam.goal.y += (h - cam.goal.y) * k;
  }
  /** Never let the camera go below the ground (looking along a mountainside). */
  keepCameraAbove(camera, cc = null) {
    if (!this.ground) return;
    // first person (camera.js): the camera is in the player's eyes, which their body keeps where they belong (under the
    // water too, diving); gliding in, the 2.5 m it keeps over the ground shrinks with the glide
    const fp = cc?.fpK || 0;
    if (fp >= 1) return;
    const p = camera.position;
    // under a bridge's deck (below its underside, ~0.95 m thick) the camera keeps above the water or ground beneath it,
    // not above the deck (the player's camera comes under a bridge with a swimmer, player.js deckCamera)
    const deck = this.ground.island?.roads?.deckAt(p.x, p.z);
    if (deck !== null && deck !== undefined && p.y < deck - 0.9) {
      const below = this.ground.island.belowDeck(p.x, p.z), w = this.ground.island.waterAt(p.x, p.z, below);
      const floor = Math.max(this.params.seaLevel, below, w ? w.level : -Infinity) + 0.35;
      if (p.y < floor) { p.y = floor; camera.updateMatrixWorld(); }
      return;
    }
    const h = this.surfaceAt(p.x, p.z) + 2.5 * (1 - fp);
    if (p.y < h) { p.y = h; camera.updateMatrixWorld(); }
  }

  // ---------------------------------------------------------------- water
  buildOcean() {
    const sea = this.params.seaLevel;
    const tex = waterNormalTexture();
    this.waterNormal = tex;
    // The ocean (WP4.18, render/water.js): waves along the wind, sized by the weather; follows the camera.
    this.sea = new Ocean(sea, tex, this.uSurf, this.cfg.ocean ? new OceanWaves(this.stage.renderer, this.cfg.ocean) : null);
    // the whole island's water depth, coarse (≈ 25 m): far shallows stay clear turquoise beyond the maps round the camera
    const P = this.params, FS = P.radius * 2 + 3000;
    this.workers[this.workers.length - 1].postMessage({ op: 'depth', id: 'depthF', x0: P.center.x - FS / 2, z0: P.center.z - FS / 2, size: FS, n: 449 });
    this.ocean = this.sea.mesh; this.oceanMat = this.sea.material;
    this.group.add(this.ocean);
    // Lakes (2026-10-03: "clear ... a bit of smaller, more subtle waves on the edges, coming in and out ... dynamic
    // on the edges ... that transparency feel"): clear over the shallows (the bed shows), deep green-blue where it's
    // deep, by the water's real depth over the ground at each point (aBed); small waves lapping in and out at the edge
    // with a line of foam riding them; ripples drifting over it.
    this.lakeMat = new THREE.MeshStandardMaterial({ color: 0x2b6a6a, roughness: 0.08, metalness: 0.02, transparent: true, opacity: 0.88, normalMap: tex, normalScale: new THREE.Vector2(0.22, 0.22), depthWrite: false, envMapIntensity: 0.45 });
    this.lakeMat.onBeforeCompile = sh => {
      sh.uniforms.uLTime = GU.uTime; Object.assign(sh.uniforms, MARKS_U);   // (MARKS_U: what boats and splashes do to it, render/water-marks.js)
      sh.vertexShader = 'attribute float aEdge, aBed;\nuniform float uLTime;\nvarying float vEdge, vBed, vLap;\nvarying vec3 vLPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vEdge = aEdge; vBed = aBed;
  vec3 lw = (modelMatrix * vec4(position, 1.0)).xyz;
  // small waves running in to the shore, rising and falling at its edge
  float lap = 0.035 * sin(length(position.xz) * 0.9 - uLTime * 1.6) * (0.6 + 0.4 * sin(atan(position.z, position.x) * 3.0 + uLTime * 0.21));
  lap *= smoothstep(-1.5, -0.1, aBed);
  transformed.y += lap; vLap = lap;`).replace('#include <project_vertex>', '#include <project_vertex>\n  vLPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform float uLTime;\nvarying float vEdge, vBed, vLap;\nvarying vec3 vLPos;\nfloat lH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }\nfloat lN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(lH(i), lH(i + vec2(1.0, 0.0)), f.x), mix(lH(i + vec2(0.0, 1.0)), lH(i + vec2(1.0, 1.0)), f.x), f.y); }\n' + MARKS_GLSL + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if (mkDry(vLPos)) discard;   // (not inside a boat's hull: render/water-marks.js)
        float dep = vLap - vBed, ed = max(fwidth(dep), 0.002);
        // clear over the shallows (the bed shows), deep green-blue in the middle
        diffuseColor.rgb = mix(vec3(0.16, 0.5, 0.42), vec3(0.03, 0.22, 0.26), smoothstep(0.3, 4.0, dep));
        diffuseColor.a = mix(0.25, 0.86, smoothstep(0.15, 3.5, dep)) * smoothstep(-ed, 0.12 + ed, dep);
        // the foam line on the lapping edge
        float lace = lN(vLPos.xz * 1.4 + uLTime * 0.15) * 0.6 + lN(vLPos.xz * 3.7 - uLTime * 0.2) * 0.4;
        float lip = (1.0 - smoothstep(0.0, 0.07 + ed * 2.0, dep)) * smoothstep(-ed, ed * 2.0, dep) * (0.55 + 0.45 * lace);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.95), lip * 0.8); diffuseColor.a = max(diffuseColor.a, lip * 0.75);
        // what boats and splashes did to it: churned, milky water; white water; their waves (normal below)
        float mkF, mkA; vec2 mkS; mkAt(vLPos.xz, mkF, mkA, mkS);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.42, 0.68, 0.6), vec3(0.2, 0.44, 0.44), smoothstep(0.5, 4.0, dep)), mkA * 0.7); diffuseColor.a = max(diffuseColor.a, mkA * 0.6);
        float mkW = mkFoam(vLPos.xz, mkF, length(fwidth(vLPos.xz)), uLTime);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.92), mkW); diffuseColor.a = max(diffuseColor.a, mkW * 0.92);`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n        normal = normalize(normal - (viewMatrix * vec4(mkS.x, 0.0, mkS.y, 0.0)).xyz);');
    };
    this.lakeMat.customProgramCacheKey = () => 'lake-water';
    withUnderside(this.lakeMat, 'vLPos');   // (seen from under the water too: diving in a lake)
    // A frozen tarn (shared/terrain.js _tarns): clear blue-grey ice where the wind has swept it, snow dust drifting over
    // it and banked toward the shore, white cracks; glossy where clear. Drawn just over the flat ground under it.
    this.iceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.iceMat.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute float aEdge;\nvarying float vEdge;\nvarying vec2 vIPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vEdge = aEdge; vIPos = (modelMatrix * vec4(position, 1.0)).xz;');
      sh.fragmentShader = `varying float vEdge;
varying vec2 vIPos;
float iH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float iN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(iH(i), iH(i + vec2(1.0, 0.0)), f.x), mix(iH(i + vec2(0.0, 1.0)), iH(i + vec2(1.0, 1.0)), f.x), f.y); }
float iSnow = 0.0;
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vIPos; float ipx = length(fwidth(p));
        float n = iN(p * 0.07) * 0.6 + iN(p * 0.23 + 4.0) * 0.4, fine = iN(p * 1.3 + 9.0);
        vec3 ice = mix(vec3(0.13, 0.25, 0.33), vec3(0.32, 0.48, 0.58), n) * (0.9 + 0.15 * fine);
        iSnow = smoothstep(0.62, 0.85, n * 0.7 + fine * 0.15 + smoothstep(0.7, 0.97, vEdge) * 0.5);
        // cracks: thin pale lines running straight-ish across it, a few branching off (never thicker than a pixel)
        vec2 cq = p + vec2(iN(p * 0.05), iN(p * 0.05 + 7.0)) * 6.0;
        float cr = max(1.0 - abs(iN(cq * 0.09 + 21.0) * 2.0 - 1.0), (1.0 - abs(iN(cq * 0.23 + 5.0) * 2.0 - 1.0)) * step(0.55, iN(cq * 0.04 + 2.0)));
        float cw = max(fwidth(cr), 1e-3), crack = smoothstep(0.985 - cw, 0.985 + cw, cr) * (1.0 - iSnow) * smoothstep(0.8, 0.2, ipx);
        diffuseColor.rgb = mix(ice, vec3(0.86, 0.89, 0.93), max(iSnow, crack * 0.55));`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.08, 0.85, iSnow);');
    };
    this.iceMat.customProgramCacheKey = () => 'tarn-ice';
  }
  /** Replaces the lakes' water (ponds dug or filled, WP4.7). */
  setLakes(lakes) {
    for (const m of this.lakes) { this.group.remove(m); m.geometry.dispose(); }
    this.lakes = [];
    this.addLakes(lakes);
  }
  async addLakes(lakes) {
    while (!this.ground) await new Promise(r => setTimeout(r, 100));   // the ground's heights (for each lake's bed)
    const island = this.ground.island.withoutBridges ? this.ground.island.withoutBridges() : this.ground.island;   // (the water under a bridge)
    for (const k of lakes) {
      if (k.frozen) {
        const geo = new THREE.CircleGeometry(1, 64); geo.rotateX(-Math.PI / 2);
        const edge = tarnWater(geo, k, 1.3);   // (its shore, where the ground rises over the ice, wanders inside this)
        geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
        const m = new THREE.Mesh(geo, this.iceMat); m.position.set(k.x, k.level, k.z); m.receiveShadow = true; m.userData.frozen = true;
        this.group.add(m); this.lakes.push(m);
        continue;
      }
      // rings round the middle out past the wandering shore (shared/terrain.js lakeShore), each vertex knowing how far
      // its bed lies under the water (aBed: the ground's height less the water's, negative under water)
      const R = k.r * (k.tarn ? 1.38 : 1.32), NR = Math.max(10, Math.round(R / 5)), NS = 72, pos = [], edge = [], bed = [], uv = [], idx = [];
      pos.push(0, 0, 0); edge.push(0); uv.push(0, 0); bed.push(island.height(k.x, k.z) - k.level);
      const oa = k.outlet ? Math.atan2(k.outlet.z - k.z, k.outlet.x - k.x) : null;
      for (let i = 1; i <= NR; i++) for (let j = 0; j < NS; j++) {
        const a = j / NS * Math.PI * 2, f = i / NR;
        let ext = R * lakeShore(k, a);
        if (oa !== null) { let da = Math.abs(a - oa); if (da > Math.PI) da = 2 * Math.PI - da; if (da < 0.5) ext = Math.min(ext, k.r * (1.17 + (1.38 - 1.17) * (da / 0.5) ** 2)); }   // a tarn's outlet
        const x = Math.cos(a) * ext * f, z = Math.sin(a) * ext * f;
        pos.push(x, 0, z); edge.push(f); uv.push(x / 6, z / 6); bed.push(island.height(k.x + x, k.z + z) - k.level);
      }
      const at = (i, j) => (i === 0 ? 0 : 1 + (i - 1) * NS + (j % NS));
      for (let j = 0; j < NS; j++) idx.push(0, at(1, j + 1), at(1, j));
      for (let i = 1; i < NR; i++) for (let j = 0; j < NS; j++) { const a0 = at(i, j), b0 = at(i, j + 1), c0 = at(i + 1, j), d0 = at(i + 1, j + 1); idx.push(a0, b0, d0, a0, d0, c0); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, q) => (q % 3 === 1 ? 1 : 0)), 3));
      geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1)); geo.setAttribute('aBed', new THREE.Float32BufferAttribute(bed, 1));
      geo.setIndex(idx); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, this.lakeMat); m.position.set(k.x, k.level, k.z); m.renderOrder = 1; m.receiveShadow = true; m.userData.r = k.r; m.userData.lake = k;
      m.onBeforeRender = hullsUpdate;   // (the boats' hulls it keeps out of)
      this.group.add(m); this.lakes.push(m);
    }
  }

  // ---------------------------------------------------------------- scatter
  buildScatterKinds() {
    const M = natureModels();
    // Each instance's colour applies where the model says (aTint: leaves, petals), not to trunks and hearts.
    this.uNat = { uNatCam: { value: new THREE.Vector3() }, uNatR: { value: this.cfg.grassR || 0 }, uNatNow: { value: 0 } };
    const natural = ({ sway = 0, grass = false, snowy = false, reef = false } = {}) => {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: grass ? THREE.DoubleSide : THREE.FrontSide });
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, this.uNat, { uWind: GU.uWind, uTime: GU.uTime, uSway: GU.uSway });
        sh.vertexShader = 'attribute float aTint;\nattribute float aBorn;\nuniform vec4 uWind, uSway;\nuniform float uTime, uNatR, uNatNow;\nuniform vec3 uNatCam;\nvarying float vNatFade;\n' + sh.vertexShader
          .replace('#include <color_vertex>', `vColor = vec4(1.0); vColor.rgb *= color;
            #ifdef USE_INSTANCING_COLOR
            vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);
            #endif`)
          .replace('#include <project_vertex>', `
          vec3 natP = transformed;
          vNatFade = clamp((uNatNow - aBorn) / ${FADE_S.toFixed(2)}, 0.0, 1.0);   // fading in as its tile arrives (render/fade.js)
          #ifdef USE_INSTANCING
          ${grass ? `// grass and flowers shrink away beyond their reach
          vec3 natO = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float natD = distance((modelMatrix * vec4(natO, 1.0)).xz, uNatCam.xz);
          natP *= smoothstep(uNatR, uNatR * 0.75, natD);` : ''}
          vec4 mvPosition = instanceMatrix * vec4(natP, 1.0);
          #else
          vec4 mvPosition = vec4(natP, 1.0);
          #endif
          ${sway ? `float hgt = max(natP.y - ${grass ? '0.0' : '0.8'}, 0.0);
          vec2 wdir = uWind.xz / max(uWind.w, 0.01);
          float ph = mvPosition.x * 0.13 + mvPosition.z * 0.09;
          float amp = (${grass ? '0.09 + 0.04 * uWind.w' : '0.0016 + 0.0009 * uWind.w'}) * (0.65 + 0.35 * sin(${grass ? 'uSway.y' : 'uSway.x'} + ph)) + 0.0012 * uWind.y * uWind.w * 0.1;
          mvPosition.xz += wdir * amp * hgt * ${grass ? '1.0' : 'hgt'};` : ''}
          ${snowy ? `// snow on its top above the snowline (shared/biome.js SNOW_LINE), thicker higher up, patchy at the line
          vec3 natW = (modelMatrix * mvPosition).xyz;
          #ifdef USE_INSTANCING
          vec3 natN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
          #else
          vec3 natN = normalize(mat3(modelMatrix) * objectNormal);
          #endif
          float natL = ${SNOW_LINE.toFixed(1)} + 40.0 * (sin(natW.x * 0.011) * sin(natW.z * 0.013));
          vNatSnow = 0.65 * smoothstep(natL - 25.0, natL + 10.0, natW.y) * smoothstep(0.7, 0.95, natN.y + 0.15 * sin(natW.x * 7.0 + natW.z * 5.0));` : ''}
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
        sh.fragmentShader = 'varying float vNatFade;\n' + FADE_GLSL + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (vNatFade < 1.0 && fadeNoise(gl_FragCoord.xy) >= vNatFade) discard;');
        if (snowy) {
          sh.vertexShader = 'varying float vNatSnow;\n' + sh.vertexShader;
          sh.fragmentShader = 'varying float vNatSnow;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.86, 0.9), vNatSnow);');
        }
      };
      // grass and petals are lit from the sky on both faces (no dark undersides)
      if (grass) { const pc = m.onBeforeCompile; m.onBeforeCompile = (sh, r) => { pc(sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);'); }; }
      m.customProgramCacheKey = () => `nature-${sway}-${grass}-${snowy}${reef ? '-reef' : ''}`;
      return this.uw(m, reef ? { clarity: 6 } : undefined);   // (the reefs' corals keep more of their colours under the water)
    };
    const sway = natural({ sway: 1 }), still = natural({ snowy: true }), grassy = natural({ sway: 1, grass: true }), reef = natural({ reef: true });
    // kind → models and how its pools split: near (full detail within lodR), far (beyond it), or one pool (reach: grass)
    this.kinds = {
      tree: { near: M.tree.near, far: M.tree.far, distant: M.tree.distant, mat: sway, share: 0.42 }, tree2: { near: M.tree2.near, far: M.tree2.far, distant: M.tree2.distant, mat: sway, share: 0.22 },
      birch: { near: M.birch.near, far: M.birch.far, distant: M.birch.distant, mat: sway, share: 0.16 },
      conifer: { near: M.conifer.near, far: M.conifer.far, distant: M.conifer.distant, mat: sway, share: 0.6 }, bush: { near: M.bush.near, mat: sway, share: 0.4 },
      rock: { near: M.rock.near, mat: still, share: 0.15 }, grass: { near: M.grass.near, mat: grassy, grass: true, share: 1 }, flower: { near: M.flower.near, mat: grassy, grass: true, share: 0.35 },
      reed: { near: M.reed.near, mat: grassy, grass: true, share: 0.25 },
      lily: { near: M.lily.near, mat: grassy, grass: true, share: 0.2 },
      // (under water: seen only close by)
      seagrass: { near: M.seagrass.near, mat: grassy, grass: true, share: 0.3 },
      // the reefs' colonies (render/terrain.worker.js reefAt), seen only close by through the water
      coralBranch: { near: M.coralBranch.near, mat: reef, share: 0.05, reach: 160 }, coralBrain: { near: M.coralBrain.near, mat: reef, share: 0.05, reach: 160 },
      coralTable: { near: M.coralTable.near, mat: reef, share: 0.04, reach: 160 }, coralFan: { near: M.coralFan.near, mat: reef, share: 0.04, reach: 160 }, coralTube: { near: M.coralTube.near, mat: reef, share: 0.04, reach: 160 },
      palm: { near: M.palm.near, far: M.palm.far, mat: sway, share: 0.08 },
      boulder: { near: M.boulder.near, mat: still, share: 0.06 }, pebbles: { near: M.pebbles.near, mat: still, share: 0.1, reach: 160 },
    };
  }
  /**
   * All scatter in a few instanced meshes (per kind: a full-detail pool for the nearest, a simpler one beyond; grass and
   * flowers within their reach only), refilled from the shown tiles when the shown set changes or the camera has moved
   * on: a handful of draw calls instead of one per tile. On High the full-detail pools cast shadows.
   */
  buildPools() {
    this.pools = [];
    if (!this.cfg.scatterCap) return;
    const c = this.cfg, lodShare = Math.min(1, (c.lodR * c.lodR) / (c.scatterR * c.scatterR) * 2.5);
    for (const [kind, K] of Object.entries(this.kinds)) {
      // trees: full detail near, simpler further, a plain crown far off (on the coarser tiles beyond the scatter's reach)
      const bands = K.grass ? [['all', K.near]] : K.far ? [['near', K.near], ['far', K.far], ...(K.distant ? [['distant', K.distant]] : [])] : [['all', K.near]];
      for (const [band, geo] of bands) {
        const cap = Math.max(64, Math.round(K.grass ? c.grassCap * K.share : c.scatterCap * K.share * (band === 'near' ? lodShare : band === 'distant' ? 1.4 : 1)));
        const im = new THREE.InstancedMesh(geo, K.mat, cap);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        im.geometry = geo.clone(); im.geometry.setAttribute('aBorn', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));   // (its own copy: the born times are per pool)
        im.count = 0; im.frustumCulled = false; im.castShadow = !!c.shadowR && (band === 'near' || band === 'all') && !K.grass && kind !== 'rock' && !kind.startsWith('coral'); im.receiveShadow = true;
        im.name = `scatter-${kind}-${band}`;
        this.group.add(im); this.pools.push({ kind, band, grass: !!K.grass, im, cap, reach: K.reach || 0 });
      }
    }
  }
  /**
   * Refill the scatter pools around camPos: kind by kind over the next frames (grass and flowers first, then the rest),
   * at most ~POOL_BUDGET of instance data sent to the GPU a frame - a kind's near, far and distant pools together, so no
   * tree is shown twice or lost where they meet. All in one frame, the refill every 25 m of driving sent the pools'
   * whole buffers at once (~16 MB at High) and held a busy phone 100-200 ms (2026-10-04). now: everything at once.
   */
  fillPools(camPos, now = false) {
    if (!this.pools) this.buildPools();
    this.poolAt = { x: camPos.x, z: camPos.z };
    this.poolOrder ??= [...new Set(this.pools.map(P => P.kind))].sort((a, b) => (this.pools.find(P => P.kind === b).grass ? 1 : 0) - (this.pools.find(P => P.kind === a).grass ? 1 : 0));
    this.poolDirty = new Set(this.poolOrder);
    if (now) { for (const k of this.poolOrder) this.fillKind(k); this.poolDirty.clear(); }
  }
  /** Some of the kinds waiting to be refilled each frame (terrain update), within the upload budget - taken in turn,
   *  carrying on where the last frame stopped, so refills asked for every frame (tiles arriving) still reach every kind. */
  stepPools() {
    const D = this.poolDirty; if (!D?.size) return;
    const order = this.poolOrder; let bytes = 0, i = this.poolNext || 0;
    for (let n = 0; D.size && n < order.length && bytes < (this.cfg.poolBudget || 600e3); n++, i++) { const k = order[i % order.length]; if (D.delete(k)) bytes += this.fillKind(k); }
    this.poolNext = i % order.length;
    this.stats.scatter = this.pools.reduce((n, P) => n + P.im.count, 0);
  }
  /** One kind's pools from the shown tiles, around this.poolAt; returns the bytes it sends to the GPU. */
  fillKind(kind) {
    const camPos = this.poolAt, c = this.cfg, lod2 = c.lodR * c.lodR, g2 = c.grassR * c.grassR, R2 = c.scatterR * c.scatterR;
    let bytes = 0;
    for (const P of this.pools) {
      if (P.kind !== kind) continue;
      let o = 0;
      const M = P.im.instanceMatrix.array, C = P.im.instanceColor.array, Bn = P.im.geometry.attributes.aBorn.array, lim = P.reach ? Math.min(R2, P.reach * P.reach) : P.grass ? g2 : P.band === 'distant' ? Infinity : R2;
      for (const k of this.shown) {
        const t = this.tiles.get(k), sc = t?.sc?.[P.kind]; if (!sc) continue;
        // tiles wholly out of reach are skipped
        const tx = Math.max(t.x0 - camPos.x, 0, camPos.x - t.x0 - t.S), tz = Math.max(t.z0 - camPos.z, 0, camPos.z - t.z0 - t.S);
        if (tx * tx + tz * tz > lim) continue;
        // born: when each fades in from - what also stood on the tile it replaced keeps that tile's time (no blink),
        // the rest (the trees a coarser tile left out, the grass) its own
        const p = sc.p, cc = sc.c, lvs = sc.v, n = cc.length / 3, own = Math.max(t.shownAt ?? 0, t.scBorn ?? 0), inh = t.kindBorn?.get(P.kind);
        const cov = t.covered, cellS = t.S / HOLE_N;   // (where finer tiles are shown over it, theirs stand instead)
        for (let i = 0; i < n && o < P.cap; i++) {
          const x = p[i * 5], z = p[i * 5 + 2], dx = x - camPos.x, dz = z - camPos.z, d2 = dx * dx + dz * dz;
          if (d2 > lim || (P.band === 'near' && d2 > lod2) || (P.band === 'far' && d2 <= lod2) || (P.band === 'distant' && d2 <= R2)) continue;
          if (cov && cov[(Math.min(HOLE_N - 1, Math.floor((z - t.z0) / cellS)) * HOLE_N + Math.min(HOLE_N - 1, Math.floor((x - t.x0) / cellS))) * 2] > 0) continue;
          const yaw = p[i * 5 + 3], s = p[i * 5 + 4], cs = Math.cos(yaw) * s, sn = Math.sin(yaw) * s, q = o * 16;
          M[q] = cs; M[q + 1] = 0; M[q + 2] = -sn; M[q + 3] = 0; M[q + 4] = 0; M[q + 5] = s; M[q + 6] = 0; M[q + 7] = 0;
          M[q + 8] = sn; M[q + 9] = 0; M[q + 10] = cs; M[q + 11] = 0; M[q + 12] = x; M[q + 13] = p[i * 5 + 1]; M[q + 14] = z; M[q + 15] = 1;
          C[o * 3] = cc[i * 3]; C[o * 3 + 1] = cc[i * 3 + 1]; C[o * 3 + 2] = cc[i * 3 + 2]; Bn[o] = inh && (!lvs || lvs[i] >= inh.lv) ? inh.born : own;
          o++;
        }
      }
      // (only the used part goes to the GPU: render/scene.js uploadUsed)
      P.im.count = o; uploadUsed(P.im.instanceMatrix, o); uploadUsed(P.im.instanceColor, o); uploadUsed(P.im.geometry.attributes.aBorn, o);
      bytes += o * 80;
    }
    return bytes;
  }

  // ---------------------------------------------------------------- tiles
  key(level, tx, tz) { return `${level}:${tx}:${tz}`; }
  indexFor(n) {
    let idx = this.indexCache.get(n); if (idx) return idx;
    const N = n + 1, tris = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * N + i, b = a + 1, c = a + N, d = c + 1; tris.push(a, c, b, b, c, d); }
    // Skirts: ring vertex k (top) ↔ N*N + k (bottom), in the order the worker wrote them.
    const ring = [];
    for (let i = 0; i < n; i++) ring.push(i);
    for (let j = 0; j < n; j++) ring.push(j * N + n);
    for (let i = n; i > 0; i--) ring.push(n * N + i);
    for (let j = n; j > 0; j--) ring.push(j * N);
    for (let k = 0; k < ring.length; k++) { const t0 = ring[k], t1 = ring[(k + 1) % ring.length], b0 = N * N + k, b1 = N * N + (k + 1) % ring.length; tris.push(t0, t1, b0, t1, b1, b0); }
    idx = new THREE.BufferAttribute(new Uint32Array(tris), 1);
    this.indexCache.set(n, idx); return idx;
  }
  onMessage(m, wi = 0) {
    if (m.op === 'ready') { if (wi === 0) this.addLakes(m.lakes); return; }
    if (m.op === 'error') { const r = this.maps?.get(m.id); if (r) { this.maps.delete(m.id); r.rej(new Error(m.error)); return; } console.warn('[terrain] tile failed', m.error); if (this.pending.delete(m.id) || this.pending.delete('d:' + m.id)) this.busy[wi] = Math.max(0, this.busy[wi] - 1); const t = this.tiles.get(m.id); if (t?.detail === 'asked') t.detail = 'done'; return; }
    if (m.op === 'tile') { if (this.pending.delete(m.id)) this.busy[wi] = Math.max(0, this.busy[wi] - 1); if ((m.epoch || 0) !== this.epoch) return; m.wi = wi; this.ready.push(m); this.readyKeys.add(m.id); }   // built for older roads: dropped
    if (m.op === 'detail') { if (this.pending.delete('d:' + m.id)) this.busy[wi] = Math.max(0, this.busy[wi] - 1); if ((m.epoch || 0) === this.epoch) this.detailReady.push(m); else { const t = this.tiles.get(m.id); if (t?.detail === 'asked') t.detail = undefined; } }   // attached one a frame (big crop meshes upload in the frame they're drawn)
    if (m.op === 'map') { const r = this.maps?.get(m.id); if (r) { this.maps.delete(m.id); r.res(m); } }
    if (m.op === 'depth') { if (m.id === 'depthN') this.depthBusyN = false; else if (m.id !== 'depthF') this.depthBusy = false; this.sea.setDepth(m); }
  }
  /**
   * Stand-ins for the materials tiles get as they stream in (a tile's ground with its map, its crops), so their shaders
   * are compiled behind the loading screen - not in the frame the first farm comes into view (a long frame on phones).
   * Add to the scene for the warm-up compile, then remove it and call its userData.dispose().
   */
  warmGroup() {
    const g = new THREE.Group(), one = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.position.y = -9999; g.add(m); };
    const px = new Uint8Array(4 * 4 * 4), tex = srgb => { const t = new THREE.DataTexture(px, 2, 2); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t; };
    const fade = { value: new THREE.Vector2(1, 0) };
    one(new THREE.PlaneGeometry(1, 1), holeable(fadeable(this.groundMat({ A: tex(true), B: tex(false), rect: new THREE.Vector4(0, 0, 1, 1) }), fade), holeUniforms()));
    one(new THREE.PlaneGeometry(1, 1), holeable(fadeable(this.groundMat(null), fade), holeUniforms()));   // (a tile without its map)
    const cs = { pos: new Float32Array(9), nrm: new Int8Array([0, 127, 0, 0, 127, 0, 0, 127, 0]), col: new Uint8Array(9), k: new Uint8Array(9), t: new Int16Array(6), idx: new Uint16Array([0, 1, 2]) };
    const csMesh = countrysideMesh(cs, fadeable(countrysideMaterial(this.csR, this.csMat.userData.cs), fade)), cssMesh = countrysideMesh(cs, fadeable(countrysideMaterial(this.csR * SMALL_K, this.csSmallMat.userData.cs), fade));
    for (const m of [csMesh, cssMesh]) { m.frustumCulled = false; m.position.y = -9999; g.add(m); }
    if (!this.pools) this.buildPools();   // (the scatter's pools: their materials compile with the rest)
    // After the warm-up the stand-ins leave the scene but their materials are kept: three.js frees a shader once no live
    // material uses it, and tiles come and go - without these the phone would compile them again on the next far jump.
    g.userData.dispose = () => { g.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); this.warmKept = g; };
    return g;
  }
  /** What stands on a tile (the worker's second step): it fades in. */
  attachDetail(t, m) {
    const now = performance.now() / 1000, fade = { value: new THREE.Vector2(0, 1) }, mesh = t.mesh;
    t.detail = 'done'; t.dfade = fade; this.dfades.set(t.key, now);
    const csMat = () => (t.csM ||= fadeable(countrysideMaterial(this.csR, this.csMat.userData.cs), fade));
    if (m.cs && this.csR > 0) { t.cs = countrysideMesh(m.cs, csMat()); t.cs.castShadow = this.cfg.shadowR > 0; mesh.add(t.cs); t.csTris = m.cs.idx.length / 3; }
    if (m.css && this.csR > 0) { t.cssM = fadeable(countrysideMaterial(this.csR * SMALL_K, this.csSmallMat.userData.cs), fade); t.css = countrysideMesh(m.css, t.cssM); mesh.add(t.css); t.cssTris = m.css.idx.length / 3; }
    if (m.lm) { t.lm = countrysideMesh(m.lm, csMat()); t.lm.castShadow = this.cfg.shadowR > 0; mesh.add(t.lm); }   // farmsteads: shown with their tile
    if (m.scatter) { t.sc = m.scatter; t.scBorn = now; t.hab = m.hab || null; this.refill = true; }
  }
  makeTile(m) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));   // (colour and kinds of ground: the ground map)
    geo.setIndex(this.indexFor(m.n));
    const S = CHUNK_M * 2 ** m.level;
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, m.minY, 0), new THREE.Vector3(S, m.maxY, S));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    let mat;
    if (m.gm) {
      const M = m.gm + 1, tex = (px, srgb) => {
        const t = new THREE.DataTexture(px, M, M, THREE.RGBAFormat, THREE.UnsignedByteType);
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
      };
      mat = this.groundMat({ A: tex(m.gmA, true), B: tex(m.gmB, false), rect: new THREE.Vector4(m.x0, m.z0, S, m.gm) });
    } else mat = this.groundMat(null);
    // one fade for the tile's ground and everything standing on it (render/fade.js)
    const fade = { value: new THREE.Vector2(1, 0) }, hole = holeUniforms();
    holeable(fadeable(mat, fade), hole);
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(m.x0, 0, m.z0); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    // Deep seabed under the ocean shows through only faintly: such tiles are built (so the swap completes) but not drawn.
    const hidden = m.allWater && m.maxY < this.params.seaLevel - 4;
    mesh.visible = !hidden;
    const tile = { key: m.id, level: m.level, tx: m.tx, tz: m.tz, x0: m.x0, z0: m.z0, S, mesh, fade, hole, sc: m.scatter || null, hab: m.hab || null, allWater: m.allWater, tris: hidden ? 0 : m.n * m.n * 2 };
    hole.rect.value.set(m.x0, m.z0, S, 0);
    tile.wi = m.wi;   // the worker that keeps its heights (for the second step)
    // A tile rebuilt after a road edit replaces the shown one in place (no gap, no doubled ground).
    const old = this.tiles.get(m.id);
    if (old) { if (this.shown.has(m.id)) { this.group.remove(old.mesh); this.group.add(mesh); tile.shownAt = old.shownAt; tile.inPlace = true; this.refill = true; } this.fades.delete(m.id); this.disposeTile(old); }
    this.tiles.set(m.id, tile);
    return tile;
  }
  /** Tiles the camera wants: split while closer than size × split factor; never below the quality's finest level. */
  // (the camera's own cover - splitK 1 - keeps what it split a little longer: an area is split at S x split and joined
  // again only past 12 % more, so a camera hovering at the distance doesn't flip it back and forth)
  wanted(cam, splitK = 1, own = splitK === 1) {
    const out = [], c = this.cfg, b = this.bounds(), split = c.split * splitK, was = own ? this._split : null, now = own ? new Set() : null;
    const visit = (level, tx, tz) => {
      const S = CHUNK_M * 2 ** level, x0 = tx * S, z0 = tz * S;
      if (x0 > b.x1 || x0 + S < b.x0 || z0 > b.z1 || z0 + S < b.z0) return;
      // Entirely under the city (its own ground covers it): nothing to draw.
      const H = this.hole; if (H && x0 >= H.x0 && x0 + S <= H.x1 && z0 >= H.z0 && z0 + S <= H.z1) return;
      const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + S)), dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + S)), dy = Math.max(0, cam.y - 300);
      const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
      const key = this.key(level, tx, tz);
      if (level > c.minLevel && dist < S * split * (was?.has(key) ? 1.12 : 1)) { now?.add(key); for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(level - 1, tx * 2 + i, tz * 2 + j); return; }
      out.push({ level, tx, tz, key, dist });
    };
    const S = CHUNK_M * 2 ** ROOT_LEVEL;
    for (let tx = Math.floor(b.x0 / S); tx <= Math.floor(b.x1 / S); tx++) for (let tz = Math.floor(b.z0 / S); tz <= Math.floor(b.z1 / S); tz++) visit(ROOT_LEVEL, tx, tz);
    if (own) this._split = now;
    return out;
  }
  /** The island's land with a margin of sea: the minimap's island view. */
  landBounds() {
    const b = this.bounds(1.12, 1.3), w = b.x1 - b.x0, h = b.z1 - b.z0, s = Math.max(w, h) / 2, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    return { x0: cx - s, z0: cz - s, x1: cx + s, z1: cz + s };   // square, for the minimap
  }
  /** A map picture of an area, built in the worker: resolves { w, h, px } (RGBA). */
  map(b, w, h) {
    this.maps ??= new Map(); this.mapSeq = (this.mapSeq || 0) + 1; const id = `map${this.mapSeq}`;
    return new Promise((res, rej) => { this.maps.set(id, { res, rej }); this.worker.postMessage({ op: 'map', id, x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, w, h }); });
  }
  /** Where there is land and its shelf: the main island and the chain's islands (WP4.15), each with a margin of sea. */
  bounds(k = 1.35, kc = 1.7) {
    const p = this.params, discs = [[p.center.x, p.center.z, p.radius * k], ...(p.islands || []).map(I => [I.center.x, I.center.z, I.radius * kc])];
    return { x0: Math.min(...discs.map(d => d[0] - d[2])), z0: Math.min(...discs.map(d => d[1] - d[2])), x1: Math.max(...discs.map(d => d[0] + d[2])), z1: Math.max(...discs.map(d => d[1] + d[2])) };
  }
  /**
   * Per frame: choose tiles, request the missing ones (nearest first, a coarser stand-in first where nothing near is
   * built), turn finished builds into meshes within a time budget, and show what is ready.
   * Shown: every wanted tile that is built; where one isn't, its nearest built ancestor stands in (or the finer tiles
   * shown before, when zooming out) - so each area sharpens as soon as its own tiles are in, nearest first, instead of
   * the whole view waiting for the last tile (2026-10-03). Changes cross-fade (render/fade.js).
   */
  update(camera) {
    const cam = camera.position, want = this.wanted(cam), now = performance.now() / 1000;
    want.sort((a, b) => a.dist - b.dist);
    this.motion(cam, now);
    this.request(want, cam);
    // uploads: the nearest finished tiles first, a few milliseconds' worth a frame; then what stands on them, nearest
    // first too, within the rest of the time (it was one a frame, in arrival order: after a jump the near tiles' trees
    // queued behind ~180 others, 2026-10-04)
    if (this.ready.length > 1) this.ready.sort((a, b) => tileDist(a, cam) - tileDist(b, cam));
    const t0 = performance.now(), budget = this.cfg.uploadMs || 3;
    for (let k = 0; this.ready.length && (k < 1 || performance.now() - t0 < budget); k++) { const m = this.ready.shift(); this.readyKeys.delete(m.id); this.makeTile(m); }
    if (this.detailReady.length > 1) this.detailReady.sort((a, b) => (this.tiles.get(a.id) ? tileDist(this.tiles.get(a.id), cam) : 1e12) - (this.tiles.get(b.id) ? tileDist(this.tiles.get(b.id), cam) : 1e12));
    for (let k = 0; this.detailReady.length && (k < 1 || performance.now() - t0 < budget + 2); k++) { const m = this.detailReady.shift(), t = this.tiles.get(m.id); if (t) this.attachDetail(t, m); }
    // fades in progress, each tile its own (from: where a reversed fade picks up)
    for (const [k, f] of this.fades) {
      const t = this.tiles.get(k), p = Math.min(1, (f.from || 0) + (now - f.start) / FADE_S);
      if (!t) { this.fades.delete(k); continue; }
      // (what stands on it fades with it: render/fade.js, the same pattern, so a farmstead is never doubled or gone)
      if (p >= 1) { this.fades.delete(k); if (f.dir < 0) this.group.remove(t.mesh); t.fade.value.set(1, 0); if (t.dfade && !this.dfades.has(k)) t.dfade.value.set(1, 0); }
      else { t.fade.value.set(p, f.dir); if (t.dfade && !this.dfades.has(k)) t.dfade.value.set(p, f.dir); }
    }
    for (const [k, start] of this.dfades) { const t = this.tiles.get(k), p = Math.min(1, (now - start) / FADE_S); if (!t?.dfade) { this.dfades.delete(k); continue; } if (p >= 1) { t.dfade.value.set(1, 0); this.dfades.delete(k); } else t.dfade.value.set(p, 1); }
    // what to show: every frame, each change fading on its own - an area finished a moment after another no longer waits
    // for the other's fade (they ran one at a time, so after a jump the near areas queued behind each other, 2026-10-04).
    // A tile turning round mid-fade carries on from the share of its pixels it shows (from).
    {
      const next = this.displaySet(want);
      const enter = [...next].filter(k => !this.shown.has(k)), leave = [...this.shown].filter(k => !next.has(k));
      if (enter.length || leave.length) {
        for (const k of enter) {
          const t = this.tiles.get(k), was = this.fades.get(k), from = was?.dir < 0 ? 1 - Math.min(1, (was.from || 0) + (now - was.start) / FADE_S) : 0;
          this.group.add(t.mesh); t.shownAt ??= now; t.fade.value.set(from, 1); this.dfades.delete(k); t.dfade?.value.set(from, 1); this.fades.set(k, { dir: 1, start: now, from });
          // what it shares with the tiles it replaces stays as it was: their trees are the same trees (one world grid,
          // terrain.worker.js buildScatter) - faded in again they blinked out and back on each change (2026-10-04)
          // (and from the coarser tile it is shown over, which stays for the rest of its area)
          const over = []; { let L = t.level, tx = t.tx, tz = t.tz; while (L < ROOT_LEVEL) { L++; tx = Math.floor(tx / 2); tz = Math.floor(tz / 2); const a = this.key(L, tx, tz); if (next.has(a) && this.shown.has(a)) { over.push(a); break; } } }
          for (const lk of [...leave, ...over]) {
            const o = this.tiles.get(lk); if (!o?.sc || o.x0 >= t.x0 + t.S || t.x0 >= o.x0 + o.S || o.z0 >= t.z0 + t.S || t.z0 >= o.z0 + o.S) continue;
            for (const [kind, L] of Object.entries(o.sc)) {
              if (!L?.c?.length) continue;
              const b = o.kindBorn?.get(kind)?.born ?? Math.max(o.shownAt ?? 0, o.scBorn ?? 0), e = (t.kindBorn ??= new Map()).get(kind);
              // (lv: the replaced tile's level - its instances are those standing on that level: treeLevel >= lv)
              t.kindBorn.set(kind, { born: e ? Math.min(e.born, b) : b, lv: e ? Math.min(e.lv, o.level) : o.level });
            }
          }
        }
        for (const k of leave) {
          const t = this.tiles.get(k); if (!t) continue;
          const was = this.fades.get(k), from = was?.dir > 0 ? 1 - Math.min(1, (was.from || 0) + (now - was.start) / FADE_S) : 0;
          t.fade.value.set(from, -1); this.dfades.delete(k); t.dfade?.value.set(from, -1); this.fades.set(k, { dir: -1, start: now, from });
        }
        this.shown = next;
        this.fillPools(cam);
        this.evict(next);
      }
    }
    this.updateHoles(now);
    if (this.refill || (this.poolAt && Math.hypot(cam.x - this.poolAt.x, cam.z - this.poolAt.z) > Math.min(25, this.cfg.grassR * 0.3 || 25))) { this.refill = false; this.fillPools(cam); }
    this.stepPools();
    this.uNat.uNatCam.value.copy(cam); this.uNat.uNatNow.value = now;
    this.sea.update(cam, this.weather);
    // the sea floor's depth around the camera, for the waves (rebuilt when the camera has moved a quarter of it)
    const DS = 2048, dc = this.depthAt;   // 2 km across: the surf shows a good way off (2026-10-03)
    if (!this.depthBusy && (!dc || Math.abs(cam.x - dc.x) > DS / 4 || Math.abs(cam.z - dc.z) > DS / 4)) {
      this.depthBusy = true; this.depthAt = { x: cam.x, z: cam.z };
      this.worker.postMessage({ op: 'depth', id: 'depth', x0: cam.x - DS / 2, z0: cam.z - DS / 2, size: DS, n: 257 });
    }
    // and a fine one close round the camera (2 m), where the water's edge runs up the beach (render/water.js)
    const DN = 512, dn = this.depthAtN, wN = this.workers[this.workers.length - 1];
    if (!this.depthBusyN && (!dn || Math.abs(cam.x - dn.x) > DN / 4 || Math.abs(cam.z - dn.z) > DN / 4)) {
      this.depthBusyN = true; this.depthAtN = { x: cam.x, z: cam.z };
      wN.postMessage({ op: 'depth', id: 'depthN', x0: cam.x - DN / 2, z0: cam.z - DN / 2, size: DN, n: 257 });
    }
    this.uSurf.value = Math.min(2, Math.max(0.35, waveHeight(this.weather || {}) / 0.55));
    // ripples drift with the wind; rivers flow
    if (this.rivers) this.rivers.update(Math.min(0.1, (performance.now() - (this._rip || performance.now())) / 1000));
    const W = GU.uWind.value, nowMs = performance.now(), dt = Math.min(0.1, (nowMs - (this._rip || nowMs)) / 1000); this._rip = nowMs;
    this.waterNormal.offset.x = (this.waterNormal.offset.x + W.x * dt * 0.0006 + dt * 0.002) % 1; this.waterNormal.offset.y = (this.waterNormal.offset.y + W.z * dt * 0.0006 + dt * 0.0013) % 1;
    // the countryside stands within reach: tiles beyond it aren't drawn at all, nearer ones grow in (render/countryside.js)
    this.csMat.userData.cs.uCsCam.value.copy(cam); this.csSmallMat.userData.cs.uCsCam.value.copy(cam);
    const rS = this.csR * SMALL_K;
    let tris = 0, csTris = 0;
    for (const k of this.shown) {
      const t = this.tiles.get(k); if (!t) continue;
      tris += t.tris || 0;
      if (t.cs || t.css) {
        const dx = Math.max(t.x0 - cam.x, 0, cam.x - t.x0 - t.S), dz = Math.max(t.z0 - cam.z, 0, cam.z - t.z0 - t.S), d2 = dx * dx + dz * dz;
        if (t.cs) { t.cs.visible = d2 < this.csR * this.csR; if (t.cs.visible) csTris += t.csTris; }
        if (t.css) { t.css.visible = d2 < rS * rS; if (t.css.visible) csTris += t.cssTris; }
      }
    }
    this.stats.countryside = csTris;
    this.stats.tiles = this.shown.size; this.stats.triangles = tris;
  }
  /** Where the camera is heading: its ground speed (m/s), smoothed; a jump (a fly-to, a warp) is not motion. */
  motion(cam, now) {
    const L = this._mv, v = this.vel ??= { x: 0, z: 0 };
    if (L && now > L.t + 1e-3) {
      const dt = now - L.t, vx = (cam.x - L.x) / dt, vz = (cam.z - L.z) / dt, k = Math.min(1, dt * 2);
      if (Math.hypot(vx, vz) > 250) { v.x = v.z = 0; } else { v.x += (vx - v.x) * k; v.z += (vz - v.z) * k; }
    }
    this._mv = { x: cam.x, z: cam.z, t: now };
  }
  /** Built and complete: its ground, and (up to level 2, where farmsteads, crops and scatter stand) what stands on it -
   *  a tile shown before that arrived replaced its parent's trees with bare ground until it did (2026-10-04). */
  isReady(k) { const t = this.tiles.get(k); return !!t && (t.level > 2 || t.detail === 'done' || t.inPlace || t.mesh.visible === false); }
  /** Built but still waiting for what stands on it: shown anyway where what shows there now has nothing standing on it
   *  either (no shown ancestor with trees - after a jump, the island's coarse cover) - waiting there only delayed the
   *  ground (2026-10-04: "closer things should load faster"); it fades in when it arrives. */
  showable(k) {
    if (this.isReady(k)) return true;
    const t = this.tiles.get(k); if (!t) return false;
    let L = t.level, tx = t.tx, tz = t.tz;
    while (L < ROOT_LEVEL) { L++; tx = Math.floor(tx / 2); tz = Math.floor(tz / 2); const a = this.tiles.get(this.key(L, tx, tz)); if (a && this.shown.has(a.key)) return !(a.level <= FAR_TREE_LEVEL && a.sc); }
    return true;
  }
  /** Sends the missing tiles to the workers, one queue, nearest first: where nothing near a wanted tile is built yet, a
   *  tile two levels coarser over it first (a quick stand-in); then what is wanted, its ground before what stands on it;
   *  then the tiles ahead (where the camera is heading, and a margin past the switch distance all round: motion/AHEAD_M);
   *  the coarse tiles covering the whole island always (kept). */
  request(want, cam) {
    const has = k => (this.tiles.has(k) && !this.tiles.get(k).stale) || this.pending.has(k) || this.readyKeys.has(k);
    const jobs = [], seen = new Set(), push = (level, tx, tz, dist, stand = false) => { const key = this.key(level, tx, tz); if (seen.has(key) || has(key)) return; seen.add(key); jobs.push({ level, tx, tz, key, dist, stand }); };
    for (const w of want) {
      if (has(w.key)) continue;
      let L = w.level, tx = w.tx, tz = w.tz, found = false;
      while (L < ROOT_LEVEL && L < w.level + 2) { L++; tx = Math.floor(tx / 2); tz = Math.floor(tz / 2); if (this.tiles.has(this.key(L, tx, tz))) { found = true; break; } }
      if (!found && w.level + 2 <= ROOT_LEVEL) push(w.level + 2, Math.floor(w.tx / 4), Math.floor(w.tz / 4), w.dist, true);
      push(w.level, w.tx, w.tz, w.dist);
    }
    // what stands on the tiles (built, up to level 2): farmsteads; crops and scatter (level 0); far trees (levels 1 to
    // FAR_TREE_LEVEL) - asked for as soon as the ground is in, so the tile is complete when it is shown (isReady)
    const sc = this.cfg.scatterCap > 0;
    const detailFor = list => { for (const w of list) {
      const t = this.tiles.get(w.key);
      if (!t || t.level > 2 || t.mesh.visible === false || t.detail === 'done' || t.detail === 'asked' || this.pending.has('d:' + w.key)) continue;
      jobs.push({ detail: true, t, key: w.key, dist: w.dist + 5, scatter: t.level === 0 && sc, distant: t.level >= 1 && t.level <= FAR_TREE_LEVEL && sc });
    } };
    detailFor(want);
    // ahead: where the camera will be in LOOK_S s, and finer tiles out to MARGIN x their switch distance all round - only
    // while nothing that is wanted now waits for a worker (after a jump it doubled the work in front of the near tiles)
    if (cam && !jobs.length) {
      const ahead = new Map(), wk = new Set(want.map(w => w.key)), v = this.vel || { x: 0, z: 0 }, sp = Math.hypot(v.x, v.z);
      if (sp > 2) { const d = Math.min(LOOK_S * sp, LOOK_MAX), p = { x: cam.x + v.x / sp * d, y: cam.y, z: cam.z + v.z / sp * d }; for (const w of this.wanted(p, 1, false)) if (!wk.has(w.key)) ahead.set(w.key, { ...w, dist: w.dist + d * 0.5 + AHEAD_M }); }
      for (const w of this.wanted(cam, MARGIN)) if (!wk.has(w.key) && !ahead.has(w.key)) ahead.set(w.key, { ...w, dist: w.dist + AHEAD_M });
      for (const w of ahead.values()) push(w.level, w.tx, w.tz, w.dist);
      detailFor(ahead.values());
    }
    // the island's coarse cover (never dropped): anywhere the camera goes, something stands in at once
    const b = this.bounds(), S = CHUNK_M * 2 ** PIN_LEVEL;
    for (let tx = Math.floor(b.x0 / S); tx <= Math.floor(b.x1 / S); tx++) for (let tz = Math.floor(b.z0 / S); tz <= Math.floor(b.z1 / S); tz++) push(PIN_LEVEL, tx, tz, 1e9);
    // one queue, nearest first: a stand-in for a bare spot a little ahead of the real tiles round it (not of everything:
    // after a jump the far stand-ins held up the near tiles)
    const prio = j => (j.stand ? j.dist - 250 : j.dist);
    jobs.sort((a, b) => prio(a) - prio(b));
    const per = 2, free = pref => { if (pref !== undefined && this.busy[pref] < per) return pref; let wi = 0; for (let i = 1; i < this.busy.length; i++) if (this.busy[i] < this.busy[wi]) wi = i; return this.busy[wi] < per ? wi : -1; };
    for (const j of jobs) {
      const wi = free(j.detail ? j.t.wi : undefined); if (wi < 0) return;
      this.busy[wi]++;
      if (j.detail) {
        const t = j.t;
        t.detail = 'asked'; this.pending.set('d:' + j.key, wi);
        this.workers[wi].postMessage({ op: 'detail', id: j.key, epoch: this.epoch, level: t.level, tx: t.tx, tz: t.tz, n: t.level === 0 ? this.cfg.n0 : this.cfg.n, gm: this.cfg.gm || 0, scatter: j.scatter, distant: j.distant });
      } else {
        this.pending.set(j.key, wi);
        this.workers[wi].postMessage({ op: 'tile', id: j.key, epoch: this.epoch, level: j.level, tx: j.tx, tz: j.tz, n: j.level === 0 ? this.cfg.n0 : this.cfg.n, gm: this.cfg.gm || 0 });
        this.stats.builds++;
      }
    }
  }
  /**
   * The coarser tiles under which finer ones are drawn leave those out: each drawn tile's nearest drawn ancestor gets its
   * area in its hole grid (render/fade.js holeable), with the finer tile's fade, so they share each pixel; the
   * ancestor's farmsteads hide meanwhile (the finer tile has them too). Uploaded when a grid changes.
   */
  updateHoles(now) {
    const drawn = new Set(this.shown); for (const [k, f] of this.fades) if (f.dir < 0) drawn.add(k);
    const under = new Map();
    for (const k of drawn) {
      const t = this.tiles.get(k); if (!t) continue;
      let L = t.level, tx = t.tx, tz = t.tz;
      while (L < ROOT_LEVEL) { L++; tx = Math.floor(tx / 2); tz = Math.floor(tz / 2); const a = this.key(L, tx, tz); if (drawn.has(a)) { (under.get(a) || under.set(a, []).get(a)).push(t); break; } }
    }
    for (const k of drawn) {
      const a = this.tiles.get(k); if (!a?.hole) continue;
      const kids = under.get(k), H = a.hole, d = H.next ??= new Uint8Array(H.data.length);
      d.fill(0);
      if (kids) for (const c of kids) {
        const f = this.fades.get(c.key), p = f ? Math.min(1, (f.from || 0) + (now - f.start) / FADE_S) : 1;
        const frac = Math.round(255 * (f ? (f.dir > 0 ? p : 1 - p) : 1)), dir = f && f.dir < 0 ? 0 : 255, cs = a.S / HOLE_N;
        const i0 = Math.max(0, Math.round((c.x0 - a.x0) / cs)), j0 = Math.max(0, Math.round((c.z0 - a.z0) / cs)), i1 = Math.min(HOLE_N, Math.round((c.x0 + c.S - a.x0) / cs)), j1 = Math.min(HOLE_N, Math.round((c.z0 + c.S - a.z0) / cs));
        for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const o = (j * HOLE_N + i) * 2; d[o] = Math.max(d[o], frac); d[o + 1] = dir; }
      }
      const on = !!kids?.length, sig = on ? kids.map(c => c.key).join(',') : '';
      if (sig !== (a.holeSig || '')) { a.holeSig = sig; this.refill = true; }   // (its trees under them go, or come back)
      if (on !== (H.rect.value.w > 0.5) || (on && !d.every((v, i) => v === H.data[i]))) { H.data.set(d); H.tex.value.needsUpdate = true; H.rect.value.w = on ? 1 : 0; }
      a.covered = on ? H.data : null;
      if (a.lm) a.lm.visible = !on;
    }
  }
  /** The tiles to show: every wanted tile that is ready, else its nearest ready ancestor (see update). */
  displaySet(want) {
    const D = new Set(), has = k => this.showable(k);
    for (const w of want) {
      if (has(w.key)) { D.add(w.key); continue; }
      let L = w.level, tx = w.tx, tz = w.tz, a = null;
      while (L < ROOT_LEVEL) { L++; tx = Math.floor(tx / 2); tz = Math.floor(tz / 2); const k = this.key(L, tx, tz); if (has(k)) { a = k; break; } }
      if (a) { D.add(a); continue; }
      // zooming out: the finer tiles shown before still cover it
      for (const k of this.shown) { const t = this.tiles.get(k); if (t && t.level < w.level && Math.floor(t.tx / 2 ** (w.level - t.level)) === w.tx && Math.floor(t.tz / 2 ** (w.level - t.level)) === w.tz) D.add(k); }
    }
    // (a finer tile shown under a coarser one: the coarser one leaves its pixels out - updateHoles)
    return D;
  }
  /** Drop built tiles that haven't been shown for a while (bounded memory). */
  evict(keep) {
    // a generous cache: going back somewhere seen recently is instant (the island's coarse cover is never dropped)
    if (this.tiles.size <= this.cfg.maxTiles * 4) return;
    for (const [k, t] of this.tiles) {
      if (keep.has(k) || this.fades.has(k) || t.level >= PIN_LEVEL) continue;
      this.disposeTile(t);
      this.tiles.delete(k);
      if (this.tiles.size <= this.cfg.maxTiles * 3) break;
    }
  }
  /** A tile's meshes, its own materials and its ground map. */
  disposeTile(t) {
    this.disposeGround(t.mesh); t.hole?.tex.value.dispose();
    for (const c of [t.cs, t.css, t.lm]) c?.geometry.dispose();
    t.csM?.dispose(); t.cssM?.dispose();
  }
  /** A tile's ground: its geometry, and its own material and ground map (not the shared template). */
  disposeGround(mesh) {
    mesh.geometry.dispose();
    const m = mesh.material; if (m && m !== this.mat) { m.userData.gm?.A.dispose(); m.userData.gm?.B.dispose(); m.dispose(); }
  }
  dispose() { for (const w of this.workers) w.terminate(); }
}

/** A tiling normal map of soft waves, generated once. */
function waterNormalTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const h = (x, y) => Math.sin(x * 0.0982 * 2 + Math.sin(y * 0.0491 * 2) * 1.3) * 0.5 + Math.sin(y * 0.1473 + x * 0.049) * 0.35 + Math.sin((x + y) * 0.2945) * 0.15;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1), l = Math.hypot(dx, dy, 2);
    const o = (y * size + x) * 4; data[o] = (dx / l * 0.5 + 0.5) * 255; data[o + 1] = (dy / l * 0.5 + 0.5) * 255; data[o + 2] = (2 / l * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
