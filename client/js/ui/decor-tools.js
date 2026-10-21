// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Decorating outdoors (WP4.7, shared/decor.js): in the Outside spaces section lot holders place trees, bushes, flower
// beds, benches, picnic tables and fountains on their own lots (administrators also on public land). A ghost follows
// the pointer, green where it may go and red with the reason where it may not (the land's rules and the lots, as the
// server checks them); R turns it, a click places it. With no item picked, clicking a decoration selects it to turn,
// move or remove. Changes go through /api/edit (deco.add / deco.move / deco.del) and can be undone.
// The same placer serves the Marketing tools (ui/marketing.js: billboards and street signs, administrators only):
// makeDecorTool() builds one into a dock section, for its own kinds of decoration.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { post } from '../core/net.js';
import { CATALOG } from '/shared/catalog.js';
import { DECOR_TYPES, DECOR_TINTS, DECOR_ADMIN_ONLY, normalizeDecor, checkDecor, decorCorners, decorBase } from '/shared/decor.js';
import { isAdAsset } from '/shared/signs.js';
import { makeGrid } from '/shared/city.js';
import { lotState } from '../render/lots.js';
import { DecorLayer } from '../render/decor.js';
import { furnitureGeometry } from '../render/furniture.js';

let app = null;
const name = t => CATALOG[t]?.name || t;

export function init(a) {
  app = a;
  app.decor = new DecorLayer(a);
  app.decor.set(S.world.decorations || []);
  bus.on('decor', () => app.decor.set(S.world.decorations || []));
  bus.on('terrain', () => app.decor.set(S.world.decorations || []));
  bus.on('ground', () => app.decor.set(S.world.decorations || []));   // (the ground reshaped under them: a new dock's benches on its land, not the old ground)
  const slot = a.docks && a.docks.slot('l:outside');
  if (!slot) return;
  makeDecorTool(a, {
    slot, dock: 'l:outside', kinds: DECOR_TYPES.filter(t => !isAdAsset(t)), owns: d => !isAdAsset(d.t),
    may: () => !!auth.account && (auth.can('world.edit') || auth.can('property.hold')), signIn: 'Sign in to decorate your lot.',
    html: `<div class="sep"></div><h5>🌳 Decorate</h5>
      <p class="hint">Place trees, flowers and benches on your lot (administrators also on public land). R turns it; click one you placed to move or remove it.</p>`,
  });
}

/**
 * A placer in a dock section. cfg: { slot (the section's body), dock (its key: the tool works while it is open),
 * kinds (decoration types offered), owns(d) (the decorations it selects), may() (whether the viewer may use it),
 * signIn (said otherwise), html (the heading), chips (false: the caller offers the kinds itself), onSelect(d) (the
 * caller's extra controls for a selected one) }. Returns { pick(t), select(d), get selected() }.
 */
