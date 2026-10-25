// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's machines played for real, in the world (docs/features/arcade.md "The machines"; 2026-10-24, the product
// owner: "No I meant like actually playing not a second gaming version. Like with the 3D asset you created it becomes its
// own mini game"). Play at a machine (a click looking inside, E beside it as a player) and the camera comes down to where
// its player's eyes are; the game is played on the machine itself: the balls roll up its own lane and drop into its own
// cups, the moles come up out of its own holes, the ball goes through its own hoop. Its score lights its own LED panel.
// Over it only what a machine can't show: the power meter, a few words, pause and leave.
// The rules are the game's sim (shared/arcade/games/<id>.js, its measurements the machine's: shared/arcade/machines.js),
// stepped here 60 times a second with the buttons held (keyboard, controller, the pointer: ./arcade-pad.js); every step's
// buttons go to the server, which plays the game again and records its own score (the play module 'arcade', as the
// cabinets'). Each game's part in the world is client/js/play/machines/<id>.js: create({ THREE, group, play }) →
// { camera: { pos, at, fov, fit, narrow? }, cameraNow?(s, dt) → { pos, at } (a camera moving with the game: the rider on the
// bull; narrow: { pos, at, fov, fit, noBoard } for a screen held upright),
// board: { w, h, x0, x1, y0, y1, z | cx, cz, ry } (its LED panel, item frame; turned ry about its middle), update(s, dt), event(ev), sfx(ev), buzz(ev),
// part(part, M, s), pointer(ptr, camera) → { px, py } | null, hud(s) → { info, meter, hint, balance? }, paint?(ctx, w, h, s) (draws
// the LED panel itself, every frame, instead of its lines), reset(), dispose() }.
import * as THREE from 'three';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';
import { CATALOG } from '/shared/catalog.js';
import { machineGame } from '/shared/arcade/catalog.js';
import { SIMS } from '/shared/arcade/sims.js';
import { InputLog, inputValue, inputBits, TICK_HZ } from '/shared/arcade/core.js';
import { fmtVc } from '/shared/play.js';
import { ArcadeInput } from './arcade-pad.js';
import { sfx, buzz, unlockSound } from './arcade-sound.js';
import { text as pixelText } from '/arcade/fx.js';

const VIEWS = {
  'mole-mayhem': () => import('./machines/mole-mayhem.js'),
  'skee-roll': () => import('./machines/skee-roll.js'),
  'hoop-fever': () => import('./machines/hoop-fever.js'),
  'power-punch': () => import('./machines/power-punch.js'),
  'claw-catch': () => import('./machines/claw-catch.js'),
  'bull-rider': () => import('./machines/bull-rider.js'),
  'puck-rush': () => import('./machines/puck-rush.js'),
  'foos-frenzy': () => import('./machines/foos-frenzy.js'),
  'star-pinball': () => import('./machines/star-pinball.js'),
  'pool-shark': () => import('./machines/pool-shark.js'),
  'strike-lane': () => import('./machines/strike-lane.js'),
  'neon-steps': () => import('./machines/neon-steps.js'),
};
/** Whether a piece of type t is a machine played for real in the world. */
export const playsInWorld = t => !CATALOG[t]?.arcade && !!VIEWS[machineGame(t)?.id];
const DT = 1 / TICK_HZ;
const fmt = n => Math.max(0, Math.floor(n || 0)).toLocaleString('en-US');
const html = s => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstElementChild; };
let app = null, cur = null;

