// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents' PCs on their screens in the world (docs/features/agent-pc.md §2): for the signed-in person's OWN agents only,
// each agent's PC screen itself on the screen it is at - its desk's monitor, the laptop it types on (a café, a park, at
// home), its home desk: its desktop and the window it has open with what is in it now (the file it writes, typed in as
// it writes it; a picture; a web page; its board, its week, its terminal - ./pc-draw.js), its desktop while it sits
// idle, its lock screen while it is away - and, on the floor where a team works (its lead's desk), the team's board on
// the wall screens. Nothing of a PC reaches another account (server/pc/): every other screen - someone else's desk, an
// empty one, a stranger's laptop - shows a plain PC screen (its wallpaper and the time, ./pc-draw.js drawPlainScreen), so
// a room's screens look alike from any side. Mine in view are live (up to LIVE agents' screens, TVS boards), each keeping
// its canvas while it stays in view, drawn only when what is on it changes (and while it types) - a few a frame, nearest
// first, the far ones at half size. Each step it takes stays up a moment (DWELL), so a burst of commands is seen one
// after another. A click on one uses that PC right there (ui/pc-onscreen.js).
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { getJSON } from '../core/net.js';
import { auth } from '../core/auth.js';
import { SCREENS } from './furniture.js';
import { shapeFor, SHAPE, deskPoint } from './char-props.js';
import { toWorld, bRot } from '/shared/geom.js';
import { floorAt } from '/shared/constants.js';
import { PROP } from '/shared/anims.js';
import { usePc, pcInUse } from '../ui/pc-onscreen.js';
import { watchScreens } from '../ui/pc-watch.js';
import { drawPcScreen, drawPlainScreen, isTyping, TYPE_MS } from './pc-draw.js';

const LIVE = 16, TVS = 2, NEAR = 24, TW = 768, TH = 388;
const DRAWS = 4;               // live canvases drawn again in one frame at most (nearest first; the rest the next frames)
const HALF_AT = 9;             // a live screen farther than this (± 1 m) is drawn at half its size
const IN_VIEW = 0.45;          // a screen is in view when any of it is (a sphere this big round its middle), not just its middle
const PLAIN_MAX = 512, PLAIN_SCAN_MS = 250;   // plain screens at most; strangers' laptops looked for again this often
// (a monitor is 16:9, a laptop's lid 3:2: each drawn at its own shape)
const SIZE = { monitor: [640, 360], laptop: [576, 384] };
const ACTIVE_MS = 15 * 60000;   // what it did last stays on its screen this long while it sits there; then its desktop
const DWELL = 1200, QUEUE = 8;  // each step on screen at least this long; at most this many waiting
const ASSETS = 16, LIVE_FRAME_MS = 1000, MISSED_MS = 30000;   // (a real browser's live picture on a screen: read again each second)
const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Matrix4(), _root = [0, 0, 0];
const _sph = new THREE.Sphere(new THREE.Vector3(), IN_VIEW);
const ray = new THREE.Raycaster();

// the laptop a character types on, in the frame of its 'desk' point (render/char-props.js laptop(): hinged at the table's
// far edge, the lid leaning back 0.26, its picture 0.304 × 0.202 facing the person) - drawn over by a quad facing +z
const TABLE = -0.004;
const LAP_IN_DESK = new THREE.Matrix4().makeTranslation(0, TABLE, 0.075).multiply(new THREE.Matrix4().makeRotationX(0.26))
  .multiply(new THREE.Matrix4().makeTranslation(0, 0.113, -0.0012)).multiply(new THREE.Matrix4().makeRotationY(Math.PI)).multiply(new THREE.Matrix4().makeScale(0.304, 0.202, 1));

