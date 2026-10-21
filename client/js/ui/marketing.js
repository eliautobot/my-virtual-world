// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Marketing (administrators; the edit panel's 📣 section; 2026-10-05): every asset that carries ads, in one place.
// - Billboards (standard or large; the pole centred or at one end with the board overhanging) and street signs, put up
//   with the decorating placer (ui/decor-tools.js) on public land or the city's lots; a selected one can be turned,
//   moved, resized, switched between centred and overhang, given its own content for the house's turns, or removed.
// - The metro stations' ad panels, on or off per station.
// - The promotional aircraft one by one: add a banner plane, a blimp or a balloon, give it its own banner, take it
//   away; each kind's banner, and the hours they fly.
import { S, bus } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { CATALOG } from '/shared/catalog.js';
import { AD_ASSETS, AD_ASSET_TYPES, billboardType, stationHasAds } from '/shared/signs.js';
import { makeDecorTool } from './decor-tools.js';
import { uploadPicture } from './designer.js';

let app = null, root = null, tool = null;
const M = { size: 'standard', mount: 'centre', open: { assets: true, metro: false, air: false, ads: true } };
const name = t => CATALOG[t]?.name || t;
const ICON = { bannerPlane: '🛩️', blimp: '🎈', hotAirBalloon: '🎈' };

export function init(a) {
  app = a;
  const slot = a.docks && a.docks.slot('l:marketing');
  if (!slot) return;
  root = slot.appendChild(h('<div class="dpad mkt"></div>'));
  root.innerHTML = `<p class="hint">Everything that carries ads: billboards and street signs (on public land or the city's lots), the metro stations' panels and the aircraft over the city. They show the content you give them.</p>
    <h5>🪧 Billboards &amp; street signs</h5>
    <div class="row wrap"><span class="seg mk-size"><button type="button" class="btn small" data-size="standard">Standard</button><button type="button" class="btn small" data-size="large">Large</button></span>
      <span class="seg mk-mount"><button type="button" class="btn small" data-mount="centre">Centred</button><button type="button" class="btn small" data-mount="overhang">Overhang</button></span></div>
    <div class="row wrap"><button type="button" class="btn small primary" data-a="place-bb">＋ Place a billboard</button><button type="button" class="btn small" data-a="place-st">＋ Place a street sign</button></div>
    <div class="mk-tool"></div>
    <details class="mk-sec" data-sec="assets" open><summary>In the world <span class="mk-n"></span></summary><div class="mk-assets"></div></details>
    <details class="mk-sec" data-sec="metro"><summary>🚇 Metro station panels <span class="mk-mn"></span></summary><div class="mk-metro"></div></details>
    <details class="mk-sec" data-sec="air"><summary>✈️ Aircraft <span class="mk-an"></span></summary><div class="mk-air"><p class="hint">Loading…</p></div></details>`;
  tool = makeDecorTool(a, {
    slot: root.querySelector('.mk-tool'), dock: 'l:marketing', kinds: AD_ASSET_TYPES, owns: d => !!AD_ASSETS[d.t], chips: false, adminKinds: true,
    may: () => auth.can('world.edit'), signIn: 'Only administrators put these up.', onSelect,
  });
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('toggle', e => { const s = e.target.closest?.('[data-sec]'); if (s) { M.open[s.dataset.sec] = s.open; if (s.open && s.dataset.sec === 'air') loadAir(); } }, true);
  bus.on('decor', renderAssets); bus.on('stations', renderMetro);
  bus.on('msg:promo', () => { if (M.open.air) loadAir(); });
  paint(); renderAssets(); renderMetro();
}
function paint() {
  for (const b of root.querySelectorAll('[data-size]')) b.classList.toggle('on', b.dataset.size === M.size);
  for (const b of root.querySelectorAll('[data-mount]')) b.classList.toggle('on', b.dataset.mount === M.mount);
}
async function edit(ops, done) {
  try {
    const r = await post('/api/edit', { ops, who: 'web' });
    if (r && r.ok === false) throw new Error(r.error || 'That did not work');
    if (done) app.toast(done, 'good', 2200);
    return r;
  } catch (e) { app.toast(e.message || String(e), 'bad', 3200); return null; }
}
const fly = (x, z, d = 30, y = 4) => app.cam?.flyTo?.(x, y, z, d, app.cam.yaw ?? 0.6, 0.25);

