// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's Customize tab, building its own character (ui/studio-look.js opens it; 2026-11-18: "the character
// builder is the new characters' foundation"): the builder (client/js/builder/) on the Studio's stage — its body, face,
// hair and clothes edited live — and, saved, the character baked into a model of its own for the city (server/characters/)
// and worn by the agent (person.set with the new character). Its preset is kept with the character, so it opens here again
// as it was left. Phones: the stage grows above the controls, every control a finger's size (css/studio.css .bd-*).
import { auth } from '../core/auth.js';
import { esc } from '../core/util.js';
import { sanitizeAppearance, isCustomChar } from '/shared/appearance.js';

const TABS = [['body', 'Body', '🧍'], ['face', 'Face', '🙂'], ['hair', 'Hair', '✂️'], ['outfit', 'Outfit', '👕']];
const VIEWS = [['body', 'Full body'], ['face', 'Face'], ['back', 'Back']];
const SLOT_NAMES = { structure: 'Structure', eyes: 'Eyes', lashes: 'Lashes', brows: 'Brows', nose: 'Nose', mouth: 'Lips', ears: 'Ears', detail: 'Details', facialHair: 'Facial hair', beard: 'Beards', top: 'Tops', bottom: 'Bottoms', shoes: 'Shoes', hair: 'Hair' };
let lib = null;   // (client/js/builder/builder.js, loaded the first time someone builds: its garments and faces are ~50 MB)
const loadLib = () => (lib ??= import('../builder/builder.js').catch(e => { lib = null; throw e; }));
/** Starts loading the builder — its modules, its two bodies' heads and the original pieces' patterns, ~7 MB (the
 *  collections only when a look wears them: builder/wardrobe.js) — in the background once the page is idle: the Agent
 *  Studio calls it as it opens, so the Customize tab's builder is often there before it is asked for (2026-11-19). Not on
 *  a connection that asks to save data. */
export function warmBuilder() {
  if (lib || navigator.connection?.saveData) return;
  const go = () => { loadLib().catch(() => { /* (tried again when the tab opens) */ }); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 5000 }); else setTimeout(go, 2000);
}

/** POST raw bytes with the session's CSRF token (refreshed once when stale) → JSON. */
async function postBytes(url, bytes, retried = false) {
  const headers = { 'content-type': 'application/octet-stream' };
  if (auth.csrf) headers['x-csrf-token'] = auth.csrf;
  const r = await fetch(url, { method: 'POST', headers, body: bytes });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  if (r.ok) return j;
  if (!retried && j?.code === 'csrf') { await auth.refresh(); return postBytes(url, bytes, true); }
  throw Object.assign(new Error(j?.error || `HTTP ${r.status}`), { status: r.status, code: j?.code });
}

/**
 * The builder in tab body `body` of Studio C, its stage over the Studio's own. look: the agent's saved look. st: this
 * tab's state (kept between visits: C.st.look). save(look) → Promise<boolean>: the Studio's person.set.
 */
