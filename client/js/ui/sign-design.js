// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Designing signs (both editions; shared/signs.js): an owner's rooftop billboards (building settings: at most two, on
// an edge of the roof, small, medium or large for the roof; the owner's own design), an owner's sign inside (furniture:
// its size and the owner's design), and the Marketing tools' own content for a billboard or a street sign. Every design is made with the designer (ui/designer.js); changes go through /api/edit and can be
// undone like any edit.
import { S, bus, bld } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { post } from '../core/net.js';
import { CATALOG } from '/shared/catalog.js';
import { ROOF_SIGN_MAX, ROOF_EDGES, roofSignFrame, INDOOR_SIGNS, AD_ASSETS, stylesOf, signFace, signSize, signLimits, signShape, signGeoKey, SIGN_ACCENT, SIGN_LIGHTS } from '/shared/signs.js';
import { checkItem } from '/shared/edit.js';
import { signThumbs } from '../render/sign-thumbs.js';
import { designer } from './designer.js';

const EDGE = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' };
const EDGE_HINT = { front: 'The door side, over the street', back: 'Away from the street', left: 'The left side, seen from the street', right: 'The right side, seen from the street' };
// where a new billboard goes first: the sides seen from the street before the back
const EDGE_ORDER = ['front', 'left', 'right', 'back'];
const SIZE = { s: 'Small', m: 'Medium', l: 'Large' };

function dialog(title, cls = 'signdlg', onClose = null) {
  const el = document.body.appendChild(h(`<div class="modal-back lib-back shop-back"><div class="panel libdlg shopdlg adbuild ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}"></div></div>`));
  const box = el.querySelector(`.${cls}`);
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-c="close"]')) close(); });
  return { el, box, close };
}
async function send(app, ops, done) {
  try {
    const r = await post('/api/edit', { ops, who: 'web' });
    if (r && r.ok === false) throw new Error(r.error || 'That change did not work');
    if (done) app.toast(done, 'good', 2400);
    return r;
  } catch (e) { app.toast(e.message || String(e), 'bad', 3200); return null; }
}

