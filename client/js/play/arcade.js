// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade cabinets (docs/features/arcade.md). In the world: every cabinet on the floor being looked at shows a
// game's attract screen (its title, its moving pieces, the top three scores), drawn into one small canvas per game and
// stamped on the cabinets' screens (render/furniture.js ARCADE_SCREEN). A click on a cabinet (looking inside) or E at
// one (playing) offers ▶ Play: the camera glides up to the screen until it fills the view, square on (as an agent's PC:
// ui/pc-onscreen.js), and the cabinet's menu is put exactly on the screen — the library, then the game in its sealed
// box (client/arcade/box.html) on the cabinet's glass, then the results and the leaderboard. On a phone (or a narrow
// window) the cabinet fills the screen instead once the camera is there, with the on-screen controller
// (./arcade-pad.js) under it or beside it, and the world stops drawing behind it.
// The arcade's other machines (2026-10-24, the product owner: "every single machine or game that isn't decorative has to
// be a real mini game players can play ... like with the 3D asset you created it becomes its own mini game"): a machine
// with a screen of its own (the racing cabinet) plays its game on that screen, as a cabinet does, straight in (no
// library); the others are played for real on the machine itself in the world (./machine-play.js).
// A run: POST /api/play/start (module 'arcade', the game as its course) gives the seed; the box plays it and reports
// every step's buttons; POST /api/play/finish has the server play the game again and record its own score. Without an
// account that may play (or offline) it is a practice game: played the same, nothing kept.
import * as THREE from 'three';
import { S, bus, holdView, releaseView } from '../core/state.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';
import { CATALOG } from '/shared/catalog.js';
import { GAMES, gameOf, machineGame } from '/shared/arcade/catalog.js';
import { fmtVc } from '/shared/play.js';
import { ARCADE_SCREEN } from '../render/furniture.js';
import { RACING } from '/shared/arcade/machines.js';
import { toQuad } from '../ui/pc-onscreen.js';
import { ArcadeInput } from './arcade-pad.js';
import { inputValue } from '/shared/arcade/core.js';
import { sfx, buzz, unlockSound, engine } from './arcade-sound.js';
import { text as pixelText } from '/arcade/fx.js';

const COVER_W = 240, COVER_H = 320, COVER_FPS = 8, COVER_FPS_PHONE = 4, COVER_PER_FRAME = 2, NEAR = 8, TOP_TTL = 120e3, MARQ_W = 384, MARQ_H = 128;
const _fm = new THREE.Matrix4();
const BUILTIN = GAMES.filter(g => g.kind === 'builtin' && g.cabinet);   // (the cabinets' library; a machine's own game is played at it)
/** Whether a piece of type t is played: a cabinet (its library), a machine with a screen (its game on it), or a machine
 *  played in the world (./machine-play.js). */
export const playable = t => !!(CATALOG[t]?.arcade || machineGame(t));
/** The screens of the machines that play on one (shared/arcade/machines.js), by piece. */
const SCREENS = { racing_sim: RACING.screen };
let app = null, cur = null;
const mods = new Map();
/** A game's screen module (client/arcade/games/<id>.js), loaded once. */
const gameMod = id => { let p = mods.get(id); if (!p) { p = import(`/arcade/games/${id}.js`); mods.set(id, p); } return p; };
const isFull = () => matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const fmt = n => Math.max(0, Math.floor(n || 0)).toLocaleString('en-US');
const hashId = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
/** The game a cabinet shows and offers first: its own choice when it has one, else one of the library by its place. */
export const cabinetGame = e => gameOf(e.it?.g)?.id || BUILTIN[hashId(`${e.b}.${e.f}.${e.id}`) % BUILTIN.length].id;
/** The cabinet's screen as a world matrix: a 1 × 1 plane at the glass (scaled to it), a hair in front of it. A machine
 *  with a screen of its own: that screen. */
function screenMatrix(e, out = new THREE.Matrix4()) {
  const sc = SCREENS[e.t];
  if (sc) return out.makeRotationY(e.yaw).setPosition(e.x, e.y, e.z).multiply(new THREE.Matrix4().makeTranslation(0, sc.cy, sc.z + 0.002)).multiply(new THREE.Matrix4().makeScale(sc.w, sc.h, 1));
  const A = ARCADE_SCREEN, n = A.n;
  return out.makeRotationY(e.yaw).setPosition(e.x, e.y, e.z)
    .multiply(new THREE.Matrix4().makeTranslation(0, A.cy + n[1] * 0.002, A.cz + n[0] * 0.002))
    .multiply(new THREE.Matrix4().makeRotationX(-A.lean))
    .multiply(new THREE.Matrix4().makeScale(A.w, A.h, 1));
}