// ------------------------------------------------------------------ billboards and street signs
function onSelect(d, el) {
  const A = AD_ASSETS[d.t]; if (!A) return;
  const bb = d.t !== 'street_sign';
  el.innerHTML = `${bb ? `<div class="row wrap"><span class="seg"><button type="button" class="btn small${A.size === 'standard' ? ' on' : ''}" data-sw="size" data-v="standard">Standard</button><button type="button" class="btn small${A.size === 'large' ? ' on' : ''}" data-sw="size" data-v="large">Large</button></span>
      <span class="seg"><button type="button" class="btn small${A.mount === 'centre' ? ' on' : ''}" data-sw="mount" data-v="centre">Centred</button><button type="button" class="btn small${A.mount === 'overhang' ? ' on' : ''}" data-sw="mount" data-v="overhang">Overhang</button></span></div>` : ''}
    <div class="row wrap"><button type="button" class="btn small" data-own="1">🎨 Its own content${d.hc ? ' ✓' : ''}</button></div>
    <p class="hint">${d.hc ? `Shows “${esc(d.hc.title || 'a picture')}”.` : 'Give it something to show: the world\'s news, places or events.'}</p>`;
  el.onclick = async e => {
    const t = e.target.closest('[data-sw],[data-own]'); if (!t) return;
    if (t.dataset.own) { (await import('./sign-design.js')).editAssetContent(app, d); return; }
    const size = t.dataset.sw === 'size' ? t.dataset.v : A.size, mount = t.dataset.sw === 'mount' ? t.dataset.v : A.mount, nt = billboardType(size, mount);
    if (nt === d.t) return;
    const { id: _i, lot: _l, ...rest } = d; void _i; void _l;
    await edit([{ op: 'deco.move', id: d.id, deco: { ...rest, t: nt } }], `Now a ${name(nt).toLowerCase()}.`);
  };
}
function renderAssets() {
  const list = (S.world?.decorations || []).filter(d => AD_ASSETS[d.t]);
  root.querySelector('.mk-n').textContent = `(${list.length})`;
  root.querySelector('.mk-assets').innerHTML = list.length ? list.map(d => `<div class="mk-row"><span>${d.t === 'street_sign' ? '🚏' : '🪧'} ${esc(name(d.t))}${d.hc?.title ? ` · <span class="dim">${esc(d.hc.title)}</span>` : ''}</span><span class="row"><button type="button" class="btn small" data-go="${esc(d.id)}" title="Show it">🎯</button><button type="button" class="btn small" data-pick="${esc(d.id)}" title="Select it">✎</button></span></div>`).join('')
    : '<p class="hint">None yet: pick a size and how it stands, then “Place a billboard” - or a street sign for a sidewalk or a park.</p>';
}

// ------------------------------------------------------------------ metro panels
function renderMetro() {
  const st = S.world?.stations || [];
  root.querySelector('.mk-mn').textContent = `(${st.filter(stationHasAds).length} of ${st.length})`;
  root.querySelector('.mk-metro').innerHTML = st.length ? `<p class="hint">Each station's kiosk carries an ad panel on its back.</p>${st.map(s => `<label class="check mk-row"><input type="checkbox" data-st="${esc(s.id)}"${stationHasAds(s) ? ' checked' : ''}> ${esc(s.name)} <button type="button" class="btn small" data-gost="${esc(s.id)}" title="Show it">🎯</button></label>`).join('')}` : '<p class="hint">No stations.</p>';
}

