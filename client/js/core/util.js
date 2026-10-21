// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Small client helpers.
export class Emitter {
  constructor() { this._h = new Map(); }
  on(e, fn) { let s = this._h.get(e); if (!s) this._h.set(e, s = new Set()); s.add(fn); return () => s.delete(fn); }
  emit(e, ...a) {
    const s = this._h.get(e); if (!s) return;
    for (const fn of [...s]) { try { fn(...a); } catch (err) { console.error('[bus]', e, err); } }
  }
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;
export function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function hexToRgb01(hex) { const n = parseInt(String(hex).replace('#', ''), 16) || 0; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
export function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function hexToLinear(hex) { return hexToRgb01(hex).map(srgbToLinear); }
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function fmtAgo(sec) { sec = Math.max(0, sec | 0); if (sec < 60) return sec + 's'; if (sec < 3600) return Math.floor(sec / 60) + 'm'; return Math.floor(sec / 3600) + 'h'; }
export const isTouch = () => matchMedia('(pointer: coarse)').matches;