/** The cabinet's marquee as a world matrix: a plane over its lit face (render/furniture.js: 1.62 – 1.88 m, front 0.21). */
function marqueeMatrix(e, out = new THREE.Matrix4()) {
  return out.makeRotationY(e.yaw).setPosition(e.x, e.y, e.z).multiply(new THREE.Matrix4().makeTranslation(0, 1.75, 0.2155)).multiply(new THREE.Matrix4().makeScale(0.69, 0.235, 1));
}
/** A game's marquee: its title in neon on a dark glass with a sheen. */
function drawMarquee(ctx, w, h, g) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#120a2a'); bg.addColorStop(0.5, '#1c1240'); bg.addColorStop(1, '#0b0820');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const glowL = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.55);
  glowL.addColorStop(0, `${g.color}55`); glowL.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowL; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = g.accent; ctx.fillRect(0, 6, w, 3); ctx.fillRect(0, h - 9, w, 3);
  const title = g.title.toUpperCase(), sc = Math.max(2, Math.min(7, Math.floor((w - 40) / (title.length * 6)), Math.floor((h - 40) / 7)));
  pixelText(ctx, title, w / 2, h / 2 - (7 * sc) / 2, sc, { color: '#ffffff', glow: g.color, align: 'center' });
  ctx.globalAlpha = 0.12; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 12, w, h * 0.22); ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------------------------------- the attract screens
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
class ArcadeScreens {
  constructor() {
    this.group = new THREE.Group(); this.group.name = 'arcade-screens';
    app.stage.scene.add(this.group);
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.games = new Map();   // game id → { cv, ctx, tex, mat, drawn, top, topAt }
    this.meshes = []; this.key = ''; this.list = [];
    this.t0 = performance.now();
  }
  game(id) {
    let g = this.games.get(id);
    if (!g) {
      // (drawn often and copied to the GPU each time: its canvas kept in memory, not on the GPU — a copy from a GPU canvas
      // waits for the GPU, a long frame on a phone — and no mipmaps made again at every copy; the screens are small pixel art)
      const cv = document.createElement('canvas'); cv.width = COVER_W; cv.height = COVER_H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mc = document.createElement('canvas'); mc.width = MARQ_W; mc.height = MARQ_H;
      try { drawMarquee(mc.getContext('2d'), MARQ_W, MARQ_H, gameOf(id)); } catch { /* plain */ }
      const mtex = new THREE.CanvasTexture(mc); mtex.colorSpace = THREE.SRGBColorSpace; mtex.anisotropy = 4;
      const mmat = new THREE.MeshBasicMaterial({ map: mtex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      g = { id, cv, ctx, tex, mat, mmat, drawn: -1, top: [], topAt: 0, mod: null };
      gameMod(id).then(m => { g.mod = m; g.drawn = -1; }).catch(() => {});
      this.games.set(id, g);
    }
    return g;
  }
  /** The focused floor's cabinets: [{ e, game, M }], made again when the floor or its furniture changes. */
  cabinets() {
    const B = S.focus.b >= 0 ? S.world?.buildings?.[S.focus.b] : null;
    const key = `${S.focus.b}:${S.focus.f}:${S.world?.v ?? ''}:${B?.lv?.[S.focus.f] ?? ''}:${app.inter?.foc.entries.length ?? 0}`;
    if (key === this.key) return this.list;
    this.key = key;
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.meshes = []; this.list = [];
    // (the screens and marquees of one game are drawn together: two instanced meshes a game, however many cabinets —
    // an arcade floor has up to 150)
    const byGame = new Map();
    for (const e of app.inter?.foc.entries || []) {
      if (!CATALOG[e.t]?.arcade) continue;
      const id = cabinetGame(e), M = screenMatrix(e);
      let gl = byGame.get(id); if (!gl) byGame.set(id, gl = []);
      const c = { e, game: id, M, mesh: null, i: gl.length, c: new THREE.Vector3().setFromMatrixPosition(M) };
      gl.push(c); this.list.push(c);
    }
    for (const [id, gl] of byGame) {
      const g = this.game(id), scr = new THREE.InstancedMesh(this.geo, g.mat, gl.length), marq = new THREE.InstancedMesh(this.geo, g.mmat, gl.length);
      scr.renderOrder = 2; scr.frustumCulled = marq.frustumCulled = false;
      gl.forEach((c, k) => { scr.setMatrixAt(k, c.M); marq.setMatrixAt(k, marqueeMatrix(c.e)); c.mesh = scr; });
      this.group.add(scr, marq); this.meshes.push(scr, marq);
    }
    return this.list;
  }
  frame() {
    const list = this.cabinets();
    if (!list.length) return;
    const now = performance.now(), t = (now - this.t0) / 1000, camera = app.stage.camera, cam = camera.position;
    const fr = this.frustum ??= new THREE.Frustum(); fr.setFromProjectionMatrix(_fm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const near = new Set();
    for (const c of list) {
      // (the cabinet being played shows the game itself on its glass: its screen is folded away)
      const hide = !!(cur && cur.e === c.e && cur.shown);
      if (c.hidden !== hide) { c.hidden = hide; c.mesh.setMatrixAt(c.i, hide ? ZERO : c.M); c.mesh.instanceMatrix.needsUpdate = true; }
      if (c.c.distanceTo(cam) < NEAR && fr.containsPoint(c.c)) near.add(c.game);   // (near and in view: those worth moving)
    }
    // (a game being played on a machine: the cabinets round it are the background, their screens hold still; on a phone
    // the ones that move, at half the rate: each copy to the GPU is a slow frame there)
    if (app.machinePlay?.active) near.clear();
    const fps = app.pace?.battery ? COVER_FPS_PHONE : COVER_FPS;
    // the screens due, the longest waiting first, at most two a frame: drawn all in one frame, a dozen copies to the GPU
    // came together every eighth of a second and made a long frame on a phone
    const due = [];
    for (const g of this.games.values()) {
      if (!g.mod) continue;
      if (now - g.topAt > TOP_TTL) { g.topAt = now; getJSON(`/api/play/leaderboard?module=arcade&course=${g.id}&limit=3`).then(r => { g.top = r.rows || []; g.drawn = -1; }).catch(() => {}); }
      if (g.drawn < 0 || (near.has(g.id) && now - g.drawn > 1000 / fps)) due.push(g);
    }
    due.sort((a, b) => a.drawn - b.drawn);
    for (const g of due.slice(0, COVER_PER_FRAME)) {
      g.drawn = now;
      try { g.mod.cover(g.ctx, COVER_W, COVER_H, t, { top: g.top }); g.tex.needsUpdate = true; } catch { /* next time */ }
    }
  }
  /** The cabinet or game machine under a ray (world): its entry, or null. */
  pick(ray) {
    let best = null, bd = Infinity;
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    const machines = (app.inter?.foc.entries || []).filter(e => !CATALOG[e.t]?.arcade && machineGame(e.t));
    for (const e of [...this.cabinets().map(c => c.e), ...machines]) {
      const cs = Math.cos(-e.yaw), sn = Math.sin(-e.yaw), def = CATALOG[e.t], r = def.arcade ? [-0.4, -0.4, 0.4, 0.4] : def.rect || [-0.5, -0.5, 0.5, 0.5];
      const ox = ray.origin.x - e.x, oz = ray.origin.z - e.z;
      o.set(ox * cs + oz * sn, ray.origin.y - e.y, -ox * sn + oz * cs);
      d.set(ray.direction.x * cs + ray.direction.z * sn, ray.direction.y, -ray.direction.x * sn + ray.direction.z * cs);
      let t0 = 0, t1 = 500, ok = true;
      for (const [p, v, lo, hi] of [[o.x, d.x, r[0], r[2]], [o.y, d.y, 0, def.arcade ? 1.9 : Math.max(0.6, def.h || 1.2)], [o.z, d.z, r[1], r[3]]]) {
        if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) { ok = false; break; } continue; }
        let a = (lo - p) / v, b = (hi - p) / v; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 < bd) { bd = t0; best = e; }
    }
    return best;
  }
}

// ------------------------------------------------------------------------------------------- the cabinet in use
const html = s => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstElementChild; };