export function makeDecorTool(a, cfg) {
  const cam = a.cam, D = { t: null, rot: 0, sel: null, moving: null, at: null, ok: false, reason: '', busy: false, keepMsg: 0, grounded: false };
  const ptr = { x: 0, y: 0, moved: false };
  const root = cfg.slot.appendChild(h(`<div class="dpad dtools">${cfg.html || ''}
    ${cfg.chips === false ? '' : `<div class="chips dkinds">${cfg.kinds.map(t => `<span class="chip${DECOR_ADMIN_ONLY.includes(t) && !cfg.adminKinds ? ' hidden' : ''}" data-t="${t}">${esc(name(t))}</span>`).join('')}</div>`}
    <div class="dsel hidden"><div class="row"><b class="dname"></b></div><div class="row"><button type="button" class="btn small dturn">↻ Turn</button><button type="button" class="btn small dmove">✥ Move</button><button type="button" class="btn small danger ddel">🗑 Remove</button></div><div class="dextra"></div></div>
    <p class="hint dstat"></p></div>`));
  const q = s => root.querySelector(s);
  const E = { kinds: q('.dkinds'), sel: q('.dsel'), name: q('.dname'), stat: q('.dstat'), extra: q('.dextra') };
  if (E.kinds) E.kinds.onclick = e => { const c = e.target.closest('[data-t]'); if (c) pick(D.t === c.dataset.t ? null : c.dataset.t); };
  q('.dturn').onclick = () => D.sel && send([{ op: 'deco.move', id: D.sel.id, deco: { ...D.sel, r: (D.sel.r || 0) + Math.PI / 4 } }], 'Turned.');
  q('.dmove').onclick = () => { if (!D.sel) return; D.moving = D.sel; D.rot = D.sel.r || 0; pick(D.sel.t, true); say('Click where it should go. Esc keeps it where it is.'); };
  q('.ddel').onclick = () => D.sel && send([{ op: 'deco.del', id: D.sel.id }], 'Removed.');
  const ghost = new THREE.Group(); ghost.name = 'decor-ghost'; ghost.visible = false; a.stage.scene.add(ghost);
  const mark = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf5c542, depthTest: false, transparent: true }));
  mark.renderOrder = 9; mark.visible = false; a.stage.scene.add(mark);
  a.hooks.click.unshift(onClick); a.hooks.key.unshift(onKey); a.hooks.hover.unshift(() => !!D.t);
  a.stage.renderer.domElement.addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = true; });
  bus.on('mode', m => { if (m === 'play' || m === 'furnish') { pick(null); select(null); } });
  bus.on('decor', () => { if (D.sel) { const now = (S.world.decorations || []).find(d => d.id === D.sel.id); select(now || null, !now); } });
  bus.on('frame', frame);

  const open = () => a.docks?.isOpen?.(cfg.dock) ?? true;
  function say(text, bad = false) { if (!E.stat) return; E.stat.textContent = text; E.stat.classList.toggle('bad', bad); }
  function pick(t, keepMove = false) {
    if (t && !cfg.may()) { say(cfg.signIn || 'You can\'t place these.', true); return; }
    if (!keepMove) D.moving = null;
    D.t = t; ghost.visible = false; ptr.moved = true;
    const T = t && DECOR_TINTS[t]; D.tint = T ? T[Math.floor(Math.random() * T.length)] : null;   // a colour each, for variety; moving keeps it
    if (keepMove && D.moving?.c) D.tint = D.moving.c;
    if (E.kinds) for (const c of E.kinds.children) c.classList.toggle('on', c.dataset.t === t);
    if (t) { select(null, true); buildGhost(t); say(`Point at the ground for the ${name(t).toLowerCase()}. R turns it, Esc puts it down.`); }
  }
  function buildGhost(t) {
    for (const m of [...ghost.children]) { ghost.remove(m); m.material.dispose(); }
    const G = furnitureGeometry(t);
    for (const geo of [G.geo, G.glass]) if (geo) { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x5ee08f, transparent: true, opacity: 0.55, depthWrite: false })); m.renderOrder = 8; ghost.add(m); }
  }
  function select(d, quiet = false) {
    D.sel = d; mark.visible = !!d;
    if (d) { const R = CATALOG[d.t]?.rect || [-1, -1, 1, 1], k = Math.max(1, Math.hypot(R[2] - R[0], R[3] - R[1]) / 3); mark.scale.set(k, 1, k); mark.position.set(d.x, a.decor.y(d.x, d.z) + 0.08, d.z); E.name.textContent = name(d.t); }
    E.sel?.classList.toggle('hidden', !d);
    if (E.extra) { E.extra.innerHTML = ''; if (d && cfg.onSelect) cfg.onSelect(d, E.extra); }
    if (!quiet && !d) say('');
  }
  /** Why the decoration can't go there: the land's rules, then whose lot it is (as the server checks). */
  function reason(d) {
    if (DECOR_ADMIN_ONLY.includes(d.t) && !auth.can('world.edit')) return 'Only administrators put up billboards and street signs';
    const T = a.terrain, g = makeGrid(S.world.grid);
    const why = checkDecor(d, { isWater: T?.ground ? (x, z) => T.isWater(x, z) : null, roads: T?.roadNet || null, city: g, buildings: S.world.buildings, decorations: S.world.decorations || [] }, D.moving?.id ?? null);
    if (why) return why;
    const L = a.lots; if (!L || !L.lots.length) return auth.can('world.edit') ? '' : 'Only administrators decorate this world';
    const lots = (isAdAsset(d.t) ? decorBase(d) : decorCorners(d)).map(p => L.at(p.x, p.z));
    if (lots.some(l => !l)) return lots.every(l => !l) ? (auth.can('world.edit') ? '' : 'Place it on a lot you hold') : 'Keep it inside one lot';
    if (lots.some(l => l.id !== lots[0].id)) return 'Keep it inside one lot';
    if (isAdAsset(d.t)) {   // the Marketing tools' items: on public land or the city's lots that aren't for sale
      if (lots[0].holder?.kind !== 'municipality') return `Lot ${lots[0].id} is held by a player`;
      if (!['municipal', 'unreleased'].includes(lots[0].lifecycle)) return `Lot ${lots[0].id} is ${lots[0].lifecycle === 'available' ? 'for sale' : lots[0].lifecycle}`;
      return '';
    }
    const st = lotState(lots[0], auth.account?.id);
    if (st === 'mine' || (lots[0].holder?.kind === 'municipality' && auth.can('world.edit'))) return '';
    return `Lot ${lots[0].id} isn't yours`;
  }
  function frame() {
    if (!D.grounded && a.terrain?.ground) { D.grounded = true; a.decor.set(S.world.decorations || []); }   // the island's heights arrived
    if (!D.t || !ptr.moved) return;
    if (!open()) { ghost.visible = false; return; }
    ptr.moved = false;
    const p = a.terrain?.rayHit(cam.rayAt(ptr.x, ptr.y)) || cam.groundAt(ptr.x, ptr.y, 0.15);
    if (!p) { ghost.visible = false; return; }
    const d = normalizeDecor({ t: D.t, x: p.x, z: p.z, r: D.rot, c: D.tint });
    if (d instanceof Error) return;
    D.at = d; D.reason = reason(d); D.ok = !D.reason;
    ghost.position.set(d.x, a.decor.y(d.x, d.z) + 0.02, d.z); ghost.rotation.set(0, d.r, 0); ghost.visible = true;
    for (const m of ghost.children) m.material.color.set(D.ok ? 0x5ee08f : 0xff6b6b);
    if (performance.now() < D.keepMsg) return;   // the last result stays readable for a moment
    say(D.ok ? `✅ Click to place the ${name(D.t).toLowerCase()} · R turns it` : `⚠️ ${D.reason}`, !D.ok);
  }
  async function send(ops, done) {
    if (D.busy) return null;
    D.busy = true;
    try {
      const r = await post('/api/edit', { ops });
      if (r && r.ok === false) throw new Error(r.error || 'That did not work');
      say(done); D.keepMsg = performance.now() + 2500;
      return r;
    } catch (err) { say(err.message, true); D.keepMsg = performance.now() + 4000; a.toast?.(err.message, 'bad', 2400); return null; }
    finally { D.busy = false; ptr.moved = true; }
  }
  /** Click hook (synchronous: true when the click was this tool's). */
  function onClick(e) {
    if (S.mode === 'play' || !open()) return false;
    if (D.t) {
      if (!D.at) return true;
      if (!D.ok) { a.toast?.(D.reason || 'Not there', 'bad', 2000); return true; }
      const mv = D.moving;
      const at = mv?.hc ? { ...D.at, hc: mv.hc } : D.at;
      send([mv ? { op: 'deco.move', id: mv.id, deco: at } : { op: 'deco.add', deco: at }], mv ? 'Moved.' : `Placed a ${name(D.t).toLowerCase()}. Ctrl+Z takes it back.`).then(r => { if (r && mv) pick(null); });
      return true;
    }
    // nothing picked: select one of its decorations under the pointer
    const p = a.terrain?.rayHit(cam.rayAt(e.clientX, e.clientY)) || cam.groundAt(e.clientX, e.clientY, 0.15);
    const d = p && nearest(p.x, p.z);
    if (d) { select(d); say(`${name(d.t)} - turn, move or remove it.`); return true; }
    if (D.sel) select(null);
    return false;
  }
  function nearest(x, z) {
    let best = null, bd = Infinity;
    for (const d of S.world.decorations || []) {
      if (!cfg.owns(d)) continue;
      const R = CATALOG[d.t]?.rect || [-1, -1, 1, 1], reach = Math.max(1.6, Math.min(R[2] - R[0], 8) / 2), dd = Math.hypot(d.x - x, d.z - z);
      if (dd < reach && dd < bd) { bd = dd; best = d; }
    }
    return best;
  }
  function onKey(e) {
    if (!D.t && !D.sel) return false;
    if (e.key === 'Escape') { pick(null); select(null); return true; }
    if (D.t && (e.key === 'r' || e.key === 'R')) { D.rot += (e.shiftKey ? -1 : 1) * Math.PI / 4; ptr.moved = true; return true; }
    if (D.sel && !D.t && (e.key === 'Delete' || e.key === 'Backspace')) { send([{ op: 'deco.del', id: D.sel.id }], 'Removed.'); return true; }
    return false;
  }
  return { pick, select, send, say, get selected() { return D.sel; }, get picking() { return D.t; } };
}
