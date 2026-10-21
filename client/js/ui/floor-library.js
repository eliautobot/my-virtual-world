// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Saved floor layouts in the browser (floor layouts, 2026-10-04; server/layout-routes.js): 💾 Save layout keeps the
// floor being furnished in the account's library; 📂 Layouts lists the account's own layouts and the ones shared with it,
// lays one out on this floor (fitted to its size with the same rules as a resize: shared/edit.js fitSaved — what doesn't
// fit is named before anything changes), shares it with a player by username, renames or deletes it. Laying out is
// one edit (op lvl.apply): one undo.
import { getJSON, post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { levelOf } from '../core/state.js';
import { mayOn } from '../core/rights.js';
import { floorUse, fitSaved, levelMode, floorsName, piecesWords, USE_NAME } from '/shared/edit.js';

const FT = 0.3048, ft = m => Math.round(m / FT);
const cap = t => `${t[0].toUpperCase()}${t.slice(1)}`;
const when = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
let app = null, open = null;

export function initLibrary(a) { app = a; }

function modal(cls, html) {
  const el = document.body.appendChild(h(`<div class="modal-back lib-back"><div class="panel ${cls}" role="dialog" aria-modal="true">${html}</div></div>`));
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); if (open === el) open = null; };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', e => { if (e.target === el) close(); });
  open = el;
  return { el, close };
}
const toast = (t, kind = 'good', ms = 3000) => app?.toast(t, kind, ms);

/** Saves the floor being furnished under a name the person gives. */
export function saveLayout(tg) {
  const def = tg.B.type === 'park' ? tg.B.name : `${tg.B.name} · ${floorsName(tg.B, [tg.f])}`;
  const { el, close } = modal('libdlg lib-save', `<h3>Save this layout</h3>
    <p class="hint">Keeps ${esc(tg.B.type === 'park' ? 'this park' : floorsName(tg.B, [tg.f]))}'s furniture, inner walls and floors in your layouts, to lay out on other ${esc(USE_NAME[floorUse(tg.B, tg.f)] || 'floor')}s or share with a player.</p>
    <label class="lib-field"><span>Name</span><input type="text" maxlength="40" value="${esc(def.slice(0, 40))}"></label>
    <div class="lib-btns"><button type="button" class="btn" data-a="cancel">Cancel</button><button type="button" class="btn primary" data-a="save">💾 Save</button></div>`);
  const input = el.querySelector('input');
  input.focus(); input.select();
  const go = async () => {
    try { const r = await post('/api/layouts/save', { b: tg.b, f: tg.f, name: input.value }); close(); toast(`Saved “${r.name}” to your layouts`); }
    catch (err) { if (!err.quiet) toast(err.message, 'bad', 3200); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  el.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'cancel') close(); else if (a === 'save') go(); });
}

/** The library, for the floor being furnished (tg: { B, b, f }; scope: { scope: 'all' } when every floor sharing its
 *  layout is laid out too). */
