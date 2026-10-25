// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Using an agent's PC on its screen in the world (docs/features/agent-pc.md §2): the camera glides up to the monitor (or
// the laptop) until it fills the view, square on, the agent's body set aside (render/agents.js hideFn) — and the PC
// (./pc-app.js) is put exactly on the screen, live and usable, the world still drawing around it. On a narrow screen (a
// phone) it fills the screen instead, once the camera is there. Escape, its ✕, or a click on the world beside it leaves:
// the camera glides back to where it was. Only the agent's own account ever gets here (the screens are drawn for it alone,
// and the server answers no one else).
import * as THREE from 'three';
import { S, setFocus } from '../core/state.js';
import { mountPc, openPcWindow } from './pc-app.js';

let cur = null;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export const pcInUse = () => !!cur;

/** Uses agent `agent`'s PC on its screen (quad: { M, kind, i } from render/pc-screens.js, else found here). */
export async function usePc(app, agent, quad = null) {
  if (cur) leavePc();
  const ps = app.pcScreens;
  let q = quad;
  if (!q && ps) {
    const a = ps.mine.get(Number(agent));
    if (a) {
      q = ps.quadOf(a);
      // not in view: its desk's floor is looked into, then its screen is found there
      if (!q && a.desk) { setFocus(a.desk.b, a.desk.f); for (let k = 0; k < 20 && !q; k++) { await new Promise(r => requestAnimationFrame(r)); q = ps.quadOf(a); } }
    }
  }
  if (!q) { openPcWindow(Number(agent), { lock: false, toast: app.toast || (() => {}) }); return; }
  const cam = app.cam, camera = app.stage.camera;
  const M = q.M.clone();
  const c = new THREE.Vector3().setFromMatrixPosition(M);
  const xA = new THREE.Vector3().setFromMatrixColumn(M, 0), yA = new THREE.Vector3().setFromMatrixColumn(M, 1), zA = new THREE.Vector3().setFromMatrixColumn(M, 2);
  const w = xA.length(), h = yA.length(), n = zA.normalize();
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), aspect = innerWidth / Math.max(1, innerHeight);
  const dist = Math.max(0.22, (h / 0.86) / (2 * tan), (w / 0.94) / (2 * tan * aspect));
  const pos = c.clone().addScaledVector(n, dist);
  cam.pinTo(pos, c);
  app.agents.hideFn = (i, x, y, z) => i === q.i || ((x - pos.x) ** 2 + (z - pos.z) ** 2 < 0.8 * 0.8 && pos.y - y < 2.2 && pos.y - y > -0.5);
  const wrap = document.createElement('div');
  wrap.className = 'pc-onscreen';
  wrap.innerHTML = '<div class="pc-onscreen-pc"></div><button class="pc-leave" title="Back to the world (Esc)">✕ Leave the PC</button>';
  document.body.append(wrap);
  const host = wrap.querySelector('.pc-onscreen-pc');
  const s = cur = { app, agent: Number(agent), M, wrap, host, pc: null, full: false };
  const corners = [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]];   // top-left, top-right, bottom-left, bottom-right
  const place = () => {
    if (cur !== s) return;
    if (!cam.pinned) { s.wrap.classList.remove('on'); requestAnimationFrame(place); return; }
    const r = app.stage.renderer.domElement.getBoundingClientRect();
    const P = corners.map(([u, v]) => { _a.set(u, v, 0).applyMatrix4(s.M).project(camera); return [r.left + (_a.x + 1) / 2 * r.width, r.top + (1 - _a.y) / 2 * r.height]; });
    const W = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), Hh = Math.hypot(P[2][0] - P[0][0], P[2][1] - P[0][1]);
    const full = innerWidth < 760 || W < 560;
    if (!s.pc) { s.pc = mountPc(host, { agent: s.agent, lock: true, toast: app.toast || (() => {}), onClose: leavePc }); }
    s.wrap.classList.toggle('full', full);
    if (full) { host.style.cssText = ''; }
    else {
      // the PC as big as the screen looks, put exactly on it (a projective transform from its box to the screen's corners)
      host.style.width = `${Math.round(W)}px`; host.style.height = `${Math.round(Hh)}px`;
      host.style.transform = `matrix3d(${toQuad(W, Hh, P).join(',')})`;
    }
    s.wrap.classList.add('on');
    requestAnimationFrame(place);
  };
  requestAnimationFrame(place);
  s.key = e => {
    if (e.key !== 'Escape' || cur !== s) return;
    if (e.target.closest?.('.pc input, .pc textarea, .pc select, .pc-pop, .psc-view')) return;   // (an agent's own screen: its keys)
    e.stopPropagation(); e.preventDefault(); leavePc();
  };
  s.away = e => { if (cur === s && cam.pinned && !wrap.contains(e.target) && !e.target.closest?.('.pc-pop')) leavePc(); };
  document.addEventListener('keydown', s.key, true);
  app.stage.renderer.domElement.addEventListener('pointerdown', s.away, true);
  wrap.querySelector('.pc-leave').addEventListener('click', leavePc);
}

/** Back to the world: the PC put away, the camera glides back, the agent's body drawn again once the camera is away. */
export function leavePc() {
  const s = cur;
  if (!s) return;
  cur = null;
  try { s.pc?.destroy(); } catch { /* closing */ }
  s.wrap.remove();
  document.removeEventListener('keydown', s.key, true);
  s.app.stage.renderer.domElement.removeEventListener('pointerdown', s.away, true);
  s.app.cam.unpin();
  setTimeout(() => { if (!cur) s.app.agents.hideFn = null; }, 450);
}

/** The CSS matrix3d (column-major) that takes a w × h box onto the four points P (top-left, top-right, bottom-left,
 *  bottom-right; page pixels): the square-to-quad homography, scaled to the box. */
export function toQuad(w, h, P) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = P;
  // unit square (0,0)(1,0)(0,1)(1,1) → P0 P1 P2 P3
  const dx1 = x1 - x3, dx2 = x2 - x3, dy1 = y1 - y3, dy2 = y2 - y3, sx = x0 - x1 - x2 + x3, sy = y0 - y1 - y2 + y3;
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x2 - x0 + hh * x2, c = x0, d = y1 - y0 + g * y1, e = y2 - y0 + hh * y2, f = y0;
  // scaled from the box's pixels to the unit square
  const A = a / w, B = b / h, D = d / w, E = e / h, G = g / w, Hc = hh / h;
  return [A, D, 0, G, B, E, 0, Hc, 0, 0, 1, 0, c, f, 0, 1];
}
void S; void _b;