// ------------------------------------------------------------------ rooftop billboards
/** The rooftop billboards of building b. */
export function editRoofSigns(app, b) {
  const B = bld(b); if (!B) return;
  if (B.type === 'park') { app.toast('Parks have no roof', 'bad'); return; }
  const list = (B.roofSigns || []).map(x => ({ ...x }));
  // The building shows the billboards where they would go while the dialog is open (2026-10-09: "choose where
  // billboards 1 and 2 go"); closing without saving puts the roof back as it was.
  const before = B.roofSigns, show = signs => { B.roofSigns = signs; app.blds?.rebuildFor(b); bus.emit('world', { levels: new Set(), blds: new Set([b]) }); };
  let saved = false;
  const D = dialog('Rooftop billboards', 'signdlg', () => { if (!saved && bld(b) === B) show(before); });
  const designers = [];
  const preview = () => { grab(); show(list.map(x => ({ ...x }))); paintRoof(); };
  /** The roof from above: the door side at the bottom, each billboard where it stands, numbered. */
  const roofSvg = () => {
    const S2 = 100 / Math.max(B.w, B.d), W = B.w * S2, Dd = B.d * S2, ox = (120 - W) / 2, oz = (112 - Dd) / 2;
    const bars = list.map((x, k) => {
      const F = roofSignFrame(B, x), cx = ox + W / 2 + F.lx * S2, cz = oz + Dd / 2 + F.lz * S2, len = F.w * S2, across = x.edge === 'front' || x.edge === 'back';
      const [w, hh] = across ? [len, 4] : [4, len];
      return `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cz - hh / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" rx="1.5" class="rs-bar"/>
        <text x="${(cx + (across ? 0 : x.edge === 'left' ? 8 : -8)).toFixed(1)}" y="${(cz + (across ? (x.edge === 'front' ? -6 : 10) : 3)).toFixed(1)}" class="rs-num">${k + 1}</text>`;
    }).join('');
    return `<svg viewBox="0 0 120 128" class="rs-roof" role="img" aria-label="The roof from above, with your billboards">
      <rect x="${ox.toFixed(1)}" y="${oz.toFixed(1)}" width="${W.toFixed(1)}" height="${Dd.toFixed(1)}" rx="2" class="rs-top"/>${bars}
      <text x="60" y="${(oz + Dd + 11).toFixed(1)}" class="rs-street">▼ door side · street</text></svg>`;
  };
  const paintRoof = () => { const el = D.box.querySelector('.rs-map'); if (el) el.innerHTML = roofSvg(); };
  const render = () => {
    D.box.innerHTML = `<h3><span>🪧 Rooftop billboards · ${esc(B.name)}</span><button type="button" class="btn small" data-c="close" aria-label="Close">✕</button></h3>
      <p class="hint">Your own billboards on the roof (up to ${ROOF_SIGN_MAX}): your name, your business, a message - with a link people can open. They show only what you put on them, never paid ads. Choose the side of the roof for each one: the building shows it as you go.</p>
      ${list.length ? `<div class="rs-map"></div>` : ''}
      ${list.map((x, k) => `<div class="ab-sec" data-k="${k}">
        <div class="row wrap"><b class="ab-h">Billboard ${k + 1}</b>${x.blocked ? `<span class="bad">Hidden by an administrator: ${esc(x.blocked)}</span>` : ''}<button type="button" class="btn small danger" data-a="del" data-k="${k}">🗑 Take it down</button></div>
        <div class="fld rs-side"><span>Side of the roof</span><span class="seg rs-edge" role="radiogroup" aria-label="Billboard ${k + 1}: side of the roof">${ROOF_EDGES.map(e => `<button type="button" class="btn small${x.edge === e ? ' on' : ''}" role="radio" aria-checked="${x.edge === e}" data-edge="${e}" data-k="${k}" title="${EDGE_HINT[e]}">${EDGE[e]}</button>`).join('')}</span></div>
        <div class="row wrap"><span class="seg rs-size">${Object.entries(SIZE).map(([v, l]) => `<button type="button" class="btn small${x.size === v ? ' on' : ''}" data-size="${v}" data-k="${k}">${l}</button>`).join('')}</span>
          <label class="fld">Along the side <input type="range" class="rs-at" data-k="${k}" min="-1" max="1" step="0.05" value="${x.at || 0}"></label></div>
        <div class="rs-designer" data-k="${k}"></div></div>`).join('')}
      ${list.length < ROOF_SIGN_MAX ? '<div class="row"><button type="button" class="btn" data-a="add">＋ Add a rooftop billboard</button></div>' : ''}
      <div class="lib-btns"><button type="button" class="btn" data-c="close">Cancel</button><button type="button" class="btn primary" data-a="save">Save</button></div>`;
    designers.length = 0;
    for (const el of D.box.querySelectorAll('.rs-designer')) { const k = +el.dataset.k; designers[k] = designer(el, { cr: list[k].cr, shapes: ['wide'], placeholder: B.name, captions: { wide: 'Rooftop billboard' } }); }
    paintRoof();
  };
  const grab = () => list.forEach((x, k) => { const v = designers[k]?.value(); x.cr = v instanceof Error ? x.cr : v; });
  D.box.addEventListener('input', e => { if (e.target.classList.contains('rs-at')) { list[+e.target.dataset.k].at = +e.target.value; paintRoof(); } });
  D.box.addEventListener('change', e => { if (e.target.classList.contains('rs-at')) { list[+e.target.dataset.k].at = +e.target.value; preview(); } });
  D.box.addEventListener('click', async e => {
    const t = e.target.closest('[data-a],[data-size],[data-edge]'); if (!t || t.closest('.designer')) return;
    if (t.dataset.edge) { grab(); list[+t.dataset.k].edge = t.dataset.edge; render(); preview(); return; }
    if (t.dataset.size) { grab(); list[+t.dataset.k].size = t.dataset.size; render(); preview(); return; }
    if (t.dataset.a === 'add') { grab(); list.push({ edge: EDGE_ORDER.find(e2 => !list.some(x => x.edge === e2)) || 'front', size: 'm', at: 0, cr: { format: 'logo', title: B.name, backgroundColor: '#ffffff', textColor: '#111827' } }); render(); preview(); return; }
    if (t.dataset.a === 'del') { grab(); list.splice(+t.dataset.k, 1); render(); preview(); return; }
    if (t.dataset.a === 'save') {
      for (const [k, d] of designers.entries()) { const v = d?.value(); if (v instanceof Error) { app.toast(`Billboard ${k + 1}: ${v.message}`, 'bad', 3200); return; } list[k].cr = v; }
      t.disabled = true;
      const r = await send(app, [{ op: 'bld.signs', b, signs: list.map(({ edge, size, at, cr }) => ({ edge, size, at, cr })) }], list.length ? 'Rooftop billboards saved.' : 'Rooftop billboards taken down.');
      if (r) { saved = true; D.close(); } else t.disabled = false;
    }
  });
  render();
}