export class PcScreens {
  constructor(app) {
    this.app = app;
    this.mine = new Map();        // agent id → { id, name, emoji, i, desk, screen }
    this.teams = [];
    this.boards = new Map();      // team id → its board (for the wall screens)
    this.items = null;            // the focused floor's items with screens: [{ t, M, x, z, b, f }]
    this.itemsKey = '';
    this.group = new THREE.Group();
    this.group.name = 'pc-screens';
    app.stage.scene.add(this.group);
    this.pool = [...Array(LIVE)].map(() => this.makeLive(...SIZE.monitor)).concat([...Array(TVS)].map(() => this.makeLive(TW, TH, true)));
    this.slots = new Map();       // agent id → its live canvas (pool index), kept while it stays in view
    this.plain = { monitor: this.makePlain('monitor'), laptop: this.makePlain('laptop'), clock: '', scanAt: 0, laps: [] };
    this.t = 0; this.pickT = 0;
    this.assets = new Map();      // a picture's address → { img, at, loading } (pictures, a browser's screen)
    this.assetV = 0;              // (counts pictures arriving: a screen showing one is drawn again)
  }
  /** A canvas of the shape a screen has (a laptop's lid is squarer; half the size far away): made anew when it changes. */
  shape(L, kind, half = false) {
    const [w, h] = SIZE[kind === 'laptop' ? 'laptop' : 'monitor'].map(v => (half ? v / 2 : v));
    if (L.cv.width === w && L.cv.height === h) return;
    L.cv.width = w; L.cv.height = h;
    L.tex.dispose();
    L.tex = new THREE.CanvasTexture(L.cv); L.tex.colorSpace = THREE.SRGBColorSpace; L.tex.anisotropy = 4;
    L.mesh.material.map = L.tex; L.mesh.material.needsUpdate = true;
    L.sig = '';
  }
  makeLive(w, h, tv = false) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.matrixAutoUpdate = false; mesh.visible = false; mesh.renderOrder = 2; mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, cv, ctx: cv.getContext('2d'), tex, tv, key: null, sig: '', drawn: 0, owner: null, half: false };
  }
  /** The plain screens of one shape: one picture, put on every such screen that isn't live (one draw for them all). */
  makePlain(kind) {
    const [w, h] = SIZE[kind].map(v => v / 2);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, PLAIN_MAX);
    mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.name = `pc-plain-${kind}`;
    this.group.add(mesh);
    return { mesh, cv, ctx: cv.getContext('2d'), tex, kind };
  }

  // ---------------------------------------------------------------- what is mine
  async load() {
    if (!auth.can?.('agents.pc') || !auth.me?.account) { this.mine.clear(); this.teams = []; return; }
    try {
      const o = await getJSON('/api/pc');
      const was = this.mine;
      this.mine = new Map(o.agents.filter(a => a.body).map(a => {
        const old = was.get(a.id);
        // (what it shows is kept across a reload: the step on screen, the ones waiting)
        return [a.id, { ...a, i: a.body.i, desk: a.body.desk, cur: old?.cur || a.screen || null, since: old?.since ?? 0, queue: old?.queue || [] }];
      }));
      this.teams = o.teams;
      for (const t of this.teams) this.loadBoard(t);
    } catch { /* signed out, or not yet */ }
  }
  async loadBoard(t) {
    try { const b = await getJSON(`/api/pc/board?space=${t.space}`); this.boards.set(t.id, b); this.dirtyTv = true; } catch { /* next time */ }
  }
  onFrame(f) {
    if (f.kind === 'screen' && f.screen) {
      const a = this.mine.get(f.screen.agent);
      if (a) { const q = (a.queue ||= []); q.push(f.screen); if (q.length > QUEUE) q.splice(0, q.length - QUEUE); }
    }
    if (f.kind === 'board') { const t = this.teams.find(x => x.space === f.space); if (t) { clearTimeout(this.bt); this.bt = setTimeout(() => this.loadBoard(t), 500); } }
    if (f.kind === 'teams') { clearTimeout(this.lt); this.lt = setTimeout(() => this.load(), 500); }
  }

  // ---------------------------------------------------------------- where the screens are
  /** The focused floor's items that have screens, with their world matrices (made again when the focus or world changes). */
  floorItems() {
    const b = S.focus.b, f = S.focus.f, B = b >= 0 ? S.world?.buildings?.[b] : null;
    const key = `${b}:${f}:${S.world?.v ?? ''}:${B?.lv?.[f] ?? ''}`;
    if (key === this.itemsKey) return this.items;
    this.itemsKey = key; this.items = [];
    const lv = B && !B.gone ? S.world.levels?.[B.lv?.[f]] : null;
    if (!lv) return this.items;
    const y = B.type === 'park' ? floorAt(B, 0) : floorAt(B, f);
    for (const it of lv.items || []) {
      const sc = SCREENS[it.t];
      if (!sc) continue;
      const w = toWorld(B, it.x, it.z), M = new THREE.Matrix4().makeRotationY(bRot(B) + (it.r || 0)).setPosition(w.x, y, w.z);
      // (each of its screens; plain: none is anyone's PC - a meeting table's laptops)
      sc.quads.forEach((Q, k) => this.items.push({ t: it.t, id: it.id, kind: sc.kind, M: M.clone().multiply(Q), x: w.x, z: w.z, b, f, ...(k || sc.plain ? { plain: true } : {}) }));
    }
    return this.items;
  }
  /** The screen agent `a` is at now (or its desk's, while it is away): { M, kind, i, b, f } or null. */
  quadOf(a) {
    const ag = this.app.agents, i = a.i;
    if (!ag || !Number.isInteger(i) || i >= ag.n) return null;
    const drawn = ag.last[i] === ag.frame && ag.vis[i];
    if (drawn) {
      const p = this.app.net.plans[i], k = ag.k[i];
      const prop = p && p.prop ? p.prop[k] : 0;
      const sh = prop ? shapeFor(ag.clip[i], prop) : 0;
      if (sh === SHAPE.laptop || sh === SHAPE['laptop+coffee']) { const M = this.laptopMatrix(i); if (M) return { M, kind: 'laptop', i, b: S.focus.b, f: S.focus.f, live: true, lap: true }; }
      // seated at something with a screen on the floor looked into: that one (its desk, a home desk)
      for (const e of this.floorItems()) {
        if (e.kind === 'tv' || e.plain) continue;
        const dx = e.x - ag.rx[i], dz = e.z - ag.rz[i];
        if (dx * dx + dz * dz < 1.3 * 1.3) return { M: e.M, kind: e.kind, i, b: e.b, f: e.f, live: true };
      }
    }
    // away from it: its own desk at work still shows its PC (asleep), when that floor is looked into
    if (a.desk && S.focus.b === a.desk.b && S.focus.f === a.desk.f) {
      const e = this.floorItems().find(x => x.id === a.desk.id && x.kind !== 'tv' && !x.plain);
      if (e) return { M: e.M, kind: e.kind, i, b: e.b, f: e.f, live: false };
    }
    return null;
  }
  /** The world matrix of the laptop on the table in front of resident i (char-props.js deskPoint: its model's desk point
   *  for its height and build, on the top of the table there (Characters.deskRoot), turned by its heading - the same as
   *  the characters place it). */
  laptopMatrix(i) {
    const ag = this.app.agents, ch = ag.chars, kind = ch.kindOf?.[i], desk = ch.props?.desks?.[kind];
    if (!desk || !ch.appData) return null;
    const base = (i >> 7) * 4096 + (i & 127) * 32;
    // (bytes, read by the shader as 0 … 1: its height in slot 0's alpha, its build in slot 6's - shared/appearance.js packAppearance)
    const H = 0.8 + ((ch.appData[base + 3] || 0) / 255) * 0.4, Bd = 0.8 + ((ch.appData[base + 27] || 0) / 255) * 0.45;
    const r = ch.deskRoot ? ch.deskRoot(kind, i, ag.rx[i], ag.ry[i], ag.rz[i], ag.yaw[i], _root) : [ag.rx[i], ag.ry[i], ag.rz[i]];
    _m.makeRotationY(ag.yaw[i]).setPosition(r[0], r[1], r[2]);
    _q.makeTranslation(...deskPoint(desk, H, Bd));
    return new THREE.Matrix4().multiplyMatrices(_m, _q).multiply(LAP_IN_DESK);
  }
  /** Each team's office: the floor its lead works on (else its first member with a desk) - its wall screens show its board. */
  officeOf(t) {
    const ms = [...t.members].sort((x, y) => (x.role === 'lead' ? 0 : 1) - (y.role === 'lead' ? 0 : 1));
    for (const m of ms) { const a = this.mine.get(m.agent); if (a?.desk) return { b: a.desk.b, f: a.desk.f }; }
    return null;
  }

  // ---------------------------------------------------------------- each frame
  update(now) {
    const cam = this.app.stage.camera, cp = cam.position;
    const fr = this.frustum ??= new THREE.Frustum();
    fr.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), blink = Math.floor(now * 1.8) & 1, t = Date.now();
    const covered = new Set(), coveredAt = new Set();   // the desk screens and the residents' laptops a live screen is on
    if (this.mine.size) this.updateLive(fr, cp, clock, blink, t, covered, coveredAt);
    else if (this.slots.size) { this.slots.clear(); for (let k = 0; k < LIVE; k++) { this.pool[k].mesh.visible = false; this.pool[k].mesh.userData = {}; } }
    if (!this.mine.size && this.watching) { this.watching = ''; watchScreens('world', []); }
    this.updateTvs(fr, cp, clock);
    this.updatePlain(clock, t, cp, covered, coveredAt);
  }
  /** My agents' screens in view, nearest first: each keeps its canvas while it stays in view (nothing is drawn again for
   *  moving the camera), drawn again when what it shows changes - a few a frame. */
  updateLive(fr, cp, clock, blink, t, covered, coveredAt) {
    const cand = [];
    for (const a of this.mine.values()) {
      const q = this.quadOf(a);
      if (!q) continue;
      _c.setFromMatrixPosition(q.M);
      const d = _c.distanceTo(cp);
      if (d > NEAR) continue;
      _sph.center.copy(_c);
      if (!fr.intersectsSphere(_sph)) continue;
      cand.push({ a, q, d });
    }
    cand.sort((x, y) => x.d - y.d);
    const keep = cand.slice(0, LIVE), want = new Set(keep.map(c => c.a.id));
    // (an Agent Providers' agent's screen live here: its work elsewhere is followed onto it meanwhile - ui/pc-watch.js)
    const prov = keep.filter(c => c.a.own).map(c => c.a.id).sort((x, y) => x - y).join(',');
    if (prov !== this.watching) { this.watching = prov; watchScreens('world', prov ? prov.split(',') : []); }
    for (const [id, k] of this.slots) if (!want.has(id)) { this.slots.delete(id); const L = this.pool[k]; L.mesh.visible = false; L.mesh.userData = {}; L.owner = null; L.sig = ''; }
    const used = new Set(this.slots.values());
    let free = 0;
    for (const c of keep) if (!this.slots.has(c.a.id)) { while (used.has(free)) free++; this.slots.set(c.a.id, free); used.add(free); }
    for (const a of this.mine.values()) this.advance(a, t);
    let draws = 0;
    for (const c of keep) {
      const L = this.pool[this.slots.get(c.a.id)];
      const half = L.half ? c.d > HALF_AT - 1 : c.d > HALF_AT + 1;
      L.half = half;
      this.shape(L, c.q.kind, half);
      L.mesh.matrix.copy(c.q.M); L.mesh.matrixWorldNeedsUpdate = true;
      L.mesh.userData = { agent: c.a.id, quad: c.q };
      const st = c.a.cur ?? c.a.screen ?? null, state = !c.q.live ? 'away' : st && t - st.at < ACTIVE_MS ? 'active' : 'idle';
      // (drawn again when what it shows changes, the minute turns, a picture arrives - and every frame while it types)
      // (a real browser on it - built-in or its provider's - is live: its picture is read again as it is drawn again)
      const moving = state === 'active' && (isTyping(st, c.a.since, t) || (st.view?.kind === 'chat' && !st.view.done) || st.view?.kind === 'terminal'
        || (st.view?.kind === 'page' && (st.view.live || st.view.provider)));
      const sig = `${c.a.id}|${st?.at || 0}|${c.a.since}|${state}|${clock}|${c.q.kind}|${half}|${this.assetV}|${moving ? `${blink}|${isTyping(st, c.a.since, t) ? Math.floor(t / 50) : Math.floor(t / 400)}` : ''}`;
      // (one newly in view is drawn at once - never shown with what its canvas had before; the others take turns)
      if (sig !== L.sig && (L.owner !== c.a.id || draws < DRAWS)) {
        L.sig = sig; draws++;
        drawPcScreen(L.ctx, { W: L.cv.width, H: L.cv.height, agent: c.a, st, state, clock, kind: c.q.kind, now: t, since: c.a.since, blink, image: url => this.image(url) });
        L.tex.needsUpdate = true; L.owner = c.a.id;
      }
      L.mesh.visible = L.owner === c.a.id;
      if (L.mesh.visible) { if (c.q.lap) coveredAt.add(c.q.i); else covered.add(c.q.M); }
    }
  }
  /** A team's board on its office's wall screens. */
  updateTvs(fr, cp, clock) {
    const tvs = [];
    for (const t of this.teams) {
      const o = this.officeOf(t);
      if (!o || S.focus.b !== o.b || S.focus.f !== o.f) continue;
      for (const e of this.floorItems()) if (e.kind === 'tv') { _c.setFromMatrixPosition(e.M); _sph.center.copy(_c); if (_c.distanceTo(cp) < NEAR * 1.5 && fr.intersectsSphere(_sph)) tvs.push({ t, e, d: _c.distanceTo(cp) }); }
    }
    tvs.sort((x, y) => x.d - y.d);
    let k = 0;
    for (const v of tvs.slice(0, TVS)) {
      const L = this.pool[LIVE + k++];
      L.mesh.matrix.copy(v.e.M); L.mesh.matrixWorldNeedsUpdate = true; L.mesh.visible = true; L.mesh.userData = { team: v.t.id };
      const sig = `${v.t.id}|${clock}|${this.boards.get(v.t.id)?.cards?.length ?? -1}|${this.dirtyTv ? Math.random() : ''}`;
      if (sig !== L.sig) { L.sig = sig; drawBoard(L.ctx, TW, TH, v.t, this.boards.get(v.t.id), clock); L.tex.needsUpdate = true; }
    }
    this.dirtyTv = false;
    for (; k < TVS; k++) this.pool[LIVE + k].mesh.visible = false;
  }
  /**
   * Every other screen - the desks of the floor looked into that no live screen is on (someone else's, an empty one, one
   * of mine beyond the live ones) and the laptops strangers type on near the camera: the plain screen, one picture for
   * each shape (drawn again when the minute turns), one draw for them all.
   */
  updatePlain(clock, t, cp, covered, coveredAt) {
    const P = this.plain;
    if (P.clock !== clock) {
      P.clock = clock;
      for (const x of [P.monitor, P.laptop]) { drawPlainScreen(x.ctx, { W: x.cv.width, H: x.cv.height, clock }); x.tex.needsUpdate = true; }
    }
    // (strangers typing on laptops near the camera: looked for a few times a second; their laptops placed every frame)
    if (t - P.scanAt > PLAIN_SCAN_MS) { P.scanAt = t; P.laps = this.typingNear(cp); }
    const n = { monitor: 0, laptop: 0 };
    const put = (kind, M) => { const x = P[kind]; if (n[kind] < PLAIN_MAX) x.mesh.setMatrixAt(n[kind]++, M); };
    for (const e of this.floorItems()) if (e.kind !== 'tv' && !covered.has(e.M)) put(e.kind === 'laptop' ? 'laptop' : 'monitor', e.M);
    for (const i of P.laps) { if (coveredAt.has(i) || !this.typing(i)) continue; const M = this.laptopMatrix(i); if (M) put('laptop', M); }
    for (const k of ['monitor', 'laptop']) { const m = P[k].mesh; m.count = n[k]; m.instanceMatrix.needsUpdate = true; }
  }
  /** Whether resident i is drawn now typing on a laptop on the table in front of it. */
  typing(i) {
    const ag = this.app.agents;
    if (!ag || i >= ag.n || ag.last[i] !== ag.frame || !ag.vis[i]) return false;
    const p = this.app.net.plans[i], k = ag.k[i], prop = p && p.prop ? p.prop[k] : 0;
    const sh = prop ? shapeFor(ag.clip[i], prop) : 0;
    return sh === SHAPE.laptop || sh === SHAPE['laptop+coffee'];
  }
  /** The residents typing on a laptop within reach of the camera. */
  typingNear(cp) {
    const ag = this.app.agents, out = [];
    if (!ag || !this.app.net?.plans) return out;
    const N2 = NEAR * NEAR;
    for (let i = 0; i < ag.n; i++) {
      if (ag.last[i] !== ag.frame || !ag.vis[i]) continue;
      const dx = ag.rx[i] - cp.x, dz = ag.rz[i] - cp.z;
      if (dx * dx + dz * dz > N2) continue;
      if (this.typing(i)) out.push(i);
      if (out.length >= PLAIN_MAX) break;
    }
    return out;
  }
  /** The next step an agent took comes on its screen once the one shown has been up DWELL (and its typing is done). */
  advance(a, t) {
    if (!a.queue?.length) return;
    const busy = a.cur && a.since && t - a.since < (isTyping(a.cur, a.since, a.since) ? TYPE_MS + 500 : DWELL);
    if (busy) return;
    a.cur = a.queue.shift(); a.since = t;
  }
  /** A picture for a screen: its address (its file, a browser service's screen), or provider-browser:<agent> - the
   *  picture its provider's browser shows now, provider-screen:<agent> - its own screen's (Hermes' Bot Desktop), or
   *  pc-browser:<agent> - its built-in real browser's (each read again every second while it is on a screen). null while
   *  it loads. */
  image(url) {
    const e = this.assets.get(url), t = Date.now();
    const stale = e && /^(provider-browser|provider-screen|pc-browser):/.test(url) && t - e.at > LIVE_FRAME_MS;
    if (e && (e.img || e.loading) && !stale) return e.img;
    // (one that couldn't be had - a picture its provider won't show from where it is: not asked again for a while)
    if (e && !e.img && e.missed && t - e.at < MISSED_MS) return null;
    if (e?.loading) return e.img;
    const entry = e || { img: null, at: 0, loading: false };
    entry.loading = true; entry.at = t;
    this.assets.set(url, entry);
    (async () => {
      try {
        let blob = null;
        const m = /^provider-browser:(\d+)$/.exec(url), pcb = /^pc-browser:(\d+)$/.exec(url), scr = /^provider-screen:(\d+)$/.exec(url);
        if (scr) {
          // (its own screen now: one picture of it - none while it is off, or while a person has control)
          const r = await fetch(`/api/providers/screen/thumb?agent=${scr[1]}`, { credentials: 'same-origin', cache: 'no-store' });
          if (r.status === 200) blob = await r.blob();
        } else if (pcb) {
          // (its built-in browser's newest picture - asking keeps its live picture running while it is on a screen)
          const r = await fetch(`/api/pc/browser/frame?agent=${pcb[1]}&after=0&wait=0`, { credentials: 'same-origin', cache: 'no-store' });
          if (r.status === 200) blob = await r.blob();
        } else if (m) {
          const st = await getJSON(`/api/providers/browser?agent=${m[1]}`);
          const tab = (st.tabs || []).find(x => x.active) || (st.tabs || [])[0];
          if (tab) { const r = await fetch(`/api/providers/browser/frame?agent=${m[1]}&tab=${encodeURIComponent(tab.id)}&after=0`, { credentials: 'same-origin', cache: 'no-store' }); if (r.status === 200) blob = await r.blob(); }
        } else {
          const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
          if (r.status === 200 && /^image\//.test(r.headers.get('content-type') || '')) blob = await r.blob();
        }
        if (blob) { const img = await createImageBitmap(blob); entry.img?.close?.(); entry.img = img; this.assetV++; }
        entry.missed = !blob;
      } catch { entry.missed = true; /* not this time: the screen shows it without */ }
      entry.loading = false; entry.at = Date.now();
      // (the oldest pictures go: a few screens show a handful at most)
      while (this.assets.size > ASSETS) { const [k, v] = this.assets.entries().next().value; v.img?.close?.(); this.assets.delete(k); }
    })();
    return entry.img;
  }
  /** The live screen under the pointer: { agent, quad } or { team } or null. */
  pick(x, y) {
    const vis = this.pool.filter(L => L.mesh.visible);
    if (!vis.length) return null;
    const r = this.app.stage.renderer.domElement.getBoundingClientRect();
    ray.setFromCamera({ x: ((x - r.left) / r.width) * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 }, this.app.stage.camera);
    for (const L of vis) L.mesh.updateMatrixWorld(true);
    const hit = ray.intersectObjects(vis.map(L => L.mesh), false)[0];
    return hit ? hit.object.userData : null;
  }
}