/** Little sparks in the world (item frame): burst(at, colors, n). */
class Sparks {
  constructor(group, n = 160) {
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    group.add(this.mesh); this.p = []; this.n = n; this.m = new THREE.Matrix4(); this.c = new THREE.Color();
  }
  burst(at, colors, k = 16, speed = 1.2, up = 0.8) {
    for (let i = 0; i < k && this.p.length < this.n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      this.p.push({ x: at[0], y: at[1], z: at[2], vx: Math.cos(a) * v, vy: up * (0.4 + Math.random()), vz: Math.sin(a) * v, t: 0, life: 0.5 + Math.random() * 0.4, c: colors[i % colors.length] });
    }
  }
  update(dt) {
    let k = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const q = this.p[i]; q.t += dt;
      if (q.t >= q.life) { this.p[i] = this.p[this.p.length - 1]; this.p.pop(); continue; }
      q.vy -= 3.5 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
    for (const q of this.p) {
      const s = 1 - q.t / q.life;
      this.m.makeScale(s, s, s).setPosition(q.x, q.y, q.z); this.mesh.setMatrixAt(k, this.m);
      this.mesh.setColorAt(k, this.c.set(q.c)); k++;
    }
    this.mesh.count = k; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

class Play {
  constructor(e, g, o = {}) {
    this.e = e; this.g = g; this.o = o; this.sim = SIMS[g.id];
    this.state = 'opening'; this.s = null; this.run = null; this.practice = true; this.paused = false;
    this.M = new THREE.Matrix4().makeRotationY(e.yaw).setPosition(e.x, e.y, e.z);
    this.input = new ArcadeInput({ onPress: n => this.press(n) });
    this.floats = []; this.boardKey = '';
  }
  /** A point of the machine's own frame (shared/arcade/machines.js) in the world. */
  world(p) { return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.M); }
  async open() {
    let mod;
    try { mod = await VIEWS[this.g.id](); } catch (err) { console.error(err); this.close(); return; }
    if (cur !== this) return;
    this.group = new THREE.Group(); this.group.name = 'machine-play';
    this.group.matrixAutoUpdate = false; this.group.matrix.copy(this.M); this.group.matrixWorldNeedsUpdate = true;
    app.stage.scene.add(this.group);
    this.sparks = new Sparks(this.group);
    this.view = mod.create({ THREE, group: this.group, e: this.e, play: this, app });
    try { document.exitPointerLock?.(); } catch { /* not locked */ }
    // (a wider lens and a near plane that lets the ball in hand be seen, while it is played: put back on leaving)
    const C = app.stage.camera; this.lens = { fov: C.fov, near: C.near }; C.near = 0.05;
    this.aim();
    const c = this.cam();
    this.onResize = () => this.aim();
    addEventListener('resize', this.onResize);
    const camW = this.world(c.pos);
    app.agents.hideFn = (i, x, y, z) => (x - camW.x) ** 2 + (z - camW.z) ** 2 < 0.8 * 0.8 && Math.abs(camW.y - y - 1.0) < 1.4;
    this.makeBoard();
    const def = CATALOG[this.e.t];
    this.root = html(`<div class="mp-root" role="dialog" aria-label="${esc(this.g.title)}">
      <div class="mp-touch"></div>
      <div class="mp-top"><span class="mp-title">${esc(this.g.icon || '🎮')} ${esc(this.g.title)}</span><b class="mp-score">0</b><span class="mp-info"></span>
        <button type="button" class="mp-btn mp-pause" title="Pause (Esc)" aria-label="Pause">⏸</button><button type="button" class="mp-btn mp-leave" title="Leave" aria-label="Leave ${esc(def?.name || '')}">✕</button></div>
      <div class="mp-meter hidden"><i></i><span>POWER</span></div>
      <div class="mp-bal hidden"><i></i><b></b><span>BALANCE</span></div>
      <div class="mp-hint"></div><div class="mp-floats"></div><div class="mp-menu hidden"></div>
    </div>`);
    document.body.appendChild(this.root);
    document.body.classList.add('mp-playing');
    this.E = { bal: this.root.querySelector('.mp-bal'), balDot: this.root.querySelector('.mp-bal b'), score: this.root.querySelector('.mp-score'), info: this.root.querySelector('.mp-info'), meter: this.root.querySelector('.mp-meter'), bar: this.root.querySelector('.mp-meter i'), hint: this.root.querySelector('.mp-hint'), floats: this.root.querySelector('.mp-floats'), menu: this.root.querySelector('.mp-menu') };
    this.root.querySelector('.mp-leave').addEventListener('click', () => this.close());
    this.root.querySelector('.mp-pause').addEventListener('click', () => (this.state === 'playing' ? this.pause() : null));
    this.root.addEventListener('pointerdown', () => unlockSound(), { capture: true, passive: true });
    this.root.addEventListener('wheel', ev => ev.preventDefault(), { passive: false });
    this.input.attach();
    this.input.bindPointer(this.root.querySelector('.mp-touch'), this.g.pointer || {});
    this.onVis = () => { if (document.hidden && this.state === 'playing') this.pause(); };
    document.addEventListener('visibilitychange', this.onVis);
    unlockSound();
    this.tick = this.tick.bind(this); this.last = performance.now(); this.acc = 0;
    requestAnimationFrame(this.tick);
    this.start();
  }
  /** The camera where the player's eyes are (view.camera), stepped back on a narrow screen (a phone held upright) until
   *  the machine's width (view.camera.fit) is in view. */
  /** The camera for this screen: on one held upright (narrower than tall), the game's own for it if it has one
   *  (view.camera.narrow: a table seen down its length, a lamp put aside), else its usual one. */
  cam() {
    const c = this.view.camera;
    this.narrow = innerWidth < innerHeight && !!c.narrow;
    return this.narrow ? { ...c, ...c.narrow } : c;
  }
  aim() {
    const c = this.cam(), C = app.stage.camera;
    C.fov = c.fov || 52; C.updateProjectionMatrix();
    if (this.board?.mesh) this.board.mesh.visible = !(this.narrow && c.noBoard);
    const at = this.world(c.at), pos = this.world(c.pos);
    if (c.fit) {
      const aspect = innerWidth / Math.max(1, innerHeight), half = Math.atan(Math.tan(THREE.MathUtils.degToRad(C.fov) / 2) * aspect);
      const need = c.fit / 2 / Math.tan(half), d = pos.distanceTo(at);
      if (need > d) pos.sub(at).multiplyScalar(need / d).add(at);
    }
    app.cam.pinTo(pos, at);
  }
  /** The machine's LED panel: a canvas over it, the score and the game's own line (view.board, item frame). */
  makeBoard() {
    const b = this.view.board; if (!b) return;
    // (redrawn as the game goes, the dance machine's every frame: kept in memory, not on the GPU, and no mipmaps made again
    // at each copy: a copy from a GPU canvas waits for the GPU, a long frame on a phone)
    const cv = document.createElement('canvas'); cv.width = b.w || 256; cv.height = b.h || 96;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0, b.y1 - b.y0), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    mesh.position.set(b.cx ?? (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.cz ?? b.z);
    if (b.ry) mesh.rotation.y = b.ry;   // (a panel facing another way: the foosball table's, toward its side)
    this.group.add(mesh);
    this.board = { cv, ctx, tex, mesh };
    if (this.narrow && this.cam().noBoard) mesh.visible = false;
  }
  drawBoard(lines) {
    const B = this.board; if (!B) return;
    const key = lines.join('|'); if (key === this.boardKey) return;
    this.boardKey = key;
    const { ctx, cv } = B, w = cv.width, h = cv.height;
    ctx.fillStyle = '#05050a'; ctx.fillRect(0, 0, w, h);
    const n = lines.length, s = Math.max(2, Math.floor(Math.min(h / (n * 9), w / 60)));
    lines.forEach((l, i) => {
      const str = String(l), sl = Math.max(1, Math.min(s, Math.floor((w * 0.92) / Math.max(1, str.length * 6 - 1))));   // (a long word smaller, so it fits)
      pixelText(ctx, str, w / 2, (h - n * 9 * s) / 2 + i * 9 * s + s + ((s - sl) * 7) / 2, sl, { color: i === 0 ? '#fde047' : '#fca5a5', glow: i === 0 ? '#f59e0b' : '#ef4444', align: 'center' });
    });
    B.tex.needsUpdate = true;
  }
  async start() {
    this.state = 'loading'; this.menu(null);
    let st = null, practice = !auth.can('play.use');
    if (!practice) {
      for (let k = 0; k < 2 && !st; k++) {
        try { st = await post('/api/play/start', { module: 'arcade', course: this.g.id }); }
        catch (err) { if (err.status === 429 && k === 0) await new Promise(r => setTimeout(r, 1600)); else { practice = true; break; } }
      }
      if (!st) practice = true;
    }
    if (cur !== this) return;
    this.run = st ? { id: st.run, best: st.best?.score || 0 } : null;
    this.practice = practice;
    this.best = this.run?.best || 0;
    const seed = st?.data?.seed ?? ((Math.random() * 4294967296) >>> 0);
    this.s = this.sim.init(seed >>> 0); this.log = new InputLog(); this.acc = 0; this.last = performance.now();
    this.view.reset?.(this.s);
    this.state = 'playing';
    sfx('coin');
  }
  /** Every frame: the buttons (and where the pointer is, as the game reads it), the sim stepped, the machine moved. */
  tick(now) {
    if (cur !== this) return;
    requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000)); this.last = now;
    const b = this.input.read(now), p = this.input.ptr;
    let v = inputValue(b);
    if (p && p.d) { const m = this.view.pointer ? this.view.pointer(p, app.stage.camera) : { px: p.x, py: p.y }; if (m) v = inputValue(b, m.px, m.py, 1); }
    if (this.state === 'playing' && !this.paused && app.cam.pinned) {
      this.acc += dt;
      let n = 0, z = 0;
      while (this.acc >= DT && n < 6) {
        this.log.push(v);
        this.s.ev.length = 0;
        this.sim.step(this.s, inputBits(v));
        for (const ev of this.s.ev) {
          this.view.event(ev);
          const f = this.view.sfx?.(ev);
          if (f) { for (const x of Array.isArray(f[0]) ? f : [f]) sfx(x[0], x[1]); }
          z = Math.max(z, this.view.buzz?.(ev) || 0);
        }
        this.acc -= DT; n++;
        if (this.sim.over(this.s)) { this.finish(); break; }
      }
      if (n >= 6) this.acc = 0;
      if (z) buzz(z);
    }
    if (!this.paused) { this.view.update?.(this.s, dt, now); this.sparks.update(dt); }
    // a camera that moves with the game (a rider on the bull): the held pose follows it
    if (this.view.cameraNow && app.cam.pin) { const c = this.view.cameraNow(this.s, dt); if (c) { app.cam.pin.pos.copy(this.world(c.pos)); app.cam.pin.look.copy(this.world(c.at)); } }
    // the overlay: the score, the game's line, the meter, its words; the LED panel on the machine
    if (this.s) {
      const h = this.view.hud?.(this.s) || {};
      this.E.score.textContent = fmt(this.sim.score(this.s));
      if (this.E.info.textContent !== (h.info || '')) this.E.info.textContent = h.info || '';
      this.E.meter.classList.toggle('hidden', h.meter == null);
      if (h.meter != null) this.E.bar.style.height = `${Math.round(h.meter * 100)}%`;
      // a balance (a rider's lean: x, z in -1 … 1): a dot in a ring, red toward the edge
      this.E.bal.classList.toggle('hidden', !h.balance);
      if (h.balance) { const { x, z } = h.balance, d = Math.min(1, Math.hypot(x, z)); this.E.balDot.style.transform = `translate(${(Math.max(-1, Math.min(1, x)) * 46).toFixed(1)}px, ${(Math.max(-1, Math.min(1, z)) * 46).toFixed(1)}px)`; this.E.balDot.style.background = d > 0.75 ? '#ef4444' : d > 0.45 ? '#facc15' : '#4ade80'; }
      const hint = this.practice && !h.hint ? 'Practice: sign in to keep your scores' : h.hint || '';
      if (this.E.hint.textContent !== hint) this.E.hint.textContent = hint;
      if (this.view.paint && this.board) { const B = this.board; this.view.paint(B.ctx, B.cv.width, B.cv.height, this.s); B.tex.needsUpdate = true; }   // (a screen the game draws itself: the dance machine's)
      else this.drawBoard(h.board || [fmt(this.sim.score(this.s)), h.info || '']);
    }
    this.placeFloats(dt);
  }
  /** Words that rise from a point of the machine (item frame) and fade. */
  float(str, at, o = {}) {
    const el = html(`<span class="mp-float" style="color:${o.color || '#fff'};font-size:${o.size || 22}px">${esc(str)}</span>`);
    this.E.floats.appendChild(el);
    this.floats.push({ el, at: this.world(at), t: 0, life: o.life || 1.1 });
    if (this.floats.length > 14) { this.floats[0].el.remove(); this.floats.shift(); }
  }
  /** Sparks from a point of the machine (item frame). */
  burst(at, colors, n, speed, up) { this.sparks.burst(at, colors, n, speed, up); }
  placeFloats(dt) {
    if (!this.floats.length) return;   // (no words rising: no layout read this frame)
    const cam = app.stage.camera, r = app.stage.renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]; f.t += dt;
      if (f.t >= f.life) { f.el.remove(); this.floats.splice(i, 1); continue; }
      v.copy(f.at).project(cam);
      const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height - f.t * 50, u = f.t / f.life;
      f.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) scale(${u < 0.12 ? 0.6 + u / 0.12 * 0.4 : 1})`;
      f.el.style.opacity = u > 0.7 ? String((1 - u) / 0.3) : '1';
    }
  }
  press(n) {
    unlockSound();
    if (this.state === 'playing') { if (n === 'START' || n === 'BACK') this.pause(); return; }
    if (this.state === 'paused' || this.state === 'results') {
      const btns = [...this.E.menu.querySelectorAll('[data-act]')];
      if (!btns.length) return;
      let i = Math.max(0, btns.findIndex(b => b.classList.contains('sel')));
      if (n === 'U' || n === 'L') i = Math.max(0, i - 1);
      else if (n === 'D' || n === 'R') i = Math.min(btns.length - 1, i + 1);
      else if (n === 'A' || n === 'START') { this.act(btns[i].dataset.act); return; }
      else if (n === 'B' || n === 'BACK') { this.act(this.state === 'paused' ? 'resume' : 'leave'); return; }
      btns.forEach((b, k) => b.classList.toggle('sel', k === i)); sfx('select');
    }
  }
  menu(el) {
    this.E?.menu.replaceChildren(...(el ? [el] : []));
    this.E?.menu.classList.toggle('hidden', !el);
    el?.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => this.act(b.dataset.act)));
  }
  act(a) {
    if (a === 'resume') this.resume();
    else if (a === 'again' || a === 'restart') { this.abandon(); this.start(); }
    else if (a === 'leave') this.close();
  }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused'; this.paused = true;
    this.menu(html(`<div class="mp-card"><b>PAUSED</b><button type="button" class="sel" data-act="resume">▶ Resume</button><button type="button" data-act="restart">↺ Restart</button><button type="button" data-act="leave">✕ Leave</button></div>`));
  }
  resume() { if (this.state !== 'paused') return; this.state = 'playing'; this.paused = false; this.acc = 0; this.last = performance.now(); this.menu(null); }
  async finish() {
    this.state = 'over';
    const run = this.run, score = this.sim.score(this.s);
    this.run = null;
    const pend = run ? post('/api/play/finish', { run: run.id, report: { log: this.log.encode(), score, ticks: this.log.ticks } }).catch(err => ({ ok: false, why: err.message })) : Promise.resolve(null);
    await new Promise(r => setTimeout(r, 1500));   // (the last ball drops, the buzzer sounds)
    const res = await pend;
    if (cur !== this) return;
    let board = [];
    try { board = (await getJSON(`/api/play/leaderboard?module=arcade&course=${this.g.id}&limit=10`)).rows || []; } catch { /* offline */ }
    if (cur !== this) return;
    this.state = 'results';
    const me = auth.account?.id, got = res?.ok ? res.score : score, stars = res?.ok ? res.stars : 0;
    const tags = [];
    if (res?.ok && res.newBest) tags.push('<span class="new">NEW BEST!</span>');
    if (res?.ok && res.place) tags.push(`<span>#${res.place}</span>`);
    if (res?.ok && res.xp) tags.push(`<span>+${res.xp} XP</span>`);
    if (res?.ok && res.vc?.paid) tags.push(`<span class="vc">+${esc(fmtVc(res.vc.paid))}</span>`);
    const why = this.practice ? 'Practice game: sign in to keep your scores' : res && !res.ok ? `Not recorded: ${res.why || 'the run did not count'}` : '';
    this.menu(html(`<div class="mp-card mp-res">
      <b class="mp-res-h">${esc(this.g.title)}</b><div class="mp-res-score">${fmt(got)}</div>
      ${res?.ok ? `<div class="mp-stars">${[0, 1, 2].map(k => `<span class="${k < stars ? 'on' : ''}" style="animation-delay:${k * 0.2}s">★</span>`).join('')}</div>` : ''}
      ${tags.length ? `<div class="mp-tags">${tags.join('')}</div>` : ''}${why ? `<div class="mp-why">${esc(why)}</div>` : ''}
      ${res?.badges?.length ? `<div class="mp-badges">${res.badges.map(b => `<span title="${esc(b.desc)}">${b.icon} ${esc(b.label)}</span>`).join('')}</div>` : ''}
      <ol class="mp-board">${board.length ? board.map((r, i) => `<li class="${r.id === me ? 'me' : ''}"><i>${i + 1}</i><span>${esc(r.name || 'Player')}</span><b>${fmt(r.score)}</b></li>`).join('') : '<li class="none">No scores yet: be the first</li>'}</ol>
      <div class="mp-btns"><button type="button" class="sel" data-act="again">▶ Play again</button><button type="button" data-act="leave">✕ Leave</button></div></div>`));
    if (res?.ok && res.newBest) sfx('fanfare');
  }
  abandon() { if (this.run) { post('/api/play/abandon', { run: this.run.id }).catch(() => {}); this.run = null; } }
  close() {
    if (cur !== this) return;
    cur = null;
    this.abandon();
    this.input.detach();
    document.removeEventListener('visibilitychange', this.onVis);
    removeEventListener('resize', this.onResize);
    this.root?.remove();
    document.body.classList.remove('mp-playing');
    for (const f of this.floats) f.el.remove();
    try { this.view?.dispose?.(); } catch { /* gone */ }
    if (this.group) { app.stage.scene.remove(this.group); this.group.traverse(o => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach(m => { m.map?.dispose?.(); m.dispose?.(); }); }); }
    app.cam.unpin();
    if (this.lens) { const C = app.stage.camera; C.fov = this.lens.fov; C.near = this.lens.near; C.updateProjectionMatrix(); }
    setTimeout(() => { if (!cur && !app.arcade?.session) app.agents.hideFn = null; }, 450);
    if (app.machinePlay) app.machinePlay.active = false;
    this.o.onLeave?.();
  }
}

/** Plays machine e (an interiors entry) for real. o: { onLeave() } */
export function playMachine(e, o = {}) {
  const g = machineGame(e?.t);
  if (!g || !VIEWS[g.id]) return false;
  if (cur) cur.close();
  app.arcade?.session?.leave?.();
  cur = new Play(e, g, o);
  app.machinePlay.active = true;
  cur.open();
  return true;
}

export function init(a) {
  app = a;
  app.machinePlay = {
    active: false, play: playMachine, playsInWorld,
    get session() { return cur; },
    /** render/venue-motion.js: a part of the machine being played moves as its game says (undefined: as usual). */
    move(e, part, M) {
      if (!cur || !cur.view?.part) return undefined;
      const c = cur.e;
      if (e !== c && !(e.id === c.id && e.b === c.b && e.f === c.f)) return undefined;
      return cur.view.part(part, M, cur.s);
    },
  };
}