// ------------------------------------------------------------------ a sign inside
/** The sign item `id` on floor f of building b (its size, its mode, its design). */
/** Shapes a sign's panel can be set to at once (width ÷ height). */
const SHAPES = [['Tall', 0.5, '1:2'], ['Portrait', 2 / 3, '2:3'], ['Square', 1, '1:1'], ['Landscape', 1.5, '3:2'], ['Wide', 16 / 9, '16:9'], ['Banner', 3, '3:1']];
export function editIndoorSign(app, { b, f, id }) {
  const B = bld(b); if (!B) return;
  const lv = B.type === 'park' ? B.lv?.[0] : B.lv?.[f], L = S.world.levels?.[lv], it = L?.items?.find(x => x.id === id);
  if (!it || !INDOOR_SIGNS[it.t]) { app.toast('That sign is gone', 'bad'); return; }
  const open = B.type === 'park', T = INDOOR_SIGNS[it.t], Z = signLimits(it.t, open), sg = it.sg || { mode: 'private', cr: null }, styles = stylesOf(it.t), F0 = signFace(it);
  const st = { w: F0.w, h: F0.h, keep: false, v: it.v || styles[0].id, c: it.c || SIGN_ACCENT };
  const shapeNow = () => signShape({ t: it.t, fw: st.w, fh: st.h });
  const D = dialog(T.label);
  D.box.innerHTML = `<h3><span>🪧 ${esc(T.label)} · ${esc(B.name)}</span><button type="button" class="btn small" data-c="close" aria-label="Close">✕</button></h3>
    ${sg.blocked ? `<p class="bad">Hidden by an administrator: ${esc(sg.blocked)}</p>` : ''}
    <div class="ab-sec"><b class="ab-h">Style</b><div class="is-styles">${styles.map(x => `<button type="button" class="is-style" data-v="${x.id}"><span class="is-thumb" data-style="${x.id}"></span><b>${esc(x.label)}${x.light ? ' 💡' : ''}</b><small>${esc(x.blurb)}</small></button>`).join('')}</div>
      <div class="is-light"><span class="dim">Light colour</span><span class="is-swatches">${SIGN_LIGHTS.map(c => `<span class="sw" data-col="${c}" style="background:${c}" title="${c}"></span>`).join('')}<input type="color" class="is-c"></span></div></div>
    <div class="ab-sec"><b class="ab-h">Size of the sign</b>
      <div class="is-dims"><label>Width <input type="number" class="input is-w" min="${Z.w[0]}" max="${Z.w[1]}" step="0.05"> m</label><span class="dim">×</span>
        <label>Height <input type="number" class="input is-h" min="${Z.h[0]}" max="${Z.h[1]}" step="0.05"> m</label>
        <label class="is-keep"><input type="checkbox"> Keep its shape</label></div>
      <div class="chips is-shapes">${SHAPES.map(([n, a, r]) => `<span class="chip" data-ar="${a}" title="${r}">${n} <small class="dim">${r}</small></span>`).join('')}</div>
      <p class="hint">Only the sign's panel changes - any width and height, up to ${Z.w[1]} m wide (as the room allows) and ${Z.h[1]} m high${open ? ' here in the open' : ', nearly floor to ceiling'}; ${T.family === 'stand' ? 'its base and posts stay as they are and the panel grows upwards' : 'it grows round its centre'}. Or select it while furnishing and drag its handles.</p>
      <p class="hint bad is-fit" role="alert"></p></div>
    <div class="ab-sec is-dsec"><b class="ab-h">Design</b><div class="is-designer"></div></div>
    <div class="lib-btns"><button type="button" class="btn" data-c="close">Cancel</button><button type="button" class="btn primary" data-a="save">Save</button></div>`;
  const q = s2 => D.box.querySelector(s2);
  const des = designer(q('.is-designer'), { cr: sg.cr, shapes: [shapeNow()], placeholder: B.name, captions: { [shapeNow()]: T.label } });
  let shown = shapeNow();
  const thumbs = async () => {
    const key = x => signGeoKey({ t: it.t, v: x, fw: st.w, fh: st.h }), urls = await signThumbs(styles.map(x => key(x.id)), st.c);
    for (const el of D.box.querySelectorAll('.is-thumb')) { const u = urls[key(el.dataset.style)]; if (u) el.style.backgroundImage = `url(${u})`; }
  };
  /** The size: checked to its kind's sizes; the panel's shape to the designer, the styles' pictures at it. */
  const sized = (w, h) => {
    const z = signSize(it.t, w, h, open); st.w = z.w; st.h = z.h;
    const why = checkItem(B, f, L, { ...it, fw: st.w, fh: st.h }, it.id);
    q('.is-fit').textContent = why ? `⚠️ At this size: ${why}` : '';
    q('[data-a="save"]').disabled = !!why;
    const sh = shapeNow();
    if (sh !== shown) { shown = sh; clearTimeout(D.ts); D.ts = setTimeout(() => des.setShapes([sh], { [sh]: T.label }), 150); }
    clearTimeout(D.tt); D.tt = setTimeout(thumbs, 450);
  };
  const paint = (inputs = true) => {
    if (inputs) { q('.is-w').value = st.w.toFixed(2); q('.is-h').value = st.h.toFixed(2); }
    q('.is-keep input').checked = st.keep;
    for (const x of D.box.querySelectorAll('[data-ar]')) x.classList.toggle('on', Math.abs(st.w / st.h - +x.dataset.ar) < 0.02);
    for (const x of D.box.querySelectorAll('[data-v]')) x.classList.toggle('on', x.dataset.v === st.v);
    const light = !!styles.find(x => x.id === st.v)?.light;
    q('.is-light').classList.toggle('hidden', !light);
    for (const x of D.box.querySelectorAll('.is-swatches .sw')) x.classList.toggle('on', x.dataset.col === st.c);
    q('.is-c').value = st.c;
  };
  D.box.addEventListener('input', e => {
    const c = e.target.classList;
    if (c.contains('is-w') || c.contains('is-h')) {
      const v = +e.target.value; if (!(v > 0)) return;
      const ar = st.w / st.h;
      if (c.contains('is-w')) sized(v, st.keep ? v / ar : st.h); else sized(st.keep ? v * ar : st.w, v);
      if (st.keep) q(c.contains('is-w') ? '.is-h' : '.is-w').value = (c.contains('is-w') ? st.h : st.w).toFixed(2);
      paint(false);
    }
    if (c.contains('is-c')) { st.c = e.target.value.toLowerCase(); paint(); clearTimeout(D.t); D.t = setTimeout(thumbs, 300); }
  });
  D.box.addEventListener('change', e => {
    if (e.target.closest('.is-keep')) { st.keep = e.target.checked; return; }
    if (e.target.classList.contains('is-w') || e.target.classList.contains('is-h')) paint();   // shows what it was held to
  });
  D.box.addEventListener('click', async e => {
    if (e.target.closest('.designer')) return;
    const sw = e.target.closest('.is-swatches .sw'); if (sw) { st.c = sw.dataset.col; paint(); thumbs(); return; }
    const ar = e.target.closest('[data-ar]');
    if (ar) {   // a shape: about the same area, held to the kind's sizes
      const a = +ar.dataset.ar, area = st.w * st.h;
      let w = Math.sqrt(area * a), h = w / a;
      const k = Math.min(1, Z.w[1] / w, Z.h[1] / h), u = Math.max(1, Z.w[0] / (w * k), Z.h[0] / (h * k));
      w *= k * u; h *= k * u;
      sized(Math.round(w * 20) / 20, Math.round(w * 20 / a) / 20); paint();
      return;
    }
    const t = e.target.closest('[data-a],[data-v]'); if (!t) return;
    if (t.dataset.v) { st.v = t.dataset.v; paint(); return; }
    if (t.dataset.a === 'save') {
      const cr = des.value();
      if (cr instanceof Error) { app.toast(cr.message, 'bad', 3000); return; }
      t.disabled = true;
      const r = await send(app, [{ op: 'item.sign', b, f, id, fw: st.w, fh: st.h, v: st.v, c: st.c, sg: { mode: 'private', cr } }], 'Sign saved.');
      if (r) D.close(); else t.disabled = false;
    }
  });
  paint(); sized(st.w, st.h); thumbs();
}

