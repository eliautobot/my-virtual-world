// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// City camera: orbit around a ground target. Left-drag pans (grab the ground), right/middle-drag rotates + tilts,
// wheel zooms toward the cursor, WASD/QE/arrows move. Touch: 1 finger pans, 2 fingers pinch/twist/tilt.
// Play mode (look = true, player.js): on a computer the mouse turns the camera with no button held (pointer lock: Esc frees
// the cursor, a click on the world takes it again); on a touch screen one finger anywhere on the world turns it — so one
// thumb on the stick and one on the world walk and look at once; two fingers on the world still zoom.
// First person (2026-10-06): in Play mode on foot, zooming on in past the nearest distance (the wheel, a pinch)
// glides the camera into the player's eyes; zooming out glides it back out behind them.
import * as THREE from 'three';
import { clamp, angDiff } from '../core/util.js';

const _ray = new THREE.Ray(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _p = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export class CityCamera {
  constructor(camera, dom) {
    this.cam = camera; this.dom = dom;
    this.target = new THREE.Vector3(0, 0, 0); this.goal = new THREE.Vector3(0, 0, 0);
    this.dist = 260; this.goalDist = 260;
    this.yaw = 0.7; this.goalYaw = 0.7;
    this.pitch = 0.9; this.goalPitch = 0.9;
    this.minDist = 2.5; this.maxDist = 950; this.minPitch = 0.12; this.maxPitch = 1.5;
    this.lens = 0; this.lensGoal = 0;   // sideways lens shift in px (DECISIONS C114); ui/docks.js sets the goal
    this.bounds = null;
    this.enabled = true; this.keysEnabled = true;
    this.keys = new Set();
    this.follow = null;          // () => {x, y, z} | null
    this.rates = null;           // {follow, turn} smoothing overrides (driving), else the defaults below
    this.onUserMove = null;      // called when the user pans (cancels follow)
    this.pointers = new Map();
    this.drag = null;
    this.moved = 0;
    this.look = false;           // play mode: the mouse (captured) or one finger turns the camera
    this.lookPaused = null;      // () => true while something else needs the cursor (a dialog, the map, typing)
    this.lockEndedAt = -1e9;     // when the cursor was last freed (Esc frees it before it leaves Play mode)
    this.swallowClick = false;   // the click that captured the mouse does nothing else
    this.fpEye = null;           // () => {x, y, z} the player's eyes while first person is possible (player.js), else null
    this.fp = false; this.fpK = 0;   // in first person; how far the camera has glided into the eyes (0 … 1)
    this.fpZoom = 0; this.fpZoomT = 0;   // zoom pushed past the nearest distance (in) or out of first person (out), log units
    this.onFP = null;            // (on) => … when first person starts or ends
    this.pin = null;             // { pos, look }: the camera held at a pose (an agent's PC used on its screen: ui/pc-onscreen.js)
    this.pinOn = false; this.pinK = 0;   // held now; how far it has glided there (0 … 1)
    this.bind();
    this.apply();
  }
  bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', e => e.preventDefault());
    d.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.up(e));
    d.addEventListener('wheel', e => this.wheel(e), { passive: false });
    window.addEventListener('keydown', e => { if (!this.typing(e)) this.keys.add(e.code); });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', e => this.mouseLook(e));
    document.addEventListener('pointerlockchange', () => { if (!this.locked) this.lockEndedAt = performance.now(); this.onLock?.(this.locked); });
  }
  get locked() { return typeof document !== 'undefined' && document.pointerLockElement === this.dom; }
  /** Captures the mouse so it turns the camera (Play mode on a computer). Needs a click or key press just before. */
  lockMouse() {
    if (!this.look || this.locked || !this.dom.requestPointerLock) return;
    try { const r = this.dom.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* no gesture yet: the next click */ }
  }
  unlockMouse() { if (this.locked) document.exitPointerLock?.(); }
  mouseLook(e) {
    if (!this.locked) return;
    if (!this.look || !this.enabled || this.lookPaused?.()) { this.unlockMouse(); return; }
    this.goalYaw -= e.movementX * 0.0032;
    this.goalPitch = clamp(this.goalPitch + e.movementY * 0.0026, this.minPitch, this.maxPitch);
  }
  typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  rayAt(cx, cy, out = _ray) {
    const r = this.dom.getBoundingClientRect();
    const x = ((cx - r.left) / r.width) * 2 - 1, y = -((cy - r.top) / r.height) * 2 + 1;
    out.origin.setFromMatrixPosition(this.cam.matrixWorld);
    out.direction.set(x, y, 0.5).unproject(this.cam).sub(out.origin).normalize();
    return out;
  }
  groundAt(cx, cy, y = this.target.y, out = new THREE.Vector3()) {
    const r = this.rayAt(cx, cy);
    _p.constant = -y;
    if (!r.intersectPlane(_p, out)) {
      // looking above the horizon: project far along the view direction
      out.copy(r.origin).addScaledVector(r.direction, this.dist * 3); out.y = y;
    }
    return out;
  }
  down(e) {
    if (!this.enabled || this.pinOn) return;
    if (this.look && e.pointerType === 'mouse' && e.button === 0 && !this.locked) { this.lockMouse(); this.swallowClick = true; }
    if (!this.locked) try { this.dom.setPointerCapture?.(e.pointerId); } catch { /* a captured mouse (pointer lock) can't be captured again */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, touch: e.pointerType !== 'mouse' });
    this.moved = 0;
    if (this.pointers.size === 1) {
      const rotate = (this.look && e.pointerType !== 'mouse') || e.button === 2 || e.button === 1 || (e.button === 0 && (e.ctrlKey || e.altKey));
      this.drag = { kind: rotate ? 'rot' : (e.button === 0 ? 'pan' : null), anchor: this.groundAt(e.clientX, e.clientY), x: e.clientX, y: e.clientY, pan: this.panEnabled !== false };
      if (this.drag.kind === 'pan' && !this.drag.pan) this.drag.kind = null;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2, mx: (a.x + b.x) / 2 };
    }
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.drag) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    const dr = this.drag;
    if (dr.kind === 'pan' && this.pointers.size === 1) {
      if (this.moved < 3) return;
      this.apply();
      const hit = this.groundAt(e.clientX, e.clientY, dr.anchor.y);
      _v.subVectors(dr.anchor, hit); _v.y = 0;
      if (_v.lengthSq() > this.dist * this.dist * 4) _v.setLength(this.dist * 2);
      this.target.add(_v); this.goal.add(_v);
      this.clampBounds();
      if (this.follow && this.onUserMove) this.onUserMove();
    } else if (dr.kind === 'rot' && this.pointers.size === 1) {
      const k = p.touch ? 1.25 : 1;   // a finger turns the camera a little faster than a mouse drag
      this.goalYaw -= dx * 0.0055 * k;
      this.goalPitch = clamp(this.goalPitch + dy * 0.0045 * k, this.minPitch, this.maxPitch);
    } else if (dr.kind === 'pinch' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2, mx = (a.x + b.x) / 2;
      if (dr.d > 10 && d > 10) this.zoomTo(this.goalDist * dr.d / d);
      this.goalYaw -= angDiff(dr.ang, ang);
      this.goalPitch = clamp(this.goalPitch + (my - dr.my) * 0.004, this.minPitch, this.maxPitch);
      if (this.panEnabled !== false) {
        const g0 = this.groundAt(dr.mx, dr.my), g1 = this.groundAt(mx, my);
        _v.subVectors(g0, g1); _v.y = 0; this.target.add(_v); this.goal.add(_v);
      }
      Object.assign(dr, { d, ang, my, mx });
    }
  }
  up(e) {
    this.pointers.delete(e.pointerId);
    if (!this.pointers.size) this.drag = null;
    else if (this.pointers.size === 1) {
      const [p] = [...this.pointers.values()];
      this.drag = { kind: this.look && p.touch ? 'rot' : this.panEnabled !== false ? 'pan' : null, anchor: this.groundAt(p.x, p.y), x: p.x, y: p.y };
    }
  }
  /** True if the last pointer interaction was a click (no drag). */
  wasClick() { return this.moved < 5; }
  wheel(e) {
    if (!this.enabled || this.pinOn) return;
    e.preventDefault();
    const k = Math.exp(clamp(e.deltaY, -300, 300) * (e.deltaMode === 1 ? 0.05 : 0.0012));
    const raw = this.goalDist * k, nd = clamp(raw, this.minDist, this.maxDist);
    if (this.panEnabled !== false && !this.follow) {
      const hit = this.groundAt(e.clientX, e.clientY);
      const f = 1 - nd / this.goalDist;
      _v.subVectors(hit, this.goal); _v.y = 0;
      this.goal.addScaledVector(_v, f);
      this.clampBounds();
    }
    this.zoomTo(raw);
  }
  /** The zoom buttons and the wheel: a factor on the distance. */
  zoomBy(factor) { this.zoomTo(this.goalDist * factor); }
  /** Zooms to a distance (clamped to the camera's range). Where first person is possible, zooming on in at the nearest
   *  distance (a couple of wheel notches, a pinch a third further) goes into it, and zooming out comes back out. */
  zoomTo(d) {
    const eye = this.fpEye?.();
    if (eye) {
      const now = performance.now(), r = Math.log(Math.max(d, 1e-3) / this.goalDist);   // < 0 zooms in, > 0 out
      if (now - this.fpZoomT > 700) this.fpZoom = 0;
      this.fpZoomT = now;
      // (a pinch's jitter back the other way takes a little off rather than starting over)
      if (this.fp) {
        this.fpZoom = Math.max(0, this.fpZoom + r);
        if (this.fpZoom > 0.08) this.setFP(false);
        return;
      }
      if (this.goalDist <= this.minDist * 1.05) {
        this.fpZoom = Math.max(0, this.fpZoom + Math.log(this.minDist / Math.max(d, 1e-3)));
        if (this.fpZoom > 0.22) { this.goalDist = this.minDist; this.setFP(true); return; }
      } else this.fpZoom = 0;
    }
    this.goalDist = clamp(d, this.minDist, this.maxDist);
  }
  /** Into or out of first person; instant skips the glide (leaving Play mode). Looking up and down goes past level only
   *  in first person: going in levels the view, coming out returns to the angle it had behind the player. */
  setFP(on, instant = false) {
    on = !!on;
    if (on !== this.fp) {
      this.fp = on; this.fpZoom = 0;
      if (on) {
        this.fpSave = { pitch: this.goalPitch, minPitch: this.minPitch, maxPitch: this.maxPitch };
        this.minPitch = -1.3; this.maxPitch = 1.35; this.goalPitch = 0.06;
      } else if (this.fpSave) {
        Object.assign(this, { minPitch: this.fpSave.minPitch, maxPitch: this.fpSave.maxPitch });
        this.goalPitch = clamp(this.fpSave.pitch, this.minPitch, this.maxPitch); this.fpSave = null;
      }
      this.onFP?.(on);
    }
    if (instant) { this.fpK = on ? 1 : 0; this.pitch = this.goalPitch; this.apply(); }
  }

  /** Holds the camera at `pos` looking at `look` (THREE.Vector3s), gliding there from wherever it is; nothing the person
   *  does moves it meanwhile. unpin() glides it back to where it was. (An agent's PC used on its screen.) */
  pinTo(pos, look) { this.pin = { pos: pos.clone(), look: look.clone() }; this.pinOn = true; this.keys.clear(); this.drag = null; this.pointers.clear(); }
  unpin() { this.pinOn = false; }
  /** Whether it is held and has arrived. */
  get pinned() { return this.pinOn && this.pinK >= 1; }
  flyTo(x, y, z, dist = null, yaw = null, pitch = null) {
    this.goal.set(x, y, z);
    if (dist !== null) this.goalDist = clamp(dist, this.minDist, this.maxDist);
    if (yaw !== null) this.goalYaw = this.yaw + angDiff(this.yaw, yaw);
    if (pitch !== null) this.goalPitch = clamp(pitch, this.minPitch, this.maxPitch);
  }
  jumpTo(x, y, z, dist = null) { this.flyTo(x, y, z, dist); this.target.copy(this.goal); if (dist !== null) this.dist = this.goalDist; this.apply(); }
  clampBounds() {
    const b = this.bounds; if (!b) return;
    for (const v of [this.goal, this.target]) { v.x = clamp(v.x, b.x0, b.x1); v.z = clamp(v.z, b.z0, b.z1); }
  }
  update(dt) {
    this.pinK = clamp(this.pinK + (this.pinOn && this.pin ? dt : -dt) / 0.7, 0, 1);   // (the glide to a held pose and back: 0.7 s)
    if (!this.pinK && !this.pinOn) this.pin = null;
    // keyboard
    if (this.keysEnabled && this.enabled && !this.pinOn && this.keys.size) {
      const K = this.keys, sp = this.goalDist * 1.1 * dt;
      let fx = 0, fz = 0;
      if (K.has('KeyW') || K.has('ArrowUp')) fz -= 1;
      if (K.has('KeyS') || K.has('ArrowDown')) fz += 1;
      if (K.has('KeyA') || K.has('ArrowLeft')) fx -= 1;
      if (K.has('KeyD') || K.has('ArrowRight')) fx += 1;
      if ((fx || fz) && this.panEnabled !== false) {
        const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
        this.goal.x += (fx * c + fz * s) * sp; this.goal.z += (-fx * s + fz * c) * sp;
        this.clampBounds();
        if (this.follow && this.onUserMove) this.onUserMove();
      }
      if (K.has('KeyQ')) this.goalYaw += 1.6 * dt;
      if (K.has('KeyE') && !this.eReserved) this.goalYaw -= 1.6 * dt;
      if (K.has('Equal') || K.has('NumpadAdd')) this.goalDist = clamp(this.goalDist * Math.exp(-1.6 * dt), this.minDist, this.maxDist);
      if (K.has('Minus') || K.has('NumpadSubtract')) this.goalDist = clamp(this.goalDist * Math.exp(1.6 * dt), this.minDist, this.maxDist);
    }
    if (this.follow) {
      const p = this.follow();
      if (p) this.goal.set(p.x, p.y, p.z);
    }
    const rate = this.rates?.follow ?? (this.follow ? 7 : 9), rateR = this.rates?.turn ?? (this.fp ? 22 : 10), k = 1 - Math.exp(-dt * rate), kr = 1 - Math.exp(-dt * rateR);
    if (this.fp && !this.fpEye?.()) this.setFP(false);   // first person no longer possible (a vehicle, Play mode left)
    this.fpK = clamp(this.fpK + (this.fp ? dt : -dt) / 0.35, 0, 1);   // the glide in or out takes 0.35 s
    // Following something that moves (a driven car): the exact smoothing for a goal moving steadily through the frame.
    // A plain lerp trails a moving goal by an amount that depends on the frame's length, so frames of uneven length
    // (33, 50, 33 ms on a busy phone) shook the car on screen by ~12 cm at 50 km/h (2026-10-04); this trails it by the
    // same amount whatever the frames. The same for the camera turning after it.
    // Something followed that moves by real time (an aircraft: player/flight.js sets followDt) gives the frame's real
    // length: after a long frame the camera keeps its distance behind it — with the page's dt (at most 0.1 s) it fell
    // behind by the rest and lurched after it (2026-10-14, a phone's 300 ms frame at 120 m/s).
    const fdt = this.follow && this.followDt > 0 ? Math.min(1, this.followDt) : dt; this.followDt = 0;
    const F = this.follow && this._fPrev && fdt > 1e-4 ? this._fPrev : null;
    if (F) {
      const e = Math.exp(-fdt * rate), inv = 1 / (rate * fdt), t = this.target, g = this.goal;
      t.set(g.x - (g.x - F.x) * inv + (t.x - F.x + (g.x - F.x) * inv) * e, g.y - (g.y - F.y) * inv + (t.y - F.y + (g.y - F.y) * inv) * e, g.z - (g.z - F.z) * inv + (t.z - F.z + (g.z - F.z) * inv) * e);
      let dy = this.goalYaw - F.yaw; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
      const er = Math.exp(-fdt * rateR), invR = 1 / (rateR * fdt), base = this.goalYaw - dy;   // (the last goal, on this goal's side of ±π)
      this.yaw = this.goalYaw - dy * invR + (this.yaw - base + dy * invR) * er;
    } else { this.target.lerp(this.goal, k); this.yaw += (this.goalYaw - this.yaw) * kr; }
    if (this.follow) (this._fPrev ??= { x: 0, y: 0, z: 0, yaw: 0 }) && Object.assign(this._fPrev, { x: this.goal.x, y: this.goal.y, z: this.goal.z, yaw: this.goalYaw });
    else this._fPrev = null;
    this.dist += (this.goalDist - this.dist) * kr;
    this.pitch += (this.goalPitch - this.pitch) * kr;
    const dl = this.lensGoal - this.lens;
    this.lens = Math.abs(dl) < 0.3 ? this.lensGoal : this.lens + dl * (1 - Math.exp(-dt * 14));   // glides in about 0.2 s
    this.apply();
  }
  apply() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const c = this.cam, ox = Math.sin(this.yaw) * cp, oz = Math.cos(this.yaw) * cp;   // (ox, sp, oz): target → camera
    c.position.set(this.target.x + ox * this.dist, this.target.y + sp * this.dist, this.target.z + oz * this.dist);
    if (c.position.y < this.target.y + 0.4) c.position.y = this.target.y + 0.4;
    const eye = this.fpK > 0 ? this.fpEye?.() : null;
    if (eye) {
      // first person: the camera glides into the eyes, looking the same way as behind the player (along -o)
      const u = this.fpK * this.fpK * (3 - 2 * this.fpK);
      c.position.set(c.position.x + (eye.x - c.position.x) * u, c.position.y + (eye.y - c.position.y) * u, c.position.z + (eye.z - c.position.z) * u);
      c.lookAt(_v.set(c.position.x - ox, c.position.y - sp, c.position.z - oz));
    } else c.lookAt(this.target);
    c.near = clamp(this.dist * 0.015, 0.08, 6);
    // held at a pose (pinTo): from the orbit's own place and aim to the held one, eased; close up, so a near plane to match
    if (this.pin && this.pinK > 0) {
      const u = this.pinK * this.pinK * (3 - 2 * this.pinK), P = this.pin;
      _v.copy(c.position); c.position.lerpVectors(_v, P.pos, u);
      _w.copy(this.target).lerp(P.look, u);
      c.lookAt(_w);
      c.near = Math.max(0.02, c.near * (1 - u) + 0.04 * u);
    }
    c.far = clamp(this.dist * 10 + (this.farBase || 1400), 1600, this.maxFar || 7000);   // farther on an island (WP4.2)
    // A lens shift draws the target in the middle of the area the docks leave visible (C114). It moves the picture, not
    // the camera, so picking, labels and every projection stay exact.
    if (Math.abs(this.lens) > 0.2 && !(this.pin && this.pinK > 0)) {
      const w = this.dom.clientWidth || innerWidth, h = this.dom.clientHeight || innerHeight, v = c.view;
      if (!v || !v.enabled || v.offsetX !== this.lens || v.fullWidth !== w || v.fullHeight !== h) c.setViewOffset(w, h, this.lens, 0, w, h);
    } else if (c.view && c.view.enabled) c.clearViewOffset();
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }
}
