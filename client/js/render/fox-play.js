// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Playing with a fox in the browser (2026-11-24, the product owner: the fox "playful, interactable"). The foxes' minds
// are on the server (server/world/fox.js); their poses and acts are drawn by render/wildlife.js. Here:
//   - walking up to a fox in Play: E — 🦊 Play with the fox, which opens a small card: 🤚 Pet, 🍖 Treat, 🪵 Throw a
//     stick (where the player faces), 🏃 Chase me, 👋 Bye — it trots off home and leaves them be for a while (keys 1-5
//     while it is open; Esc or walking away closes it);
//   - what the fox thinks of the player (its trust, ♥ out of 5, from the server's answer 'foxr');
//   - the stick: thrown in an arc, lying in the grass, carried crosswise in the fox's mouth back to the player.
import * as THREE from 'three';
import { h, esc } from '../core/util.js';
import { CLIP } from './anim.js';
import { bus } from '../core/state.js';

let app = null, shared = null, E = null, open = null, stickMesh = null;
const trust = new Map();   // fox key → trust 0..5 (the server's last word)
const MOUTH = [0.36, 0.42];   // m at size 1: where a fox holds a stick (ahead of and above its feet' middle)
const ACTS = [['pet', '🤚', 'Pet'], ['treat', '🍖', 'Give a treat'], ['fetch', '🪵', 'Throw a stick'], ['chase', '🏃', 'Chase me!'], ['bye', '👋', 'Bye']];
const SAY = {
  pet: ['It trots over for a scratch behind the ears', 'It flops over for a belly rub'],
  treat: ['It sits nicely, takes the treat — and hops for joy'],
  fetch: ['Fetch! It races after the stick'],
  chase: ['It bows, then darts off — catch me if you can!'],
  bye: ['It gives you a last look and trots off home'],
};
const WHY = { 'too far': 'Get a little closer to the fox', water: 'The stick would land in the water — face dry land', 'on foot': 'Get out and walk up to it first', 'no such fox': 'The fox wandered off' };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _x = new THREE.Vector3(1, 0, 0);

export function init(a, sh) {
  app = a; shared = sh;
  (app.playerTargets ||= []).push(target);
  app.hooks?.key?.unshift(onKey);
  bus.on('msg:foxr', answer); bus.on('frame', frame); bus.on('mode', m => { if (m !== 'play') close(); });
}

/** The foxes the page draws now: [{ h (herd), i, x, z, y, yaw, sc }]. */
function foxes() {
  const out = [];
  for (const hd of shared.herds.values()) if (hd.sp.behaviour === 'play') hd.pos.forEach((p, i) => { if (p && p.x != null) out.push({ h: hd, i, ...p }); });
  return out;
}
const keyOf = f => `${f.h.id}:${f.i}`;
const hearts = v => { const n = Math.round(Math.max(0, Math.min(5, v || 0))); return '♥'.repeat(n) + '♡'.repeat(5 - n); };

/** The player's E-target (player/player.js playerTargets): the nearest fox within reach. */
function target(P) {
  if (P.ctx !== -1 || P.state !== 'walk' || app.driving?.id) return null;
  let best = null, bd = 3.6;
  for (const f of foxes()) { const d = Math.hypot(f.x - P.x, f.z - P.z); if (d < bd) { bd = d; best = f; } }
  if (!best) return null;
  const t = trust.get(keyOf(best));
  return { d: bd, html: `🦊 Play with the fox${t != null ? ` <span class="dim">${hearts(t)}</span>` : ''}`, act: () => show(best) };
}

function show(f) {
  open = { id: f.h.id, i: f.i };
  app.cam?.unlockMouse?.();   // (the card is clicked: the mouse is the person's again)
  if (!E) {
    E = document.body.appendChild(h(`<div id="fox-card" class="panel hidden" style="position:fixed;left:50%;bottom:132px;transform:translateX(-50%);z-index:40;min-width:260px;padding:10px 12px">
      <div class="row" style="justify-content:space-between;align-items:center;gap:8px"><b class="fx-t">🦊 Red fox</b><button class="btn small icon x" title="Close (Esc)">✕</button></div>
      <div class="hint fx-h" style="margin:4px 0 8px"></div>
      <div class="fx-b" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${ACTS.map(([k, ic, l], n) => `<button class="btn" data-a="${k}" title="${esc(k === 'bye' ? 'Bye — it goes home and stops following you for a while' : l)} (${n + 1})"${k === 'bye' ? ' style="grid-column:1 / -1"' : ''}>${ic} ${esc(l)} <span class="dim">${n + 1}</span></button>`).join('')}</div></div>`));
    E.querySelector('.x').onclick = close;
    E.querySelector('.fx-b').onclick = e => { const b = e.target.closest('[data-a]'); if (b) act(b.dataset.a); };
  }
  refresh();
  E.classList.remove('hidden');
}
function refresh() {
  if (!E || !open) return;
  const t = trust.get(`${open.id}:${open.i}`);
  E.querySelector('.fx-t').textContent = `🦊 Red fox  ${hearts(t ?? 0)}`;
  E.querySelector('.fx-h').textContent = t == null || t < 1 ? 'A little shy. Be kind and it will learn to trust you.' : t < 3 ? 'It likes you. It will come and greet you now.' : 'Your friend — it runs to meet you and rolls over for belly rubs.';
}
function close() { open = null; E?.classList.add('hidden'); }