class Session {
  constructor(e, o = {}) {
    this.e = e; this.o = o;
    this.machine = CATALOG[e.t]?.arcade ? null : machineGame(e.t);   // (a machine: its own game, filling the screen)
    this.first = this.machine ? this.machine.id : cabinetGame(e);
    this.state = 'opening'; this.shown = false; this.full = isFull(); this.run = null; this.game = null; this.frame = null; this.ready = false;
    this.sel = Math.max(0, BUILTIN.findIndex(g => g.id === this.first));
    this.bits = -1; this.covers = [];
    this.input = new ArcadeInput({ onPress: n => this.press(n) });
    this.input.onGamepad = () => this.syncPad();
  }
  /** While it is open the cabinet is this player's (POST /api/arcade/hold, as a machine's game: client/js/play/machine-play.js). */
  hold(on) {
    if (!auth.can('play.use') || !Number.isInteger(this.e.b) || !Number.isInteger(this.e.id)) return;
    post('/api/arcade/hold', { b: this.e.b, f: this.e.f ?? 0, id: this.e.id, on }).catch(() => {});
  }
  open() {
    this.hold(true); this.holdT = setInterval(() => { if (cur === this) this.hold(true); }, 30000);
    this.M = screenMatrix(this.e);
    try { document.exitPointerLock?.(); } catch { /* not locked */ }
    this.frameCamera();
    const pos = this.camPos;
    app.agents.hideFn = (i, x, y, z) => (x - pos.x) ** 2 + (z - pos.z) ** 2 < 0.9 * 0.9 && pos.y - y < 2.2 && pos.y - y > -0.5;
    this.root = html(`<div class="arc-root arc-cover${this.full ? ' full' : ''}" role="dialog" aria-label="Arcade cabinet">
      <div class="arc-cab"><div class="arc-marquee"><span>MVW</span> ARCADE</div>
        <div class="arc-screen"><div class="arc-view"></div></div>
        <div class="arc-padhost"></div></div>
      <div class="arc-bar"><span class="arc-keys"></span><button type="button" class="arc-leave" title="Leave the cabinet (Esc)" aria-label="Leave the cabinet">✕<span> Leave</span></button></div>
    </div>`);
    document.body.appendChild(this.root);
    this.screen = this.root.querySelector('.arc-screen');
    this.view = this.root.querySelector('.arc-view');
    this.root.querySelector('.arc-leave').addEventListener('click', () => this.leave());
    this.root.addEventListener('pointerdown', () => unlockSound(), { capture: true, passive: true });
    this.root.addEventListener('wheel', ev => ev.preventDefault(), { passive: false });
    this.input.attach();
    this.onVis = () => { if (document.hidden && this.state === 'playing') this.pause(); };
    document.addEventListener('visibilitychange', this.onVis);
    this.onResize = () => { this.full = isFull(); this.root.classList.toggle('full', this.full); this.syncPad(); this.layoutFull(); if (!this.full && cur === this) this.frameCamera(); };
    addEventListener('resize', this.onResize);
    unlockSound();
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
    if (this.machine) this.startGame(this.machine);   // (a machine's own game, straight in)
    else { this.showLibrary(); this.state = 'library'; }
  }
  /** The camera square to the machine's screen, back far enough for all of it to fit the window (clear of the top bar and
   *  the cabinet's own bar under it). The screen's own size: a cabinet's, or a machine's own screen (the racing seat's is
   *  2.4 times a cabinet's: framed as a cabinet it ran off the window on a desktop, 2026-10-26); again when the window changes. */
  frameCamera() {
    const camera = app.stage.camera, M = this.M, c = new THREE.Vector3().setFromMatrixPosition(M);
    const n = new THREE.Vector3().setFromMatrixColumn(M, 2).normalize();
    const sc = SCREENS[this.e.t] || ARCADE_SCREEN, tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), aspect = innerWidth / Math.max(1, innerHeight);
    const dist = Math.max(0.2, (sc.h / 0.78) / (2 * tan), (sc.w / 0.9) / (2 * tan * aspect));
    this.camPos = c.clone().addScaledVector(n, dist);
    app.cam.pinTo(this.camPos, c);
  }
  /** Every display frame: the screen put on the glass (or laid out full), the buttons sent on, the menu's covers drawn. */
  tick(now) {
    if (cur !== this) return;
    requestAnimationFrame(this.tick);
    const cam = app.cam;
    if (!cam.pinned) { this.root.classList.remove('on'); this.shown = false; this.input.read(now); return; }
    if (!this.shown) { this.shown = true; this.root.classList.add('on'); this.layoutFull(); }
    if (this.full) { if (!app.hold) { app.hold = true; this.held = true; } }
    else this.place();
    const b = this.input.read(now), p = this.game?.pointer && this.input.ptr;
    const v = p ? inputValue(b, p.x, p.y, p.d) : b;   // (a game that reads the pointer: where it is, and whether it aims)
    if (this.state === 'playing' && this.ready && v !== this.bits) { this.bits = v; this.post({ t: 'in', v }); }
    if (this.state === 'library') this.drawCovers(now);
  }
  /** Desktop: the cabinet's screen as the camera sees it, the menu or the game put exactly on it. */
  place() {
    const camera = app.stage.camera, r = app.stage.renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
    const P = [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]].map(([u, w]) => { v.set(u, w, 0).applyMatrix4(this.M).project(camera); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; });
    const W = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), H = Math.hypot(P[2][0] - P[0][0], P[2][1] - P[0][1]);
    const s = this.screen;
    if (s._w !== Math.round(W) || s._h !== Math.round(H)) { s._w = Math.round(W); s._h = Math.round(H); s.style.width = `${s._w}px`; s.style.height = `${s._h}px`; s.style.fontSize = `${Math.max(9, H / 34)}px`; }
    s.style.transform = `matrix3d(${toQuad(W, H, P).join(',')})`;
  }
  /** Phone / narrow window: the screen as big as fits beside or above the pad, 3:4. */
  layoutFull() {
    if (!this.full) { this.screen.style.cssText = ''; this.screen._w = 0; return; }
    const s = this.screen, pad = this.root.querySelector('.arc-padhost'), land = innerWidth > innerHeight;
    const tap = this.game?.controls?.layout === 'tap' && this.root.classList.contains('pad');   // (the screen is the controller: room for a bigger screen)
    const padH = land ? 0 : tap ? 64 : Math.min(260, innerHeight * 0.36), padW = land ? (tap ? 100 : Math.min(220, innerWidth * 0.26) * 2) : 0;
    const availW = innerWidth - padW - 24, availH = innerHeight - padH - (land ? 20 : 110);
    const [aw, ah] = this.game?.aspect || this.machine?.aspect || [3, 4], k = Math.min(availW / aw, availH / ah), W = Math.floor(aw * k), H = Math.floor(ah * k);
    s.style.transform = ''; s.style.width = `${W}px`; s.style.height = `${H}px`; s.style.fontSize = `${Math.max(9, H / 34)}px`;
    pad.style.height = land ? '' : `${padH}px`;
    this.root.classList.toggle('land', land);
  }
  syncPad() {
    const host = this.root?.querySelector('.arc-padhost');
    if (!host) return;
    const want = this.full && matchMedia('(pointer: coarse)').matches && !this.input.gamepad && this.game && (this.state === 'playing' || this.state === 'paused');
    if (want && this.padFor !== this.game.id) { host.innerHTML = ''; this.input.buildPad(host, this.game.controls); this.padFor = this.game.id; }
    if (!want && this.padFor) { host.innerHTML = ''; this.padFor = null; this.input.pad = null; }
    this.root.classList.toggle('pad', !!want);
    const keys = this.root.querySelector('.arc-keys');
    if (keys) keys.textContent = this.state === 'playing' || this.state === 'paused' ? `${this.game?.keysHint || ''} · Esc pause` : this.machine ? 'Z / Enter play again · Esc leave' : '◀ ▶ ▲ ▼ choose · Z / Enter play · Esc leave';
    if (this.full && this.shown) this.layoutFull();
  }
  post(m) { try { this.frame?.contentWindow?.postMessage({ mvwArcade: 1, ...m }, '*'); } catch { /* gone */ } }

  // ---------------------------------------------------------------- menus
  menu(el) {
    this.view.querySelectorAll('.arc-menu').forEach(x => x.remove());
    if (el) { this.view.appendChild(el); this.nav = [...el.querySelectorAll('[data-nav]')]; this.navI = Math.max(0, this.nav.findIndex(x => x.classList.contains('sel'))); this.markNav(); }
    else this.nav = null;
  }
  markNav() { (this.nav || []).forEach((x, i) => x.classList.toggle('sel', i === this.navI)); this.nav?.[this.navI]?.scrollIntoView?.({ block: 'nearest' }); }
  showLibrary() {
    this.endFrame();
    this.state = 'library'; this.game = null; this.syncPad();
    const signed = auth.can('play.use');
    const el = html(`<div class="arc-menu arc-lib">
      <div class="arc-lib-h"><b>MVW <i>ARCADE</i></b><small>${signed ? 'High scores are kept' : 'Practice · sign in to keep your scores'}</small></div>
      <div class="arc-grid">${BUILTIN.map((g, i) => `<button type="button" class="arc-game${i === this.sel ? ' sel' : ''}" data-nav="${g.id}" style="--gc:${g.color}">
        <canvas width="${COVER_W}" height="${COVER_H}"></canvas><b>${esc(g.title)}</b><small data-best="${g.id}">${esc(g.like)}</small></button>`).join('')}</div>
      <div class="arc-lib-f">${BUILTIN.length} games · more coming</div></div>`);
    el.addEventListener('click', ev => { const b = ev.target.closest('[data-nav]'); if (b) { this.navI = this.nav.indexOf(b); this.activate(b.dataset.nav); } });
    this.menu(el);
    this.navI = this.sel; this.markNav();
    this.covers = [...el.querySelectorAll('.arc-game')].map(b => ({ id: b.dataset.nav, ctx: b.querySelector('canvas').getContext('2d'), mod: null, t: 0, drawn: false }));
    for (const c of this.covers) gameMod(c.id).then(m => { c.mod = m; }).catch(() => {});
    if (signed) getJSON('/api/play/profile').then(p => {
      const best = p?.modules?.arcade?.best || {};
      for (const g of BUILTIN) { const x = el.querySelector(`[data-best="${g.id}"]`), b = best[g.id]; if (x && b) x.textContent = `Best ${fmt(b.score)}${b.place ? ` · #${b.place}` : ''}`; }
    }).catch(() => {});
  }
  drawCovers(now) {
    for (const [i, c] of this.covers.entries()) {
      if (!c.mod) continue;
      const live = i === this.navI;
      if (!live && c.drawn) continue;
      if (live && now - c.t < 1000 / 20) continue;
      c.t = now; c.drawn = true;
      try { c.mod.cover(c.ctx, COVER_W, COVER_H, now / 1000, {}); } catch { /* next */ }
    }
  }
  press(n) {
    if (n === 'A' || n === 'START' || n === 'BACK' || n === 'B') unlockSound();
    if (this.state === 'playing') { if (n === 'START' || n === 'BACK') this.pause(); return; }
    if (this.state === 'loading' || this.state === 'opening') { if (n === 'BACK') this.leave(); return; }
    if (!this.nav?.length) return;
    const cols = this.state === 'library' ? 2 : 1, N = this.nav.length;
    let i = this.navI;
    if (n === 'L' || (cols === 1 && n === 'U')) i = Math.max(0, i - 1);
    else if (n === 'R' || (cols === 1 && n === 'D')) i = Math.min(N - 1, i + 1);
    else if (n === 'U') i = Math.max(0, i - cols);
    else if (n === 'D') i = Math.min(N - 1, i + cols);
    else if (n === 'A' || n === 'START') { sfx('start'); this.activate(this.nav[this.navI].dataset.nav); return; }
    else if (n === 'B' || n === 'BACK') { sfx('back'); this.back(); return; }
    if (i !== this.navI) { this.navI = i; this.markNav(); sfx('select'); if (this.state === 'library') this.sel = i; }
  }
  back() {
    if (this.state === 'paused') this.resume();
    else if (this.state === 'results' && !this.machine) this.showLibrary();
    else this.leave();
  }
  activate(what) {
    if (this.state === 'library') { const g = gameOf(what); if (g) this.startGame(g); return; }
    if (what === 'resume') this.resume();
    else if (what === 'again' || what === 'restart') this.startGame(this.game);
    else if (what === 'games') { this.abandon(); this.showLibrary(); }
    else if (what === 'leave') this.leave();
  }

  // ---------------------------------------------------------------- a game
  async startGame(g) {
    this.abandon();
    this.state = 'loading'; this.game = g; this.ready = false; this.bits = -1;
    this.menu(html(`<div class="arc-menu arc-load"><b>${esc(g.title)}</b><small>Loading…</small></div>`));
    this.syncPad();
    let st = null, practice = !auth.can('play.use');
    if (!practice) {
      for (let k = 0; k < 2 && !st; k++) {
        try { st = await post('/api/play/start', { module: 'arcade', course: g.id }); }
        catch (err) { if (err.status === 429 && k === 0) await new Promise(r => setTimeout(r, 1600)); else { practice = true; break; } }
      }
      if (!st) practice = true;
    }
    if (cur !== this || this.game !== g) return;
    this.run = st ? { id: st.run, best: st.best?.score || 0 } : null;
    const seed = st?.data?.seed ?? ((Math.random() * 4294967296) >>> 0);
    this.practice = practice;
    if (!this.frame || this.frameGame !== g.id) {
      this.endFrame();
      const f = document.createElement('iframe');
      f.className = 'arc-box'; f.title = g.title; f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('allow', 'autoplay; gamepad');
      f.setAttribute('tabindex', '-1'); f.setAttribute('aria-hidden', 'true'); f.setAttribute('referrerpolicy', 'no-referrer');
      f.src = `/arcade/box.html#g=${encodeURIComponent(g.id)}`;
      this.view.prepend(f);
      this.frame = f; this.frameGame = g.id;
      const touch = document.createElement('div'); touch.className = 'arc-touch'; this.view.appendChild(touch); this.touchEl = touch;
      if (g.pointer) this.input.bindPointer(touch, g.pointer);
      else if (g.gestures && (matchMedia('(pointer: coarse)').matches || g.gestures.press)) this.input.bindGestures(touch, g.gestures);
      else touch.style.pointerEvents = 'none';
      this.onMsg = ev => this.message(ev);
      addEventListener('message', this.onMsg);
      this.pendingInit = { seed, best: this.run?.best || 0, practice };
    } else {
      this.post({ t: 'init', seed, best: this.run?.best || 0, practice });
      this.ready = true; this.go();
    }
  }
  message(ev) {
    if (!this.frame || ev.source !== this.frame.contentWindow) return;
    const m = ev.data;
    if (!m || m.mvwArcade !== 1) return;
    if (m.t === 'ready') { if (this.pendingInit) { this.post({ t: 'init', ...this.pendingInit }); this.pendingInit = null; } this.ready = true; this.go(); }
    else if (m.t === 'sfx') { for (const [name, p] of (m.l || []).slice(0, 12)) sfx(name, p); }
    else if (m.t === 'buzz') buzz(Number(m.ms) || 0);
    else if (m.t === 'engine') engine(Number(m.v), { rpm: Number(m.rpm), boost: !!m.boost, skid: Number(m.skid) });
    else if (m.t === 'over') this.over(m);
    else if (m.t === 'error') { this.menu(html(`<div class="arc-menu arc-load"><b>Out of order</b><small>${esc(m.msg || 'The game did not start')}</small><button type="button" data-nav="${this.machine ? 'leave' : 'games'}" class="sel">${this.machine ? '✕ Leave' : '☰ Games'}</button></div>`)); this.state = 'results'; }
  }
  go() {
    if (this.state !== 'loading') return;
    this.menu(null); this.state = 'playing'; this.bits = -1; this.syncPad();
    sfx('coin');
  }
  pause() {
    if (this.state !== 'playing') return;
    this.post({ t: 'pause' }); this.state = 'paused'; this.syncPad(); engine(-1);
    this.menu(html(`<div class="arc-menu arc-pause"><b>PAUSED</b>
      <button type="button" data-nav="resume" class="sel">▶ Resume</button><button type="button" data-nav="restart">↺ Restart</button>
      ${this.machine ? '' : '<button type="button" data-nav="games">☰ Games</button>'}<button type="button" data-nav="leave">✕ Leave</button></div>`));
    this.nav.forEach(b => b.addEventListener('click', () => this.activate(b.dataset.nav)));
  }
  resume() { if (this.state !== 'paused') return; this.menu(null); this.post({ t: 'resume' }); this.state = 'playing'; this.bits = -1; this.syncPad(); }
  async over(m) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    const g = this.game, run = this.run;
    this.run = null;
    let res = null;
    const pend = run ? post('/api/play/finish', { run: run.id, report: { log: String(m.log || ''), score: Number(m.score) || 0, ticks: Number(m.ticks) || 0 } }).catch(err => ({ ok: false, why: err.message })) : Promise.resolve(null);
    await new Promise(r => setTimeout(r, 1700));   // (the game's own GAME OVER first)
    res = await pend;
    if (cur !== this || this.game !== g) return;
    let board = [];
    try { board = (await getJSON(`/api/play/leaderboard?module=arcade&course=${g.id}&limit=10`)).rows || []; } catch { /* offline */ }
    if (cur !== this || this.game !== g) return;
    this.state = 'results'; this.syncPad();
    const me = auth.account?.id, score = res?.ok ? res.score : Number(m.score) || 0;
    const stars = res?.ok ? res.stars : 0;
    const tags = [];
    if (res?.ok && res.newBest) tags.push('<span class="new">NEW BEST!</span>');
    if (res?.ok && res.place) tags.push(`<span>#${res.place}</span>`);
    if (res?.ok && res.xp) tags.push(`<span>+${res.xp} XP</span>`);
    if (res?.ok && res.vc?.paid) tags.push(`<span class="vc">+${esc(fmtVc(res.vc.paid))}</span>`);
    const why = this.practice ? 'Practice game: sign in to keep your scores' : res && !res.ok ? `Not recorded: ${res.why || 'the run did not count'}` : '';
    const el = html(`<div class="arc-menu arc-res">
      <b class="arc-res-h">${esc(g.title)}</b>
      <div class="arc-res-score">${fmt(score)}</div>
      ${res?.ok ? `<div class="arc-stars" data-noicon>${[0, 1, 2].map(k => `<span class="${k < stars ? 'on' : ''}" style="animation-delay:${k * 0.2}s">★</span>`).join('')}</div>` : ''}
      ${tags.length ? `<div class="arc-tags">${tags.join('')}</div>` : ''}
      ${why ? `<div class="arc-why">${esc(why)}</div>` : ''}
      ${res?.badges?.length ? `<div class="arc-badges">${res.badges.map(b => `<span title="${esc(b.desc)}">${b.icon} ${esc(b.label)}</span>`).join('')}</div>` : ''}
      <ol class="arc-board">${board.length ? board.map((r, i) => `<li class="${r.id === me ? 'me' : ''}"><i>${i + 1}</i><span>${esc(r.name || 'Player')}</span><b>${fmt(r.score)}</b></li>`).join('') : '<li class="none">No scores yet: be the first</li>'}</ol>
      <div class="arc-btns"><button type="button" data-nav="again" class="sel">▶ Play again</button>${this.machine ? '' : '<button type="button" data-nav="games">☰ Games</button>'}<button type="button" data-nav="leave">✕ Leave</button></div></div>`);
    el.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => this.activate(b.dataset.nav)));
    this.menu(el);
    if (res?.ok && res.newBest) sfx('fanfare');
  }
  abandon() {
    if (this.run) { post('/api/play/abandon', { run: this.run.id }).catch(() => {}); this.run = null; }
  }
  endFrame() {
    engine(-1);
    if (this.onMsg) { removeEventListener('message', this.onMsg); this.onMsg = null; }
    this.frame?.remove(); this.frame = null; this.frameGame = null; this.ready = false;
    this.touchEl?.remove(); this.touchEl = null;
  }
  leave() {
    if (cur !== this) return;
    this.abandon(); this.endFrame();
    clearInterval(this.holdT); this.hold(false);
    cur = null;
    this.input.detach();
    removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVis);
    this.root.remove();
    if (this.held) app.hold = false;
    app.cam.unpin();
    setTimeout(() => { if (!cur) app.agents.hideFn = null; }, 450);
    if (app.arcade) app.arcade.playing = false;
    releaseView('Arcade');
    this.o.onLeave?.();
  }
}

