// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Terrain section of the edit dock (WP4.7, wp4-world-spec.md §9): administrators reshape the land beyond the city
// with a brush - raise, lower, flatten to the height where they click, dig a pond, clear woodland or plant it. A ring
// on the ground shows the brush (its soft edge inside), green where the change may go and red with the reason where it
// may not (the same rules the server checks, shared/terrain-rules.js). A click sends the stroke (/api/edit
// terrain.add); undo takes it back. Works while the section is open, in any mode but driving.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { post } from '../core/net.js';
import { EDIT_KINDS, EDIT_LIMITS, normalizeEdit } from '/shared/terrain-edits.js';
import { terrainWhy } from '/shared/terrain-rules.js';

const FT = 0.3048;
const T = { kind: null, sizeFt: 120, amountFt: 10, depthFt: 8, soft: 0.5, ok: false, reason: '', at: null, busy: false };
let app = null, cam = null, E = {}, ring = null, ptr = { x: 0, y: 0, moved: false };

export function init(a) {
  app = a; cam = a.cam;
  const slot = a.docks && a.docks.slot('l:terrain');
  if (!slot) return;
  slot.appendChild(h(`<div class="ttools">
    <p class="hint">Reshape the land beyond the city. A change never touches the city, a road, a building or a lot someone holds; undo takes it back.</p>
    <div class="chips tkinds">${Object.entries(EDIT_KINDS).map(([k, d]) => `<span class="chip" data-k="${k}">${d.icon} ${esc(d.label)}</span>`).join('')}</div>
    <div class="field"><label>Size <b class="tsv"></b></label><input type="range" class="tsize" min="${Math.ceil(EDIT_LIMITS.minR * 2 / FT)}" max="${Math.floor(EDIT_LIMITS.maxR * 2 / FT)}" step="5"></div>
    <div class="field tamtf"><label>Height <b class="tav"></b></label><input type="range" class="tamt" min="1" max="${Math.floor(EDIT_LIMITS.maxAmount / FT)}" step="1"></div>
    <div class="field tdepf"><label>Depth <b class="tdv"></b></label><input type="range" class="tdep" min="${Math.ceil(EDIT_LIMITS.minDepth / FT)}" max="${Math.floor(EDIT_LIMITS.maxDepth / FT)}" step="1"></div>
    <div class="field"><label>Edge <b class="tev"></b></label><input type="range" class="tsoft" min="0" max="100" step="5"></div>
    <p class="hint tstat">Pick a tool, then click the ground. Esc puts the tool down.</p></div>`));
  const q = s => slot.querySelector(s);
  E = { kinds: q('.tkinds'), size: q('.tsize'), amt: q('.tamt'), dep: q('.tdep'), soft: q('.tsoft'), sv: q('.tsv'), av: q('.tav'), dv: q('.tdv'), ev: q('.tev'), amtF: q('.tamtf'), depF: q('.tdepf'), stat: q('.tstat') };
  E.kinds.onclick = e => { const c = e.target.closest('[data-k]'); if (c) setKind(T.kind === c.dataset.k ? null : c.dataset.k); };
  E.size.oninput = () => { T.sizeFt = +E.size.value; sync(); };
  E.amt.oninput = () => { T.amountFt = +E.amt.value; sync(); };
  E.dep.oninput = () => { T.depthFt = +E.dep.value; sync(); };
  E.soft.oninput = () => { T.soft = +E.soft.value / 100; sync(); };
  sync();
  ring = new THREE.Group(); ring.name = 'terrain-brush'; ring.visible = false; a.stage.scene.add(ring);
  app.hooks.click.unshift(onClick); app.hooks.key.unshift(onKey); app.hooks.hover.unshift(() => !!T.kind);
  const canvas = a.stage.renderer.domElement;
  canvas.addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = true; });
  bus.on('frame', frame);
  bus.on('mode', m => { if (m === 'play' || m === 'furnish') setKind(null); });
  bus.on('terrain', () => { ptr.moved = true; });
}
const can = () => !!auth.account && auth.can('world.edit') && !!S.world.terrain;
const open = () => app.docks?.isOpen?.('l:terrain') ?? true;
function say(text, bad = false) { E.stat.textContent = text; E.stat.classList.toggle('bad', bad); }
function sync() {
  E.size.value = String(T.sizeFt); E.amt.value = String(T.amountFt); E.dep.value = String(T.depthFt); E.soft.value = String(Math.round(T.soft * 100));
  E.sv.textContent = `${T.sizeFt} ft across`; E.av.textContent = `${T.amountFt} ft`; E.dv.textContent = `${T.depthFt} ft`; E.ev.textContent = T.soft < 0.15 ? 'sharp' : T.soft > 0.75 ? 'very soft' : 'soft';
  const K = T.kind ? EDIT_KINDS[T.kind] : null;
  E.amtF.classList.toggle('hidden', !K || !K.amount); E.depF.classList.toggle('hidden', !K || !K.depth);
  for (const c of E.kinds.children) c.classList.toggle('on', c.dataset.k === T.kind);
  ptr.moved = true;
}
function setKind(k) {
  if (k && !can()) { say('Only administrators change the land (on an island world).', true); return; }
  if (k && (S.mode === 'play' || S.mode === 'furnish')) app.setMode('explore');
  T.kind = k; ring.visible = false; sync();
  if (!k) say('Pick a tool, then click the ground. Esc puts the tool down.');
}
/** The stroke the brush would make at ground point p. */
function stroke(p) {
  const o = { kind: T.kind, x: p.x, z: p.z, r: T.sizeFt * FT / 2, soft: T.soft };
  if (T.kind === 'raise' || T.kind === 'lower') o.amount = T.amountFt * FT;
  if (T.kind === 'flatten') o.level = p.y;
  if (T.kind === 'reclaim') o.level = app.terrain.params.seaLevel + 1.6;   // new land just above the sea
  if (T.kind === 'pond') o.depth = T.depthFt * FT;
  return normalizeEdit(o);
}
function check(rec) {
  const G = app.terrain?.ground; if (!G) return 'The island is still loading';
  return terrainWhy(S.world, { ...rec }, { island: G.island, lots: app.lots?.lots || [] });
}
function frame() {
  if (!T.kind || !ptr.moved || !open()) { if (T.kind && !open()) ring.visible = false; return; }
  ptr.moved = false;
  const p = app.terrain?.rayHit(cam.rayAt(ptr.x, ptr.y));
  if (!p) { ring.visible = false; return; }
  const rec = stroke(p);
  T.at = p;
  T.reason = rec instanceof Error ? rec.message : check(rec) || ''; T.ok = !T.reason;
  drawRing(p, rec instanceof Error ? T.sizeFt * FT / 2 : rec.r, T.ok);
  if (performance.now() < (T.keepMsg || 0)) return;   // the last result stays readable for a moment
  say(T.ok ? `${EDIT_KINDS[T.kind].icon} Click to ${EDIT_KINDS[T.kind].label.toLowerCase()} here · Esc puts the tool down` : `⚠️ ${T.reason}`, !T.ok);
}
function drawRing(p, r, ok) {
  for (const m of [...ring.children]) { ring.remove(m); m.geometry.dispose(); m.material.dispose(); }
  const Tr = app.terrain, col = ok ? 0x5ee08f : 0xff6b6b;
  for (const [rr, op] of [[r, 1], [r * (1 - T.soft), 0.45]]) {
    if (rr < 0.5) continue;
    const pts = [];
    for (let k = 0; k <= 64; k++) { const a = k / 64 * Math.PI * 2, x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr; pts.push(new THREE.Vector3(x, Math.max(Tr.params.seaLevel, Tr.heightAt(x, z)) + 0.5, z)); }
    const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, depthTest: false }));
    m.renderOrder = 8; ring.add(m);
  }
  ring.visible = true;
}
/** Click hook (synchronous: true when the click was this tool's). */
function onClick() {
  if (!T.kind || !open() || S.mode === 'play') return false;
  if (!T.at) return true;
  if (!T.ok) { app.toast?.(T.reason || 'Not there', 'bad', 2000); return true; }
  if (T.busy) return true;
  const rec = stroke(T.at); if (rec instanceof Error) return true;
  T.busy = true; say('Shaping…');
  post('/api/edit', { ops: [{ op: 'terrain.add', edit: rec }] })
    .then(r => { if (r && r.ok === false) throw new Error(r.error || 'That change did not work'); say(`${EDIT_KINDS[rec.kind].icon} Done. Ctrl+Z takes it back.`); T.keepMsg = performance.now() + 3000; })
    .catch(err => { say(err.message, true); T.keepMsg = performance.now() + 4000; })
    .finally(() => { T.busy = false; ptr.moved = true; });
  return true;
}
function onKey(e) {
  if (!T.kind) return false;
  if (e.key === 'Escape') { setKind(null); return true; }
  if (e.key === '[' || e.key === ']') { T.sizeFt = Math.max(+E.size.min, Math.min(+E.size.max, T.sizeFt + (e.key === ']' ? 20 : -20))); sync(); return true; }
  return false;
}
