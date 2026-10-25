// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's controller (docs/features/arcade.md "Controls"): one set of standard buttons — ▲ ▼ ◀ ▶, A, B, Start —
// from wherever they come: the keyboard, a game controller (the Gamepad API: Xbox, PlayStation, 8BitDo…), the on-screen
// pad a phone shows (the layout the game asks for: 'dpad' or 'lr'), and touches on the game's own screen (a game's
// gestures: a tap, a swipe across, a flick down). It hands the cabinet the buttons held now (a sim's bits) and each new
// press (for the menus). Several fingers at once; the pad's buttons are bigger to the touch than they look.
import { BTN } from '/shared/arcade/core.js';
import { buzz } from './arcade-sound.js';

const KEYS = {
  ArrowUp: 'U', KeyW: 'U', ArrowDown: 'D', KeyS: 'D', ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R',
  KeyZ: 'A', KeyJ: 'A', Space: 'A', KeyX: 'B', KeyK: 'B', Enter: 'START', KeyP: 'START', Escape: 'BACK', Backspace: 'BACK',
};
const BIT = { U: BTN.U, D: BTN.D, L: BTN.L, R: BTN.R, A: BTN.A, B: BTN.B };
const PULSE_ON = 45, PULSE_OFF = 35;   // ms a gesture's tap of a button is held, and the gap after it
const LATCH = 50;   // ms a press is held at least, however quick the tap or the key (a game steps every 16.7 ms)