/** Opens cabinet e (an interiors entry): the camera to its screen, its menu on the glass. o: { onLeave() } */
export function playAt(e, o = {}) {
  if (!e) return;
  closePop();
  if (app.machinePlay?.playsInWorld(e.t)) { if (cur) cur.leave(); app.machinePlay.play(e, o); return; }   // (played for real on the machine)
  if (cur) cur.leave();
  cur = new Session(e, o);
  app.arcade.playing = true;
  cur.open();
  holdView('Arcade', 'To leave the cabinet: ✕ at the top (or Esc)');   // (only leaving lets go: core/state.js holdView)
}

// ------------------------------------------------------------------------------------------- ▶ Play on a cabinet (looking inside)
let pop = null;
function closePop() { pop?.remove(); pop = null; }
function offerPlay(e, x, y) {
  closePop();
  const m = CATALOG[e.t]?.arcade ? null : machineGame(e.t), g = m || gameOf(cabinetGame(e));
  pop = html(`<div class="arc-pop panel" style="left:${Math.round(Math.min(innerWidth - 230, Math.max(10, x + 12)))}px;top:${Math.round(Math.min(innerHeight - 120, Math.max(10, y - 20)))}px">
    <div class="arc-pop-h">${m ? esc(m.icon || '🎮') : '🕹️'} <b>${esc(m ? m.title : 'Arcade cabinet')}</b><button type="button" class="arc-pop-x" aria-label="Close">✕</button></div>
    <small>${m ? esc(m.blurb) : `${BUILTIN.length} games · on screen: ${esc(g.title)}`}</small>
    <button type="button" class="btn primary arc-pop-play">▶ Play now</button></div>`);
  document.body.appendChild(pop);
  pop.querySelector('.arc-pop-play').addEventListener('click', () => playAt(e));
  pop.querySelector('.arc-pop-x').addEventListener('click', closePop);
}

export function init(a) {
  app = a;
  const screens = new ArcadeScreens();
  app.arcade = { playAt, playing: false, screens, cabinetGame, playable, get session() { return cur; } };
  bus.on('frame', () => screens.frame());
  bus.on('focus', closePop);
  app.hooks = app.hooks || { key: [], click: [], hover: [] };
  app.hooks.click.push(ev => {
    if (S.mode !== 'explore' || S.focus.b < 0 || cur) { closePop(); return false; }
    const e = screens.pick(app.cam.rayAt(ev.clientX, ev.clientY));
    if (!e) { closePop(); return false; }
    offerPlay(e, ev.clientX, ev.clientY);
    return true;
  });
  app.hooks.hover.push(p => {
    const on = S.mode === 'explore' && S.focus.b >= 0 && !cur && !!screens.pick(app.cam.rayAt(p.x, p.y));
    document.body.classList.toggle('arc-hover', on);
    return on;
  });
}
