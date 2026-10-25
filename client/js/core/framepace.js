// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Frame pacing (2026-10-03: "my phone gets very hot when in the world ... uncomfortable to use"). On a phone the GPU
// ran flat out every frame; most of that is spent when nothing on screen needs it. Settings → Display → Frame rate:
//   auto  — phones and tablets: up to 60 frames a second while you touch, pan, follow someone or play a machine's
//           game, 30 once the camera has been still and untouched for a few seconds (the world's people, water and weather still move, only
//           half as often); never faster than 60 on a 90/120 Hz screen. Other devices: as before (every display frame).
//   60 / 30 — at most that many, always.  max — every display frame.
// The choice stays with this device (like the graphics quality).
// A window over the whole world — Settings, the Agent Studio, a dialog, the chat full screen (2026-10-08:
// "the chat window, Settings, the Agent Studio take a bit longer to load"; on a phone a world frame takes ~50 ms, and
// every step of opening a window waited behind them): while one is open the world behind it draws at most COVERED_FPS a
// second, and none at all for its first OPENING_MS, while it is being built — whatever the mode.
const KEY = 'mvw.fps', IDLE_MS = 4000, COVERED_FPS = 20, OPENING_MS = 400;
export const FPS_MODES = [['auto', 'Auto — smooth when moving, cooler when still'], ['60', '60 at most'], ['30', '30 at most (coolest)'], ['max', 'Unlimited']];

export class FramePace {
  constructor({ battery = false } = {}) {
    this.battery = battery;   // a phone or tablet (coarse pointer): its heat and battery matter
    this.mode = localStorage.getItem(KEY) || 'auto';
    this.lastInput = 0; this.lastStep = 0; this.idle = false;
    this.covered = false; this.quietUntil = 0;
  }
  /** Whether a window covers the world now (main.js asks every display frame); the moment one opens, a short quiet. */
  cover(on, now) {
    if (on && !this.covered) this.quietUntil = now + OPENING_MS;
    if (!on) this.quietUntil = 0;
    this.covered = on;
  }
  setMode(m) { this.mode = m; if (m === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, m); }
  /** Something the person did (touch, pointer, wheel, key). */
  input(now) { this.lastInput = now; }
  /** The least time (ms) between drawn frames now, or 0 for every display frame. busy: the camera moving or following. */
  interval(now, busy) {
    if (this.covered) return Math.max(1000 / COVERED_FPS, this.base(now, busy));
    return this.base(now, busy);
  }
  base(now, busy) {
    if (this.mode === 'max') return 0;
    if (this.mode === '30') return 1000 / 30;
    if (this.mode === '60') return 1000 / 60;
    if (!this.battery) return 0;
    this.idle = !busy && now - this.lastInput > IDLE_MS;
    return this.idle ? 1000 / 30 : 1000 / 60;
  }
  /** Draw a frame at this display frame? (a couple of ms' slack: display frames never land exactly) */
  due(now, busy) {
    if (now < this.quietUntil) return false;
    const iv = this.interval(now, busy);
    if (iv && now - this.lastStep < iv - 2.5) return false;
    this.lastStep = now;
    return true;
  }
}
