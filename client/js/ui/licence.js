// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Licence keys and demo mode on the page (PLAN WP1.11, DECISIONS C108, C109, E17, E19).
// - Demo mode: a watermark (click it for Settings → License); the edit panels and settings stay visible and can be
//   opened, but are greyed out and unusable (E19). The server refuses the locked features whatever the page shows.
// - Every demo notice offers "Activate license now" (Settings → License): the watermark, the owner's first note, the
//   locked panels (a click anywhere in one), and any refusal the server sends (licence_required, from core/net.js and
//   core/auth.js, or the live stream). Settings → License also links to buying a key (the server's buyUrl).
// - Settings → License: the status for everyone; for the owner also Activate a key, Import a release 1 licence
//   (its license.json; validated with Lemon Squeezy, no new activation) and Deactivate.
// - The owner is told once, on this browser, that the installation runs in demo mode.
import { bus } from '../core/state.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { h, esc } from '../core/util.js';

let app = null, mark = null;
const PROMPTED = 'mvw.licencePrompted';

export function status() { return (auth.me && auth.me.licence) || null; }
export function isDemo() { const s = status(); return !!s && !s.active; }

export function init(a) {
  app = a;
  app.licence = { status, isDemo, open: openTab };
  mark = document.body.appendChild(h(`<button type="button" id="demo-mark" class="hidden" title="Open Settings → License">
    <b>DEMO MODE</b><span>Up to 3 agents; editing is locked.</span><em class="dm-go">Activate license now ›</em></button>`));
  mark.onclick = openTab;
  bus.on('auth', paint);
  bus.on('msg:licence', () => auth.refresh());
  // a locked feature refused by the server: say why, with the way out
  bus.on('licence:required', refused);
  bus.on('msg:error', m => { if (m && m.code === 'licence_required') refused(); });
  // a click anywhere in a locked panel (its controls let clicks through to it) opens Settings → License
  document.addEventListener('click', e => {
    if (!document.body.classList.contains('demo-locked')) return;
    const t = e.target;
    if (t && t.matches && t.matches('#dockL .dsec-b, #buildp, #furnp')) { e.preventDefault(); e.stopPropagation(); openTab(); }
  }, true);
  paint();
}
function openTab() { import('./settings.js').then(m => m.open(app, 'licence')); }
/** The note's button: Settings → License. */
const ACTIVATE = { label: 'Activate license now', run: () => openTab() };
let lastRefusal = 0;
function refused(message) {
  const now = Date.now();
  if (now - lastRefusal < 4000) return;   // (one note for a burst of refusals)
  lastRefusal = now;
  app.toast(`🔒 ${message || 'This is locked in demo mode. A licence key unlocks it.'}`, 'bad', 12000, '', '', ACTIVATE);
}
let preloaded = false;
function paint() {
  const demo = isDemo();
  document.body.classList.toggle('demo-locked', demo);
  if (mark) mark.classList.toggle('hidden', !demo);
  // (in demo mode "Activate license now" should open at once: Settings' code is fetched ahead, once the city is up)
  if (demo && !preloaded) { preloaded = true; setTimeout(() => import('./settings.js').catch(() => {}), 4000); }
  if (demo && auth.can('licence.manage')) {
    let seen = null;
    try { seen = localStorage.getItem(PROMPTED); } catch { /* private mode */ }
    if (!seen) {
      try { localStorage.setItem(PROMPTED, '1'); } catch { /* private mode */ }
      setTimeout(() => app.toast('🔑 This installation runs in demo mode: up to 3 agents, and editing is locked.', '', 12000, '', '', ACTIVATE), 1500);
    }
  }
}

const when = t => { try { return new Date(t).toLocaleString(); } catch { return String(t || ''); } };