// ------------------------------------------------------------------------------------------- drawing
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function wrap(c, text, x, y, maxW, lineH, maxLines) {
  const words = String(text || '').split(/\s+/);
  let line = '', n = 0;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y + n * lineH); line = w; if (++n >= maxLines) return; } else line = t;
  }
  if (line && n < maxLines) c.fillText(line, x, y + n * lineH);
}
/** A team's board on its office's wall screen: its four columns, how many in each, the first few. */
function drawBoard(c, W, H, t, b, clock) {
  c.fillStyle = '#0d1222'; c.fillRect(0, 0, W, H);
  c.fillStyle = t.color || '#6366f1'; c.fillRect(0, 0, W, 6);
  c.fillStyle = '#f1f5ff'; c.font = '700 26px system-ui, sans-serif'; c.fillText(t.name, 22, 42);
  c.fillStyle = 'rgba(226,232,245,.7)'; c.font = '16px system-ui, sans-serif'; c.textAlign = 'right'; c.fillText(clock, W - 22, 40); c.textAlign = 'left';
  const cols = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'Review'], ['done', 'Done']], cw = (W - 44 - 30) / 4;
  cols.forEach(([id, name], k) => {
    const x = 22 + k * (cw + 10), ks = (b?.cards || []).filter(x => x.col === id);
    rr(c, x, 62, cw, H - 80, 10); c.fillStyle = '#161d33'; c.fill();
    c.fillStyle = 'rgba(203,213,240,.85)'; c.font = '700 14px system-ui, sans-serif'; c.fillText(`${name.toUpperCase()}  ${ks.length || ''}`, x + 12, 86);
    (id === 'done' ? ks.slice(-4) : ks.slice(0, 4)).forEach((card, j) => {
      const y = 100 + j * 64;
      rr(c, x + 8, y, cw - 16, 56, 8); c.fillStyle = '#222b47'; c.fill();
      c.fillStyle = '#eef2ff'; c.font = '600 14px system-ui, sans-serif'; wrap(c, card.title, x + 18, y + 22, cw - 36, 17, 2);
      if (card.work?.state === 'working') { c.fillStyle = '#22c55e'; c.beginPath(); c.arc(x + cw - 20, y + 12, 4, 0, 7); c.fill(); }
    });
  });
}

export async function init(app) {
  const ps = app.pcScreens = new PcScreens(app);
  await ps.load();
  bus.on('auth', () => ps.load());
  bus.on('msg:pc', f => ps.onFrame(f));
  bus.on('world', () => { ps.itemsKey = ''; });   // (furniture moved, a floor rebuilt: the screens are found again)
  bus.on('agents', () => ps.load());
  setInterval(() => ps.load(), 60000);
  bus.on('frame', (dt, now) => { try { ps.update(now / 1000); } catch (e) { if (!ps.warned) { ps.warned = true; console.warn('[pc] screens', e); } } });
  // a click on one of my agents' live screens: use its PC right there
  (app.hooks ||= { key: [], click: [], hover: [] }).click.unshift(e => {
    if (pcInUse()) return false;
    const hit = ps.pick(e.clientX, e.clientY);
    if (!hit?.agent) return false;
    usePc(app, hit.agent, hit.quad);
    return true;
  });
  bus.on('pc:use', async id => {
    try { const m = await import('../ui/agent-studio.js'); m.close?.(); } catch { /* no Studio open */ }
    usePc(app, id);
  });
}