export class ArcadeInput {
  /** o: { onPress(name) — a new press of U D L R A B START BACK (menus, pausing) } */
  constructor(o = {}) {
    this.onPress = o.onPress || (() => {});
    this.keys = new Set(); this.touch = 0; this.screen = 0; this.pad = 0; this.padPrev = 0; this.pulses = []; this.pulse = null;
    this.held = 0; this.gamepad = false; this.latch = new Map();   // bit → held until (a quick press still lands)
    this.onKeyDown = e => {
      if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
      e.preventDefault(); e.stopImmediatePropagation();   // nothing of the world's keys while the cabinet is in use
      const k = KEYS[e.code];
      if (!k) return;
      if (!e.repeat) { this.onPress(k); if (BIT[k]) this.latch.set(BIT[k], performance.now() + LATCH); }
      if (BIT[k]) this.keys.add(k);
    };
    this.onKeyUp = e => { const k = KEYS[e.code]; if (k) this.keys.delete(k); };
    this.onBlur = () => { this.keys.clear(); this.touch = 0; this.screen = 0; };
  }
  attach() {
    addEventListener('keydown', this.onKeyDown, true);
    addEventListener('keyup', this.onKeyUp, true);
    addEventListener('blur', this.onBlur);
  }
  detach() {
    removeEventListener('keydown', this.onKeyDown, true);
    removeEventListener('keyup', this.onKeyUp, true);
    removeEventListener('blur', this.onBlur);
    this.pad?.remove?.();
  }
  /** Taps a button for a moment (a gesture): queued, each held PULSE_ON ms then let go. */
  tap(name) { if (BIT[name]) this.pulses.push(BIT[name]); }
  /** The buttons held now (call once a frame: it reads the game controller and plays the taps). */
  read(now = performance.now()) {
    let b = 0;
    for (const k of this.keys) b |= BIT[k];
    b |= this.touch | this.screen | this.gamepadBits(now);
    for (const [bit, until] of this.latch) { if (now < until) b |= bit; else this.latch.delete(bit); }
    if (this.pulse && now >= this.pulse.until) this.pulse = this.pulse.on ? { on: false, until: now + PULSE_OFF } : null;
    if (!this.pulse && this.pulses.length) this.pulse = { on: true, bit: this.pulses.shift(), until: now + PULSE_ON };
    if (this.pulse?.on) b |= this.pulse.bit;
    // presses for the menus from the touch pad and the screen's own taps come through onPress where they happen
    this.held = b;
    return b;
  }
  gamepadBits() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let b = 0, start = false, back = false, any = false;
    for (const p of pads || []) {
      if (!p || !p.connected) continue;
      any = true;
      const btn = i => !!p.buttons[i]?.pressed, ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (btn(12) || ay < -0.5) b |= BTN.U;
      if (btn(13) || ay > 0.5) b |= BTN.D;
      if (btn(14) || ax < -0.5) b |= BTN.L;
      if (btn(15) || ax > 0.5) b |= BTN.R;
      if (btn(0) || btn(3)) b |= BTN.A;
      if (btn(1) || btn(2)) b |= BTN.B;
      start ||= btn(9); back ||= btn(8);
    }
    if (any !== this.gamepad) { this.gamepad = any; this.onGamepad?.(any); }
    // presses (edges) for the menus
    const prev = this.padPrev, edge = b & ~prev;
    for (const [n, bit] of Object.entries(BIT)) if (edge & bit) this.onPress(n);
    if (start && !this.startPrev) this.onPress('START');
    if (back && !this.backPrev) this.onPress('BACK');
    this.padPrev = b; this.startPrev = start; this.backPrev = back;
    return b;
  }

  // ---------------------------------------------------------------- the on-screen pad (phones and tablets)
  /** Builds the pad for a game's controls ({ layout: 'dpad' | 'lr', a, b }) into host; → its element. */
  buildPad(host, controls) {
    this.pad?.remove?.();
    const dpad = controls.layout === 'dpad', tap = controls.layout === 'tap';   // ('tap': the game's own screen is the controller)
    const el = document.createElement('div');
    el.className = `arc-pad arc-pad-${controls.layout}${tap ? '' : controls.a || controls.b ? '' : ' arc-pad-solo'}`;   // (no buttons to press: the cross alone, in the middle)
    el.innerHTML = `
      <div class="arc-pad-l">${tap ? '' : dpad
    ? '<div class="arc-dpad" data-zone="dpad"><i class="u">▲</i><i class="d">▼</i><i class="l">◀</i><i class="r">▶</i><b></b></div>'
    : '<button type="button" class="arc-pb arc-lr" data-b="L" aria-label="Left">◀</button><button type="button" class="arc-pb arc-lr" data-b="R" aria-label="Right">▶</button>'}</div>
      <div class="arc-pad-m"><button type="button" class="arc-start" data-b="START" aria-label="Pause">⏸</button></div>
      <div class="arc-pad-r">${tap ? '' : controls.b ? `<button type="button" class="arc-pb arc-b" data-b="B" aria-label="${controls.b}"><span>B</span><small>${controls.b}</small></button>` : ''}${!tap && controls.a ? `<button type="button" class="arc-pb arc-a" data-b="A" aria-label="${controls.a}"><span>A</span><small>${controls.a}</small></button>` : ''}</div>`;
    host.appendChild(el);
    this.pad = el;
    const fingers = new Map();   // pointer id → bits it holds
    const update = () => {
      let b = 0; for (const v of fingers.values()) b |= v;
      const edge = b & ~this.touch;
      if (edge) { buzz(8); for (const [n, bit] of Object.entries(BIT)) if (edge & bit) { this.onPress(n); this.latch.set(bit, performance.now() + LATCH); } }
      this.touch = b;
      for (const x of el.querySelectorAll('[data-b]')) x.classList.toggle('on', !!(BIT[x.dataset.b] & b));
      const dp = el.querySelector('.arc-dpad');
      if (dp) for (const [c, bit] of [['u', BTN.U], ['d', BTN.D], ['l', BTN.L], ['r', BTN.R]]) dp.querySelector(`.${c}`).classList.toggle('on', !!(b & bit));
    };
    const bitsAt = (x, y) => {
      // the d-pad: the direction of the finger from its middle (a dead centre; the stronger axis wins)
      const dp = el.querySelector('.arc-dpad');
      if (dp) {
        const r = dp.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = x - cx, dy = y - cy, rad = r.width / 2;
        if (Math.hypot(dx, dy) < rad * 1.45 && x < innerWidth / 2 + 20) {
          if (Math.hypot(dx, dy) < rad * 0.18) return 0;
          return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? BTN.L : BTN.R) : (dy < 0 ? BTN.U : BTN.D);
        }
      }
      // buttons: the nearest within reach (a big margin round each)
      let best = 0, bd = Infinity;
      for (const bt of el.querySelectorAll('.arc-pb')) {
        const r = bt.getBoundingClientRect(), d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
        if (d < Math.max(r.width, r.height) * 0.9 && d < bd) { bd = d; best = BIT[bt.dataset.b]; }
      }
      return best;
    };
    el.addEventListener('pointerdown', e => {
      const st = e.target.closest('.arc-start');
      if (st) { e.preventDefault(); buzz(8); this.onPress('START'); return; }
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
      fingers.set(e.pointerId, bitsAt(e.clientX, e.clientY)); update();
    });
    el.addEventListener('pointermove', e => { if (!fingers.has(e.pointerId)) return; e.preventDefault(); fingers.set(e.pointerId, bitsAt(e.clientX, e.clientY)); update(); });
    const up = e => { if (fingers.delete(e.pointerId)) update(); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
    return el;
  }
  /** Touches on the game's own screen (el), for a game with gestures ({ tap, swipeX, swipe4, flickDown, holdDown }):
   *  swipe4 taps the way a finger moves (up, down, left or right), once a cell's distance, again as it goes on. */
  bindGestures(el, g) {
    if (!g) return;
    const cell = () => Math.max(18, el.getBoundingClientRect().width / 13);
    let f = null;
    el.addEventListener('pointerdown', e => {
      if (g.press) { e.preventDefault(); this.tap(g.press); return; }   // (a flap: the moment the finger or the mouse goes down)
      if (e.pointerType === 'mouse' || f) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
      f = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false, hold: false };
    });
    el.addEventListener('pointermove', e => {
      if (!f || e.pointerId !== f.id) return;
      e.preventDefault();
      const c = cell();
      if (g.swipeX) while (Math.abs(e.clientX - f.x) >= c) { const d = Math.sign(e.clientX - f.x); f.x += d * c; f.moved = true; this.tap(d < 0 ? 'L' : 'R'); }
      if (g.swipe4) {
        const dx = e.clientX - f.x, dy = e.clientY - f.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= c * 1.3) { this.tap(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'L' : 'R') : (dy < 0 ? 'U' : 'D')); f.x = e.clientX; f.y = e.clientY; f.moved = true; }
      }
      const dy = e.clientY - f.y0, dt = performance.now() - f.t0;
      if (g.holdDown && dy > c * 1.4 && dt > 220 && Math.abs(e.clientX - f.x0) < c * 2) { f.hold = true; f.moved = true; this.screen = BIT[g.holdDown]; }
      else if (f.hold && dy < c) { f.hold = false; this.screen = 0; }
    });
    const end = e => {
      if (!f || e.pointerId !== f.id) return;
      const dx = e.clientX - f.x0, dy = e.clientY - f.y0, dt = performance.now() - f.t0;
      if (!f.moved && Math.hypot(dx, dy) < 12 && dt < 300 && g.tap) this.tap(g.tap);
      else if (g.flickDown && !f.hold && dy > 50 && dt < 260 && Math.abs(dy) > Math.abs(dx) * 1.5) this.tap(g.flickDown);
      this.screen = 0; f = null;
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  /**
   * A game that reads the pointer (o: { tap }): where a finger or the mouse is on the game's screen el, as 0 … 255 across
   * and down, and whether it aims (pd: a finger down, or the mouse over the screen). A quick tap (or a click) taps o.tap;
   * o.down presses at once; o.hold holds a button while touching; o.sides: [left, right], the button held by a finger
   * (or the mouse) on each half of the screen, both at once (pinball's flippers); o.arrows: a tap toward a side of the
   * screen presses that way's arrow (the dance machine).
   */
  bindPointer(el, o = {}) {
    this.ptr = { x: 128, y: 128, d: 0 };
    let f = null;
    const sides = new Map();   // (o.sides: each finger on the left or right half holds its own button, two at once)
    const at = e => { const r = el.getBoundingClientRect(); this.ptr.x = Math.max(0, Math.min(255, Math.round(((e.clientX - r.left) / r.width) * 255))); this.ptr.y = Math.max(0, Math.min(255, Math.round(((e.clientY - r.top) / r.height) * 255))); };
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); at(e); this.ptr.d = 1;
      if (o.down) this.tap(o.down);   // (fire where it touches, at once)
      if (o.hold && BIT[o.hold]) { this.screen |= BIT[o.hold]; this.latch.set(BIT[o.hold], performance.now() + LATCH); }   // (held while it touches: a charge)
      if (o.arrows) { const r = el.getBoundingClientRect(), dx = (e.clientX - r.left) / r.width - 0.5, dy = (e.clientY - r.top) / r.height - 0.5; this.tap(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'L' : 'R') : (dy < 0 ? 'U' : 'D')); }   // (a tap toward a side: that arrow)
      if (o.sides) { const r = el.getBoundingClientRect(), bit = BIT[o.sides[e.clientX < r.left + r.width / 2 ? 0 : 1]]; if (bit) { sides.set(e.pointerId, bit); this.screen |= bit; this.latch.set(bit, performance.now() + LATCH); } }
      try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
      f = { x: e.clientX, y: e.clientY, t: performance.now(), mouse: e.pointerType === 'mouse' };
    });
    el.addEventListener('pointermove', e => { at(e); if (e.pointerType === 'mouse' || f) this.ptr.d = 1; });
    const end = e => {
      if (o.hold && BIT[o.hold]) this.screen &= ~BIT[o.hold];
      if (sides.has(e.pointerId)) { const bit = sides.get(e.pointerId); sides.delete(e.pointerId); if (![...sides.values()].includes(bit)) this.screen &= ~bit; }
      if (f && Math.hypot(e.clientX - f.x, e.clientY - f.y) < 14 && performance.now() - f.t < 320 && o.tap) this.tap(o.tap);
      if (e.pointerType !== 'mouse') this.ptr.d = 0;
      f = null;
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !f) this.ptr.d = 0; });
  }
}