export async function buildPanel(C, box, live, { look, st, save }) {
  const may = C.manage;
  // (everything in a box of its own: its handlers go with it when the tab is left)
  box.innerHTML = '<div class="bd-root"></div>';
  const body = box.firstChild;
  const studio = C.el.querySelector('.studio'), stageEl = C.el.querySelector('.st-stage');
  body.innerHTML = '<div class="bd"><p class="hint">Opening the character builder…</p></div>';
  // its stage: over the Studio's, for as long as the tab is open (st.B is kept; ui/studio-look.js leaveLook closes it)
  let host = stageEl.querySelector('.st-builder');
  if (!host) { host = document.createElement('div'); host.className = 'st-builder'; host.innerHTML = '<div class="bd-status" role="status"></div>'; stageEl.append(host); }
  studio.classList.add('st-building');
  const statusEl = host.querySelector('.bd-status');
  const status = t => { statusEl.textContent = t || ''; statusEl.hidden = !t; };
  let B = st.B;
  const bar = () => body.querySelector('.bd-bar');
  if (!B) {
    let mod;
    try { status('Loading the builder…'); mod = await loadLib(); }
    catch (e) { status(null); body.innerHTML = `<p class="hint bad">The builder could not load: ${esc(e.message || String(e))}</p>`; return; }
    if (!live()) return;
    // the character it wears now, if it was built here: its preset, to carry on from
    let preset = st.preset || null;
    if (!preset && isCustomChar(look.char)) {
      try { const r = await fetch(`/api/characters/preset?id=${look.char}`, { cache: 'no-store' }); if (r.ok) preset = (await r.json()).preset; } catch { /* a fresh one */ }
    }
    try {
      B = st.B = await mod.openBuilder(host, { preset, gender: look.body ? 'female' : 'male', onStatus: status, onChange: () => { st.dirty = true; paintBar(); } });
    } catch (e) { status(null); body.innerHTML = `<p class="hint bad">The builder could not start: ${esc(e.message || String(e))}</p>`; return; }
    st.mod = mod; st.dirty = !isCustomChar(look.char);
    st.sub ??= 'body'; st.slot ??= {};
    B.view('body');
    if (!live()) return;
  }
  const M = st.mod;
  const s = () => B.state;
  function paintBar() {
    // (also called by the builder while it opens, before B and the bar exist)
    const b = bar(); if (!b || !B) return;
    b.querySelector('.bd-saved').textContent = st.saving ? 'Baking its character… (about 10 s)' : st.dirty ? 'Not saved yet' : 'Saved — it wears this in the city';
    b.querySelector('[data-c="save"]').disabled = !may || st.saving || !st.dirty;
    b.querySelector('[data-c="undo"]').disabled = !B.canUndo() || st.saving;
    b.querySelector('[data-c="redo"]').disabled = !B.canRedo() || st.saving;
  }
  const swatches = (key, list) => {
    const val = B.color(key);
    return `<div class="bd-sw" data-color="${key}">${list.map(c => `<button type="button" class="bd-c${c === val ? ' on' : ''}" data-v="${c}" style="--c:${c}" aria-label="${esc(SLOT_NAMES[key] || key)} colour ${c}"></button>`).join('')}<label class="bd-c bd-pick" title="Any colour"><input type="color" value="${esc(val || '#888888')}" data-pick="${key}" aria-label="Any colour">+</label>${
      ['nose', 'ears'].includes(key) ? '<button type="button" class="btn small" data-match="skin">Match skin</button>' : ['brows', 'beard'].includes(key) ? '<button type="button" class="btn small" data-match="hair">Match hair</button>' : ''}</div>`;
  };
  const paletteOf = k => B.paletteFor(k);
  const signed = v => (v === 0 ? 'Neutral' : (v > 0 ? '+' : '−') + Math.round(Math.abs(v) * 100) + '%');
  const slider = (key, label, [lo, hi], v, kind) => `<label class="bd-sl"><span>${esc(label)}</span><output>${Math.round(v * 100)}%</output><input type="range" min="${lo}" max="${hi}" step="0.01" value="${v}" data-${kind}="${key}" aria-label="${esc(label)}"></label>`;
  /** The face's structure: forehead, cheeks, jaw, chin, upper lip, the nose's protrusion (−100…+100%, 0 neutral). */
  function structure() {
    const fs = s().faceFit.structure;
    return `<div class="bd-lib"><div class="bd-libh"><h4>Face structure</h4><button type="button" class="btn small" data-c="structure-reset">Reset</button></div>${
      Object.entries(M.structureGroups).map(([region, dials]) => `<details class="bd-adj"${(st.regions ??= new Set(['Cheeks'])).has(region) ? ' open' : ''} data-region="${esc(region)}"><summary>${esc(region)}</summary>${
        Object.entries(dials).map(([k, label]) => `<label class="bd-sl"><span>${esc(label)}</span><output>${signed(fs[k])}</output><input type="range" min="-1" max="1" step="0.01" value="${fs[k]}" data-structure="${k}" aria-label="${esc(label)}"></label>`).join('')}</details>`).join('')}</div>`;
  }
  /** The base lash line's thickness (a woman's under Lashes, a man's under Eyes). */
  const lashLine = () => `<div class="bd-sub"><h4>Base lash line</h4>${M.LASH_LINE.map(([edge, label, lo, hi]) => `<label class="bd-sl"><span>${esc(label)}</span><output>${Math.round(s().faceFit.lashLine[edge] * 100)}%</output><input type="range" min="${lo}" max="${hi}" step="0.05" value="${s().faceFit.lashLine[edge]}" data-lashline="${edge}" aria-label="${esc(label)}"></label>`).join('')}</div>`;
  function library(slot, heading = null) {
    const g = B.gender, styles = B.styles(slot), cur = s().selections[slot];
    const dials = M.faceDials[slot] && cur >= 0 ? `<details class="bd-adj"${st.adj === slot ? ' open' : ''} data-adj="${slot}"><summary>Adjust ${esc((SLOT_NAMES[slot] || slot).toLowerCase())}</summary>${Object.entries(M.faceDials[slot]).map(([d, label]) => slider(`${slot}.${d}`, label, M.dialRange(slot, d), s().faceFit[slot][d], 'fit')).join('')}</details>` : '';
    const lash = (slot === 'lashes' || (slot === 'eyes' && g === 'male')) && s().selections.eyes >= 0 ? lashLine() : '';
    const pupils = slot === 'eyes' && cur >= 0 ? `<div class="bd-sub"><h4>Pupils</h4>${Object.entries(M.pupilDials).map(([k, d]) => `<label class="bd-sl"><span>${esc(d.label)}</span><output>${Math.round(s().faceFit.pupils[k] * 100)}%</output><input type="range" min="${d.min}" max="${d.max}" step="0.01" value="${s().faceFit.pupils[k]}" data-pupil="${k}" aria-label="${esc(d.label)}"></label>`).join('')}</div>` : '';
    const title = (i, name) => { const p = B.piece(slot, i); return p ? `${p.source.toUpperCase()} · ${name}` : name; };
    return `<div class="bd-lib" data-lib="${slot}"><div class="bd-libh"><h4>${esc(heading || SLOT_NAMES[slot] || slot)} · ${styles.length} styles</h4>${slot === 'hair' || slot === 'eyes' ? '' : `<button type="button" class="btn small${cur === -1 ? ' on' : ''}" data-pick-style="-1">None</button>`}</div>
      <div class="bd-grid">${styles.map(([i, name]) => `<button type="button" class="bd-item${cur === i ? ' on' : ''}" data-pick-style="${i}" title="${esc(title(i, name))}"${may ? '' : ' disabled'}><img src="/assets/builder/swatches/${g}-${slot}-${i}.png" alt="" loading="lazy" draggable="false"><span>${esc(name)}</span></button>`).join('')}</div>
      ${swatches(slot, paletteOf(slot))}${dials}${lash}${pupils}</div>`;
  }
  function paint() {
    if (!live()) return;
    const sub = st.sub, g = B.gender;
    let html = '';
    if (sub === 'body') {
      html = `<h4>Skin tone</h4>${swatches('skin', M.palette.skin)}${M.SHAPE_GROUPS.map(([title, keys]) => `<h4>${esc(title)}</h4>${keys.map(k => slider(k, M.labels[k] || k, M.shapeBounds[k], s().shape[k], 'shape')).join('')}`).join('')}`;
    } else if (sub === 'face' || sub === 'outfit') {
      const slots = sub === 'face' ? M.faceSlots(g) : M.OUTFIT_SLOTS, slot = slots.includes(st.slot[sub]) ? st.slot[sub] : slots[0];
      st.slot[sub] = slot;
      const looks = sub === 'outfit' ? `<label class="bd-look"><span>Original looks</span><select data-look aria-label="Apply an original Tripo look"${may ? '' : ' disabled'}><option value="">Apply an original Tripo look…</option>${B.looks().map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></label>` : '';
      const libs = slot === 'structure' ? structure() : M.slotLibraries(slot).map(([k, h]) => library(k, h)).join('');
      html = `${looks}<nav class="bd-slots" aria-label="${sub === 'face' ? 'Face' : 'Outfit'} parts">${slots.map(k => `<button type="button" class="lk-pose${k === slot ? ' on' : ''}" data-slot="${k}">${esc(SLOT_NAMES[k] || k)}</button>`).join('')}</nav>${libs}`;
    } else html = library('hair');
    const y = body.querySelector('.bd-pane')?.scrollTop || 0;
    body.innerHTML = `<div class="bd">
      <div class="bd-top">
        <div class="bd-sex" role="group" aria-label="Body">${[['female', 'Woman'], ['male', 'Man']].map(([k, t]) => `<button type="button" class="lk-pose${g === k ? ' on' : ''}" data-sex="${k}"${may ? '' : ' disabled'}>${t}</button>`).join('')}</div>
        <div class="bd-views" role="group" aria-label="View">${VIEWS.map(([k, t]) => `<button type="button" class="lk-pose${st.view === k ? ' on' : ''}" data-view="${k}">${t}</button>`).join('')}<button type="button" class="lk-pose${st.spin ? ' on' : ''}" data-c="spin" aria-pressed="${!!st.spin}">↻ Turn</button></div>
      </div>
      <nav class="bd-tabs" role="tablist">${TABS.map(([k, t, ic]) => `<button type="button" role="tab" class="bd-tab${k === sub ? ' on' : ''}" data-sub="${k}" aria-selected="${k === sub}">${ic} ${t}</button>`).join('')}</nav>
      <div class="bd-pane"${may ? '' : ' inert'}>${html}</div>
      ${may ? `<div class="bd-bar sp-save"><span class="bd-saved"></span><button type="button" class="btn small" data-c="undo" title="Undo">↶</button><button type="button" class="btn small" data-c="redo" title="Redo">↷</button><button type="button" class="btn small" data-c="surprise">🎲 Surprise me</button><button type="button" class="btn primary" data-c="save">Save its look</button></div>`
        : '<p class="hint">Only its owner, or someone it is shared with to manage it, changes its look.</p>'}
    </div>`;
    const pane = body.querySelector('.bd-pane'); if (pane) pane.scrollTop = y;
    paintBar();
  }
  // ---- what the controls do
  body.onclick = async e => {
    const t = e.target;
    const go = (sel, fn) => { const b = t.closest(sel); if (b) { fn(b); return true; } return false; };
    if (go('[data-sub]', b => { st.sub = b.dataset.sub; if (st.sub === 'face' || st.sub === 'hair') { st.view = 'face'; B.view('face'); } else if (st.view === 'face') { st.view = 'body'; B.view('body'); } paint(); })) return;
    if (go('[data-slot]', b => { st.slot[st.sub] = b.dataset.slot; paint(); })) return;
    if (go('[data-view]', b => { st.view = b.dataset.view; B.view(st.view); paint(); })) return;
    if (!may) return;
    if (go('[data-sex]', async b => { if (b.dataset.sex === B.gender) return; body.querySelector('.bd-pane').inert = true; await B.setGender(b.dataset.sex); st.dirty = true; B.view(st.view || 'body'); paint(); })) return;
    if (go('[data-pick-style]', async b => { const slot = b.closest('[data-lib]')?.dataset.lib || 'hair'; busy(true); try { await B.choose(slot, +b.dataset.pickStyle); } finally { busy(false); } paint(); })) return;
    if (go('.bd-c[data-v]', b => { B.setColor(b.closest('[data-color]').dataset.color, b.dataset.v); paint(); })) return;
    if (go('[data-match]', b => { B.setColor(b.closest('[data-color]').dataset.color, null); paint(); })) return;
    const cmd = t.closest('[data-c]')?.dataset.c;
    if (cmd === 'spin') { st.spin = !st.spin; B.spin(st.spin); paint(); }
    else if (cmd === 'undo') { await B.undo(); paint(); }
    else if (cmd === 'redo') { await B.redo(); paint(); }
    else if (cmd === 'structure-reset') { B.resetStructure(); paint(); }
    else if (cmd === 'surprise') { busy(true); try { await surprise(); } finally { busy(false); } paint(); }
    else if (cmd === 'save') await saveIt();
  };
  body.oninput = e => {
    const t = e.target, v = +t.value, out = t.parentElement?.querySelector('output');
    if (t.dataset.shape) { if (!t.dataset.began) { t.dataset.began = '1'; B.begin(); } B.setShape(t.dataset.shape, v); }
    else if (t.dataset.fit) { if (!t.dataset.began) { t.dataset.began = '1'; B.begin(); } const [k, d] = t.dataset.fit.split('.'); B.setFit(k, d, v); }
    else if (t.dataset.pupil) { if (!t.dataset.began) { t.dataset.began = '1'; B.begin(); } B.setPupil(t.dataset.pupil, v); }
    else if (t.dataset.structure) { if (!t.dataset.began) { t.dataset.began = '1'; B.begin(); } B.setStructure(t.dataset.structure, v); if (out) out.value = signed(v); return; }
    else if (t.dataset.lashline) { if (!t.dataset.began) { t.dataset.began = '1'; B.begin(); } B.setLashLine(t.dataset.lashline, v); }
    else return;
    if (out) out.value = Math.round(v * 100) + '%';
  };
  body.onchange = e => {
    const t = e.target;
    if (t.dataset.pick) { B.setColor(t.dataset.pick, t.value.toLowerCase()); paint(); }
    else if (t.matches('[data-look]') && t.value) { const v = t.value; busy(true); B.applyLook(v).catch(err => C.say(err.message || String(err), true)).finally(() => { busy(false); paint(); }); }
    else if (t.dataset.began) { delete t.dataset.began; paintBar(); }
  };
  body.addEventListener('toggle', e => {
    const d = e.target.closest?.('[data-adj]'); if (!d) return;
    if (d.dataset.region) { (st.regions ??= new Set(['Cheeks']))[d.open ? 'add' : 'delete'](d.dataset.region); return; }
    st.adj = d.open ? d.dataset.adj : null;
  }, true);
  /** While the builder loads a piece's patterns (the Tripo collection, the first time): its controls wait. */
  function busy(on) { const p = body.querySelector('.bd-pane'); if (p) p.inert = on || !may; body.classList.toggle('bd-busy', on); }
  B.pause(false);
  /** A random character of this body: every library, colour and proportion picked (the proportions near the middle). */
  async function surprise() {
    const pick = a => a[Math.floor(Math.random() * a.length)], g = B.gender;
    const libs = [...M.faceSlots(g).flatMap(k => (k === 'structure' ? [] : M.slotLibraries(k).map(([x]) => x))), 'hair', ...M.OUTFIT_SLOTS];
    for (const k of libs) {
      const styles = B.styles(k); if (!styles.length) continue;
      const optional = ['detail', 'beard', 'lashes'].includes(k);
      // (a dress chosen as the top: no separate bottoms)
      if (k === 'bottom' && s().selections.bottom === -1 && B.piece('top', s().selections.top)?.dress) continue;
      await B.choose(k, optional && Math.random() < 0.45 ? -1 : pick(styles)[0]);
    }
    for (const k of ['skin', 'hair', 'eyes', 'mouth']) B.setColor(k, pick(paletteOf(k)));
    B.begin();
    for (const [, keys] of M.SHAPE_GROUPS) for (const k of keys) { const [lo, hi] = M.shapeBounds[k], mid = (lo + hi) / 2, span = (hi - lo) * 0.3; B.setShape(k, Math.round((mid + (Math.random() - 0.5) * span) * 100) / 100); }
  }
  async function saveIt() {
    if (st.saving) return;
    st.saving = true; paintBar(); C.say('');
    try {
      const { bytes } = B.exportKit();
      const r = await postBytes('/api/characters/bake', bytes);
      const next = sanitizeAppearance({ ...look, char: r.id, body: B.gender === 'female' ? 1 : 0, height: 1, build: 1 });
      if (await save(next)) { st.dirty = false; look = next; st.preset = B.preset(); }
    } catch (e) { C.say(e.message || 'It could not be saved', true); }
    finally { st.saving = false; if (live()) paintBar(); }
  }
  B.spin(!!st.spin);
  st.view ??= 'body';
  status(null);
  paint();
}

/** Leaving the tab: the builder's stage is closed (its WebGL context freed); its state stays with the tab's (st). */
export function closeBuild(C, st) {
  st?.B?.dispose(); if (st) { st.B = null; st.mod = null; }
  C.el.querySelector('.st-builder')?.remove();
  C.el.querySelector('.studio')?.classList.remove('st-building', 'st-city');
}
/** The builder's stage hidden (the agent's baked character shown moving, as the city draws it) or shown again. */
export function showCity(C, st, on) {
  C.el.querySelector('.studio')?.classList.toggle('st-city', !!on);
  st?.B?.pause(!!on);
}