/** Settings → License. */
export async function licenceTab(d, body) {
  body.innerHTML = '<p class="hint">Loading…</p>';
  let s;
  try { s = await getJSON('/api/licence'); } catch (e) { body.innerHTML = `<p class="hint">Could not read the licence status: ${esc(e.message)}</p>`; return; }
  const owner = auth.can('licence.manage');
  const err = m => { const e = d.q('.err'); e.textContent = m; e.classList.toggle('hidden', !m); };
  err('');
  if (s.active) {
    body.innerHTML = `
      <h4>🔑 Licensed <span class="dim">${esc(s.tierName || '')}</span></h4>
      <div class="kv2"><span>Activated</span><b>${esc(when(s.activatedAt))}</b></div>
      ${s.productName ? `<div class="kv2"><span>Product</span><b>${esc(s.productName)}${s.variantName ? ` · ${esc(s.variantName)}` : ''}</b></div>` : ''}
      ${s.key ? `<div class="kv2"><span>Key</span><b class="mono">${esc(s.key)}</b></div>` : ''}
      ${s.imported ? '<p class="hint">Carried over from release 1: the same activation, validated with the licence server.</p>' : ''}
      <p class="hint">Every feature is unlocked for every account. The licence keeps working offline.</p>
      ${s.buyUrl ? `<p class="hint">Need a key for another installation? <a class="lic-buy-more" href="${esc(s.buyUrl)}" target="_blank" rel="noopener noreferrer">Buy License here</a>.</p>` : ''}
      ${owner ? `<div class="sep"></div><h5>Deactivate</h5>
        <p class="hint">Frees this activation so the key can be used elsewhere, and returns this installation to demo mode.${s.imported ? ' This licence came from release 1, so its activation is shared with release 1: deactivating frees it there too.' : ''}</p>
        <div class="row"><button type="button" class="btn danger deact">Deactivate this licence</button></div>` : ''}`;
    const b = body.querySelector('.deact');
    if (b) b.onclick = async () => {
      if (!confirm('Deactivate the licence? This installation returns to demo mode.')) return;
      b.disabled = true; err('');
      try { await post('/api/licence/deactivate', {}); done('Licence deactivated: demo mode'); } catch (e) {
        if (e.code === 'deactivate_failed' && confirm(`${e.message}\n\nRemove the licence from this installation anyway?`)) {
          try { await post('/api/licence/deactivate', { force: true }); done('Licence removed: demo mode'); return; } catch (e2) { if (!e2.quiet) err(e2.message); }
        } else if (!e.quiet) err(e.message);
        b.disabled = false;
      }
    };
    return;
  }
  body.innerHTML = `
    <h4>🔒 Demo mode</h4>
    <p class="hint">${esc(s.message || '')}</p>
    ${s.buyUrl ? `<div class="lic-buy"><a class="btn primary lic-buy-link" href="${esc(s.buyUrl)}" target="_blank" rel="noopener noreferrer">🛒 Buy License here</a>
      <span class="hint">My Virtual World's licence key, from its store (Lemon Squeezy). The key comes by email; paste it below.</span></div>` : ''}
    <h5>Locked until a licence key is active</h5>
    <ul class="notice-list">${(s.locks || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <p class="hint">Chat, weather, day and night, and watching the city stay available.</p>
    ${owner ? `<div class="sep"></div>
      <h5>Activate a licence key</h5>
      <form class="lic-act row"><input class="input key" autocomplete="off" spellcheck="false" maxlength="200" placeholder="Paste the key from your purchase email" aria-label="Licence key">
        <button class="btn primary" type="submit">Activate</button></form>
      <p class="hint">One activation covers the whole installation and every account. Keys bought for release 1 work.</p>
      <h5>Or carry over your release 1 licence</h5>
      <p class="hint">Choose the <b>license.json</b> file from release 1's data folder. It is checked with the licence server and uses no new activation.</p>
      <label class="btn lic-file">📄 Choose license.json<input type="file" accept=".json,application/json" hidden></label>`
    : '<p class="hint">The owner of this installation can activate a licence key here.</p>'}`;
  const f = body.querySelector('.lic-act');
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('button'), key = f.querySelector('.key').value.trim();
    if (!key) return err('Paste the licence key first');
    btn.disabled = true; err('');
    try { await post('/api/licence/activate', { key }); done('🔑 Licence activated: everything is unlocked'); } catch (x) { if (!x.quiet) err(x.message); btn.disabled = false; }
  };
  const fi = body.querySelector('.lic-file input');
  if (fi) fi.onchange = async () => {
    const file = fi.files && fi.files[0];
    if (!file) return;
    err('');
    let receipt;
    try { receipt = JSON.parse(await file.text()); } catch { fi.value = ''; return err('That file is not a release 1 license.json'); }
    try { await post('/api/licence/import', { receipt }); done('🔑 Release 1 licence carried over: everything is unlocked'); } catch (x) { if (!x.quiet) err(x.message); }
    fi.value = '';
  };
  async function done(msg) {
    app.toast(msg, 'good', 3500);
    await auth.refresh();
    licenceTab(d, body);
  }
}
/** One line for Settings → About. */
export function aboutLine() {
  const s = status();
  if (!s) return '';
  return s.active
    ? `<div class="kv2"><span>Licence</span><b>${esc(s.tierName || 'Licensed')}${s.imported ? ' (from release 1)' : ''}</b></div>`
    : '<div class="kv2"><span>Licence</span><b>Demo mode</b></div>';
}