// ------------------------------------------------------------------ the Marketing tools' own content
/** Decoration d (a billboard or a street sign): its own content for the house's turns. */
export function editAssetContent(app, d, done = null) {
  const A = AD_ASSETS[d.t]; if (!A) return;
  const D = dialog(`${A.label}: its own content`);
  D.box.innerHTML = `<h3><span>📣 ${esc(CATALOG[d.t]?.name || A.label)}: its own content</span><button type="button" class="btn small" data-c="close" aria-label="Close">✕</button></h3>
    <p class="hint">${'What this sign shows: the world\'s own news, places, events - with a link people can open.'}</p>
    <div class="ab-sec"><div class="mk-designer"></div></div>
    <div class="lib-btns"><button type="button" class="btn" data-c="close">Cancel</button>${d.hc ? '<button type="button" class="btn" data-a="clear">Clear it</button>' : ''}<button type="button" class="btn primary" data-a="save">Save</button></div>`;
  const des = designer(D.box.querySelector('.mk-designer'), { cr: d.hc, shapes: [A.shape], placeholder: S.world?.name || 'Welcome', captions: { [A.shape]: A.label } });
  D.box.addEventListener('click', async e => {
    const t = e.target.closest('[data-a]'); if (!t || t.closest('.designer')) return;
    let hc = null;
    if (t.dataset.a === 'save') { const v = des.value(); if (v instanceof Error) { app.toast(v.message, 'bad', 3000); return; } hc = v; }
    else if (t.dataset.a !== 'clear') return;
    t.disabled = true;
    const { id: _id, lot: _lot, hc: _hc, ...rest } = d; void _id; void _lot; void _hc;
    const r = await send(app, [{ op: 'deco.move', id: d.id, deco: { ...rest, hc } }], hc ? 'Saved.' : 'Cleared.');
    if (r) { D.close(); done?.(); } else t.disabled = false;
  });
}