// ------------------------------------------------------------------ aircraft
let air = null;
async function loadAir() {
  const el = root.querySelector('.mk-air');
  try {
    const [{ PROMO_AIRCRAFT_TYPES, normalizePromoAircraftConfig }, P] = await Promise.all([import('/shared/promo.js'), getJSON('/api/promo-aircraft')]);
    air = { T: PROMO_AIRCRAFT_TYPES, P, C: normalizePromoAircraftConfig(P.config), edit: null };
  } catch (e) { el.innerHTML = `<p class="hint bad">${esc(e.message)}</p>`; return; }
  renderAir();
}
function renderAir() {
  const el = root.querySelector('.mk-air'), { T, P, C } = air;
  root.querySelector('.mk-an').textContent = `(${C.fleet.length})`;
  const n = {};
  const g = (o, k) => `<div class="mk-g" data-g="${k}">
      <label class="fld">Text<input class="input g-text" maxlength="120" value="${esc(o.text || '')}" placeholder="Your message"></label>
      <div class="row wrap"><label>Background <input type="color" class="g-bg" value="${o.backgroundColor || '#ffffff'}"></label><label>Text <input type="color" class="g-fg" value="${o.textColor || '#111827'}"></label></div>
      <div class="row wrap"><input type="file" class="g-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><button type="button" class="btn small" data-gpic="${k}">📷 Picture</button><span class="dim g-pic">${o.imageSrc ? 'a picture is set' : 'none'}</span>${o.imageSrc ? `<button type="button" class="btn small" data-gclr="${k}">Remove</button>` : ''}</div>
      <label class="fld">Link (optional)<input class="input g-url" maxlength="300" value="${esc(o.websiteUrl || '')}" placeholder="example.com"></label></div>`;
  el.innerHTML = `<label class="check"><input type="checkbox" class="air-on"${C.enabled ? ' checked' : ''}> They fly</label>
    <label class="fld">Hours of the day <span class="row"><input type="number" class="input air-from" min="0" max="24" step="0.5" value="${P.schedule.from}" style="width:70px"> to <input type="number" class="input air-to" min="0" max="24" step="0.5" value="${P.schedule.to}" style="width:70px"></span></label>
    <div class="mk-fleet">${C.fleet.map((e, i) => { n[e.type] = (n[e.type] || 0) + 1; const t = T.find(x => x.id === e.type); return `<div class="mk-row mk-plane"><span>${ICON[e.type]} ${esc(t.label.replace('Promotional ', ''))} ${n[e.type]}${e.g ? ' · <span class="dim">its own banner</span>' : ''}</span><span class="row"><button type="button" class="btn small" data-own-air="${i}">🎨</button><button type="button" class="btn small danger" data-del-air="${i}" title="Take it away">🗑</button></span></div>${air.edit === i ? g(e.g || C.types[e.type], `f${i}`) + `<div class="row"><button type="button" class="btn small" data-own-clear="${i}">Use its kind's banner</button></div>` : ''}`; }).join('') || '<p class="hint">None fly.</p>'}</div>
    <div class="row wrap">${T.map(t => `<button type="button" class="btn small" data-add-air="${t.id}"${C.fleet.filter(e => e.type === t.id).length >= t.maxCount ? ' disabled' : ''}>＋ ${ICON[t.id]} ${esc(t.label.replace('Promotional ', ''))}</button>`).join('')}</div>
    <details><summary class="hint">Each kind's banner (for those without their own)</summary>${T.map(t => `<b>${ICON[t.id]} ${esc(t.label)}</b>${g(C.types[t.id], `k:${t.id}`)}`).join('')}</details>
    <div class="row"><button type="button" class="btn small primary" data-a="air-save">Save the aircraft</button></div>`;
}
/** The banner fields in block k as a promotion graphic (shared/promo.js normalizeGraphic shape). */
function graphicOf(k, base) {
  const el = root.querySelector(`.mk-g[data-g="${k}"]`); if (!el) return base;
  return { ...base, text: el.querySelector('.g-text').value, backgroundColor: el.querySelector('.g-bg').value, textColor: el.querySelector('.g-fg').value, websiteUrl: el.querySelector('.g-url').value };
}
function grabAir() {
  const { C } = air;
  for (const t of air.T) C.types[t.id] = graphicOf(`k:${t.id}`, C.types[t.id]);
  if (air.edit !== null && C.fleet[air.edit]) { const e = C.fleet[air.edit]; e.g = graphicOf(`f${air.edit}`, e.g || { ...C.types[e.type] }); }
}
async function saveAir() {
  grabAir();
  const { C } = air, el = root.querySelector('.mk-air');
  try {
    const r = await post('/api/promo-aircraft', { config: { enabled: el.querySelector('.air-on').checked, types: C.types, fleet: C.fleet }, schedule: { from: +el.querySelector('.air-from').value, to: +el.querySelector('.air-to').value } });
    air.P = { config: r.config, schedule: r.schedule }; air.C = r.config; air.edit = null; renderAir();
    app.toast('Aircraft saved: everyone sees them now.', 'good', 2400);
  } catch (e) { app.toast(e.message, 'bad', 3200); }
}