function act(kind) {
  const P = app.player, f = open && foxes().find(x => x.h.id === open.id && x.i === open.i);
  if (!P?.active || !f) { close(); return; }
  const m = { t: 'fox', id: f.h.id, k: f.i, act: kind }, faced = P.yaw;
  if (kind === 'fetch') {
    // thrown the way the player faces (12 m), then they turn to watch the fox go
    m.x = P.x + Math.sin(faced) * 12; m.z = P.z + Math.cos(faced) * 12;
  } else P.yaw = P.tyaw = Math.atan2(f.x - P.x, f.z - P.z);   // (turned to the fox)
  if (!app.net?.send?.(m)) { app.toast?.('Not connected', 'bad', 1800); return; }
  const clip = { pet: CLIP.use, treat: CLIP.use, fetch: CLIP.wave, chase: CLIP.cheer, bye: CLIP.wave }[kind];
  if (clip != null) P.emote = { name: `fox_${kind}`, clip, t0: performance.now() / 1000, dur: kind === 'fetch' ? 1.2 : 1.8 };
  if (kind === 'bye') close();
}
function answer(r) {
  if (!r) return;
  if (open && r.trust != null) { trust.set(`${open.id}:${open.i}`, r.trust); refresh(); }
  if (r.ok) { const L = SAY[r.act]; if (L) app.toast?.(`🦊 ${L[r.act === 'pet' && (r.trust || 0) >= 1.5 ? 1 : 0] || L[0]}`, '', 2400); }
  else if (r.why && r.why !== 'busy') app.toast?.(`🦊 ${WHY[r.why] || r.why}`, 'warn', 2200);
}
function onKey(e) {
  if (!open || !E || E.classList.contains('hidden')) return false;
  if (e.code === 'Escape') { close(); return true; }
  const n = /^Digit([1-5])$/.exec(e.code);
  if (n) { if (!e.repeat) act(ACTS[+n[1] - 1][0]); return true; }
  return false;
}

// ------------------------------------------------------------------ the stick
function stick() {
  if (stickMesh) return stickMesh;
  const g = new THREE.CylinderGeometry(0.018, 0.024, 0.55, 6); g.rotateZ(Math.PI / 2);   // (along x)
  stickMesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.95 }), 16);
  stickMesh.count = 0; stickMesh.frustumCulled = false; stickMesh.name = 'fox-sticks';
  app.stage.scene.add(stickMesh);
  return stickMesh;
}
function frame() {
  if (!app?.stage || shared.off == null) return;
  // the card closes when the player walks away from its fox
  if (open) {
    const P = app.player, f = foxes().find(x => x.h.id === open.id && x.i === open.i);
    if (!P?.active || !f || Math.hypot(f.x - P.x, f.z - P.z) > 16) close();
  }
  const wt = performance.now() / 1000 + shared.off; let n = 0;
  for (const hd of shared.herds.values()) {
    const k = hd.k; if (!k || hd.sp.behaviour !== 'play') continue;
    const M = stick(); if (n >= 16) break;
    const [state, x0, z0, x1, z1, t0, t1, by] = k, gh = (x, z) => app.terrain?.pointHeight?.(x, z) ?? 0;
    if (state === 1) {
      const u = t1 > t0 ? Math.min(1, Math.max(0, (wt - t0) / (t1 - t0))) : 1, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u;
      const y = gh(x0, z0) * (1 - u) + gh(x1, z1) * u + 1.3 * (1 - u) + 3.2 * u * (1 - u) + 0.03 * u;
      _q.setFromAxisAngle(_up, Math.atan2(-(z1 - z0), x1 - x0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), wt * 11));
      _m.compose(_p.set(x, y, z), _q, _s);
    } else if (state === 3 && hd.pos[by]?.x != null) {
      const f = hd.pos[by], fx = Math.cos(f.yaw), fz = -Math.sin(f.yaw);
      _q.setFromAxisAngle(_up, f.yaw + Math.PI / 2);
      _m.compose(_p.set(f.x + fx * MOUTH[0] * f.sc, (f.y ?? gh(f.x, f.z)) + MOUTH[1] * f.sc, f.z + fz * MOUTH[0] * f.sc), _q, _s);
    } else {
      _q.setFromAxisAngle(_up, (x1 * 7.3 + z1 * 3.1) % 6.283);
      _m.compose(_p.set(x1, gh(x1, z1) + 0.025, z1), _q, _s);
    }
    M.setMatrixAt(n++, _m);
  }
  if (stickMesh) { stickMesh.count = n; stickMesh.visible = n > 0; if (n) stickMesh.instanceMatrix.needsUpdate = true; }
}
