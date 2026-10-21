// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Automatic resolution: when frames run long (a GPU falling behind in a busy view) render fewer pixels, and raise them
// again after a long smooth stretch. A lower step that does not help (a CPU-bound device) is undone and not retried for
// 30 s; a raise that brings slow frames back is undone and retried only after twice as long. The first 10 s after
// start are not judged: start-up work passes on its own, and a resize there would only add a hitch.
export class AutoResolution {
  constructor({ set, min = 0.6, on = true, windowMs = 1500, warmupMs = 10000 }) {
    Object.assign(this, { setScale: set, min, on, windowMs, warmupMs, start: null, scale: 1, sum: 0, n: 0, t: null, last: 0, smooth: 0, hold: 8, tried: null, raised: null, coolUntil: 0 });
  }
  set(s) { this.scale = Math.round(s * 100) / 100; this.setScale(this.scale); }
  enable(on) { this.on = on; this.tried = this.raised = null; this.smooth = 0; if (!on) this.set(1); }
  /** Frames drawn slower on purpose (core/framepace.js): not a sign of a slow GPU - start the next window afresh. */
  rest(now) { this.last = now; this.t = now; this.sum = this.n = 0; }
  /** Call once per displayed frame with its timestamp (ms). */
  frame(now) {
    if (!this.on) return;
    const gap = this.last ? now - this.last : 0; this.last = now;
    if (this.start === null) this.start = now;
    if (now - this.start < this.warmupMs) { this.t = now; this.sum = this.n = 0; return; }
    if (this.t === null) this.t = now;
    if (gap <= 0 || gap > 250) return;   // first frame, or a hidden tab
    this.sum += gap; this.n++;
    if (now - this.t >= this.windowMs) { const avg = this.sum / this.n; this.sum = this.n = 0; this.t = now; this.judge(avg, now); }
  }
  judge(avg, now) {
    if (this.tried) { if (avg > this.tried.avg * 0.95) { this.set(this.tried.from); this.coolUntil = now + 30000; } this.tried = null; return; }
    if (this.raised) { const r = this.raised; this.raised = null; if (avg > 19) { this.set(r.from); this.hold = Math.min(64, this.hold * 2); this.smooth = 0; return; } }
    if (avg > 19) { this.smooth = 0; if (this.scale > this.min && now > this.coolUntil) { this.tried = { from: this.scale, avg }; this.set(Math.max(this.min, this.scale - 0.1)); } }
    else if (avg < 17.6 && this.scale < 1 && ++this.smooth >= this.hold) { this.smooth = 0; this.raised = { from: this.scale }; this.set(Math.min(1, this.scale + 0.05)); }
  }
}