// ------------------------------------------------------------------ events
async function onClick(e) {
  const t = e.target.closest('[data-size],[data-mount],[data-a],[data-go],[data-pick],[data-gost],[data-add-air],[data-del-air],[data-own-air],[data-own-clear],[data-gpic],[data-gclr]');
  if (!t || t.disabled) return;
  const d = t.dataset;
  if (d.size) { M.size = d.size; paint(); }
  else if (d.mount) { M.mount = d.mount; paint(); }
  else if (d.a === 'place-bb') tool.pick(billboardType(M.size, M.mount));
  else if (d.a === 'place-st') tool.pick('street_sign');
  else if (d.go || d.pick) {
    const x = (S.world.decorations || []).find(o => o.id === (d.go || d.pick)); if (!x) return;
    fly(x.x, x.z, x.t === 'street_sign' ? 14 : 34, x.t === 'street_sign' ? 1.5 : 6);
    if (d.pick) tool.select(x);
  } else if (d.gost) { const s = (S.world.stations || []).find(o => o.id === d.gost); if (s) fly(s.x, s.z, 14, 1.5); }
  else if (d.addAir) { grabAir(); air.C.fleet.push({ id: `${d.addAir}-${Date.now().toString(36)}`, type: d.addAir }); renderAir(); }
  else if (d.delAir !== undefined) { grabAir(); air.C.fleet.splice(+d.delAir, 1); air.edit = null; renderAir(); }
  else if (d.ownAir !== undefined) { grabAir(); air.edit = air.edit === +d.ownAir ? null : +d.ownAir; renderAir(); }
  else if (d.ownClear !== undefined) { const e2 = air.C.fleet[+d.ownClear]; if (e2) delete e2.g; air.edit = null; renderAir(); }
  else if (d.gpic) { t.closest('.mk-g').querySelector('.g-file').click(); }
  else if (d.gclr) { grabAir(); setPic(d.gclr, ''); renderAir(); }
  else if (d.a === 'air-save') saveAir();
}
function setPic(k, src) {
  const C = air.C;
  if (k.startsWith('k:')) C.types[k.slice(2)] = { ...C.types[k.slice(2)], imageSrc: src, imageVersion: (C.types[k.slice(2)].imageVersion || 0) + 1 };
  else { const e = C.fleet[+k.slice(1)]; if (e) e.g = { ...(e.g || C.types[e.type]), imageSrc: src, imageVersion: ((e.g || {}).imageVersion || 0) + 1 }; }
}
async function onChange(e) {
  const t = e.target;
  if (t.dataset.st) { await edit([{ op: 'station.set', id: t.dataset.st, ads: t.checked }], t.checked ? 'Its ad panel is up.' : 'Its ad panel is down.'); return; }
  if (t.classList.contains('g-file')) {
    const f = t.files?.[0], k = t.closest('.mk-g').dataset.g; if (!f) return;
    grabAir();
    try { setPic(k, await uploadPicture('/api/promo-aircraft/image', f)); } catch (x) { app.toast(x.message, 'bad', 3000); }
    renderAir();
  }
}