export async function openLibrary(tg, scope = {}) {
  const use = floorUse(tg.B, tg.f), build = mayOn(tg.B, 'build');
  const where = tg.B.type === 'park' ? tg.B.name : `${tg.B.name}, ${floorsName(tg.B, [tg.f])}`;
  const { el, close } = modal('libdlg', `<h3><span>📂 Saved layouts</span><button type="button" class="btn small" data-a="close" aria-label="Close">✕</button></h3>
    <p class="hint">For ${esc(where)} (${esc(USE_NAME[use] || use)}, ${ft(tg.B.w)} × ${ft(tg.B.d)} ft). Layouts made for the same kind of floor can be laid out here; they're fitted to its size.</p>
    <div class="lib-tabs chips"><button type="button" class="chip on" data-tab="mine">Mine</button><button type="button" class="chip" data-tab="shared">Shared with me</button></div>
    <div class="lib-list scroll"><p class="hint">Loading…</p></div>`);
  let data = { mine: [], shared: [] }, tab = 'mine';
  const list = el.querySelector('.lib-list');
  const row = (l, mine) => {
    const ok = l.use === use, why = ok ? '' : `Made for ${USE_NAME[l.use] || l.use}s`;
    return `<div class="lib-row" data-id="${l.id}">
      <div class="lib-main"><b>${esc(l.name)}</b><span class="dim">${esc(cap(USE_NAME[l.use] || l.use))} · ${ft(l.w)} × ${ft(l.d)} ft · ${l.pieces} piece${l.pieces === 1 ? '' : 's'} · ${when(l.updated)}${mine ? '' : ` · from ${esc(l.ownerName || 'a player')}`}</span></div>
      <div class="lib-acts">
        <button type="button" class="btn small primary" data-a="apply"${ok && build ? '' : ` disabled title="${esc(why || 'You can lay out floors on lots where you hold build rights')}"`}>Lay out here</button>
        ${mine ? `<button type="button" class="btn small" data-a="share">Share${l.shares.length ? ` (${l.shares.length})` : ''}</button><button type="button" class="btn small" data-a="rename">Rename</button><button type="button" class="btn small" data-a="del">Delete</button>`
    : '<button type="button" class="btn small" data-a="drop" title="Take it off your list (its owner keeps it)">Remove</button>'}
      </div>
      ${mine ? `<div class="lib-share hidden"><div class="lib-who">${l.shares.length ? l.shares.map(x => `<span class="chip">${esc(x.name)}<button type="button" data-a="unshare" data-acc="${x.id}" aria-label="Stop sharing with ${esc(x.name)}">✕</button></span>`).join('') : '<span class="dim">Not shared with anyone yet.</span>'}</div>
        <div class="lib-add"><input type="text" placeholder="Player's username" maxlength="40"><button type="button" class="btn small" data-a="share-add">Share</button></div></div>` : ''}
    </div>`;
  };
  const render = () => {
    for (const b of el.querySelectorAll('[data-tab]')) { b.classList.toggle('on', b.dataset.tab === tab); b.textContent = `${b.dataset.tab === 'mine' ? 'Mine' : 'Shared with me'} (${data[b.dataset.tab].length})`; }
    const items = data[tab];
    list.innerHTML = items.length ? items.map(l => row(l, tab === 'mine')).join('')
      : `<p class="hint">${tab === 'mine' ? 'No saved layouts yet. Use 💾 Save layout on a floor you like.' : 'Nothing shared with you yet.'}</p>`;
  };
  const load = async () => {
    try { data = await getJSON('/api/layouts'); render(); }
    catch (err) { list.innerHTML = `<p class="hint bad">${esc(err.message)}</p>`; }
  };
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const a = b.dataset.a, r = b.closest('.lib-row'), id = r ? +r.dataset.id : 0, l = r ? data[tab].find(x => x.id === id) : null;
    try {
      if (a === 'close') close();
      else if (a === 'apply') { if (await layOut(tg, l, scope)) close(); }
      else if (a === 'share') r.querySelector('.lib-share').classList.toggle('hidden');
      else if (a === 'share-add') {
        const input = r.querySelector('.lib-add input'), login = input.value.trim();
        if (!login) { input.focus(); return; }
        const res = await post('/api/layouts/share', { id, login });
        toast(`Shared “${l.name}” with ${res.name}`); await load();
        el.querySelector(`.lib-row[data-id="${id}"] .lib-share`)?.classList.remove('hidden');
      } else if (a === 'unshare') { await post('/api/layouts/unshare', { id, account: +b.dataset.acc }); await load(); el.querySelector(`.lib-row[data-id="${id}"] .lib-share`)?.classList.remove('hidden'); }
      else if (a === 'drop') { await post('/api/layouts/unshare', { id }); await load(); }
      else if (a === 'rename') {
        const main = r.querySelector('.lib-main b'), input = h(`<input type="text" maxlength="40" class="lib-rename" value="${esc(l.name)}">`);
        main.replaceWith(input); input.focus(); input.select();
        const done = async ok => { if (ok && input.value.trim() && input.value.trim() !== l.name) { try { await post('/api/layouts/rename', { id, name: input.value }); } catch (err) { toast(err.message, 'bad'); } } await load(); };
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(true); else if (ev.key === 'Escape') { ev.stopPropagation(); done(false); } });
        input.addEventListener('blur', () => done(true), { once: true });
      } else if (a === 'del') {
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete'; b.classList.remove('danger'); } }, 3000); return; }
        await post('/api/layouts/delete', { id }); toast(`Deleted “${l.name}”`); await load();
      }
    } catch (err) { if (!err.quiet) toast(err.message, 'bad', 3200); }
  });
  await load();
}

/** Lays saved layout l out on the floor: fitted here first, and asked when pieces won't fit or changes made by hand
 *  would be replaced. Resolves true when it went on. */
async function layOut(tg, l, scope) {
  const rec = await getJSON(`/api/layouts/${l.id}`), cur = levelOf(tg.b, tg.f);
  const fit = fitSaved(tg.B, tg.f, rec, cur);
  if (fit.why || !fit.keepOk) { toast(fit.why || `${fit.keepWhy}: “${l.name}” doesn't suit this floor`, 'bad', 3600); return false; }
  const n = fit.remove.length, custom = levelMode(cur) === 'custom', here = tg.B.type === 'park' ? 'this park' : floorsName(tg.B, [tg.f]);
  if (n || custom) {
    const go = await new Promise(resolve => {
      const { el, close } = modal('libdlg lib-confirm', `<h3>Lay out ${esc(here)} as “${esc(l.name)}”?</h3>
        ${n ? `<p>${tg.B.w < rec.w || tg.B.d < rec.d ? 'This floor is smaller than the one it was made for' : 'This floor is laid out differently'}: ${n} piece${n > 1 ? 's' : ''} ${n > 1 ? 'don’t' : 'doesn’t'} fit (${esc(piecesWords(fit.remove, 5))}).</p>` : ''}
        ${custom ? `<p class="hint">The changes made by hand on ${esc(here)} are replaced (undo brings them back).</p>` : ''}
        <div class="lib-btns"><button type="button" class="btn" data-a="no">Cancel</button><button type="button" class="btn primary" data-a="yes">${n ? `Lay out without ${n > 1 ? 'them' : 'it'}` : 'Lay out'}</button></div>`);
      el.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { close(); resolve(a === 'yes'); } });
      const obs = new MutationObserver(() => { if (!el.isConnected) { obs.disconnect(); resolve(false); } });
      obs.observe(document.body, { childList: true });
      el.querySelector('[data-a="yes"]').focus();
    });
    if (!go) return false;
  }
  try {
    const r = await post('/api/edit', { ops: [{ op: 'lvl.apply', b: tg.b, f: tg.f, layout: l.id, ...(n ? { fit: 'keep' } : {}), ...scope }], who: 'web' });
    if (r && r.ok === false) throw new Error(r.error || 'That did not work');
    toast(`${cap(here)} laid out as “${l.name}”${n ? ` without ${n} piece${n > 1 ? 's' : ''}` : ''} — undo with ↶`, 'good', 3600);
    return true;
  } catch (err) { if (!err.quiet) toast(err.message, 'bad', 3600); return false; }
}
