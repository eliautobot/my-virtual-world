// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Floor Themes and floor names in the browser (shared/floor-themes.js; server/world/edit.js lvl.theme, lvl.name), from the
// Furnish panel's floor bar: 🎨 Floor Themes lists the kinds of place a floor can be (an arcade first); picking one lays
// the floor out as it, fitted to its size and its elevator (one edit, one undo; the floor keeps the theme, so 🎲
// Regenerate rolls it again). ✏️ Name gives the floor its own name, shown on the floor buttons, the building's tip and
// the floor control. The café has five styles: its pull-down chooses which (shared/floor-themes.js CAFE_STYLES).
import { h, esc } from '../core/util.js';
import { levelOf } from '../core/state.js';
import { floorsName } from '/shared/edit.js';
import { FLOOR_THEMES, themeOf, themeWhy, MAX_FLOOR_NAME, CAFE_STYLES, CAFE_STYLE_IDS } from '/shared/floor-themes.js';

let app = null, edit = null;
/** a: the app; ed: the editor's edit(ops) (one change, one undo; null when refused, after it has said why). */
export function initFloorThemes(a, ed) { app = a; edit = ed; }

function modal(cls, html) {
  const el = document.body.appendChild(h(`<div class="modal-back lib-back"><div class="panel libdlg ${cls}" role="dialog" aria-modal="true">${html}</div></div>`));
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', e => { if (e.target === el) close(); });
  return { el, close };
}
const where = tg => (tg.B.floors > 1 ? floorsName(tg.B, [tg.f]) : 'this floor');

/** The themes for the floor being furnished (tg: { B, b, f }; scope: { scope: 'all' } when every floor sharing its
 *  layout changes with it, n: how many). */
export function openThemes(tg, scope = {}, n = 1) {
  const L = levelOf(tg.b, tg.f), cur = themeOf(L?.theme), why = themeWhy(tg.B, tg.f, L);
  const card = t => `<button type="button" class="ft-card${cur?.id === t.id ? ' on' : ''}" data-theme="${t.id}"${why ? ' disabled' : ''}>
      <span class="ft-ic" aria-hidden="true">${t.icon}</span><b>${esc(t.name)}</b><small>${esc(t.blurb)}</small>${t.venue && t.venue !== 'lounge' ? '<i class="ft-tag">a business</i>' : t.venue === 'lounge' ? '<i class="ft-tag">people hang out</i>' : ''}</button>`;
  const { el, close } = modal('ftdlg', `<h3><span>🎨 Floor Themes</span><button type="button" class="btn small" data-a="close" aria-label="Close">✕</button></h3>
    <p class="hint">${why ? esc(why) + '.' : `Lay ${esc(where(tg))} of ${esc(tg.B.name)} out as a kind of place, fitted to its size. ${n > 1 ? `All ${n} floors with this layout change together. ` : ''}Furnish it further by hand, keep it with 💾 Save layout, or ↶ undo.`}${cur ? ` It is ${/^[aeiou]/i.test(cur.name) ? 'an' : 'a'} <b>${esc(cur.name)}</b> now: 🎲 Regenerate in the floor bar rolls it again.` : ''}</p>
    <div class="ft-grid">${FLOOR_THEMES.map(t => (t.id !== 'cafe' ? card(t) : `<div class="ft-wrap">${card(t)}
      <label class="ft-style-l"><span>Style</span><select class="ft-style"${why ? ' disabled' : ''}>${CAFE_STYLE_IDS.map(id => `<option value="${id}"${(cur?.id === 'cafe' ? L?.style : 'bistro') === id ? ' selected' : ''}>${esc(CAFE_STYLES[id].name)}: ${esc(CAFE_STYLES[id].blurb)}</option>`).join('')}</select></label></div>`)).join('')}</div>`);
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-a="close"]')) return close();
    const c = e.target.closest('[data-theme]'); if (!c || c.disabled) return;
    const t = themeOf(c.dataset.theme);
    // replacing the floor: a second tap says so (what was furnished goes; undo brings it back)
    if (!c.dataset.armed) {
      for (const o of el.querySelectorAll('[data-armed]')) { delete o.dataset.armed; o.classList.remove('armed'); o.querySelector('em')?.remove(); }
      c.dataset.armed = '1'; c.classList.add('armed'); c.insertAdjacentHTML('beforeend', `<em>Tap again: replace ${esc(where(tg))} with ${/^[aeiou]/i.test(t.name) ? 'an' : 'a'} ${esc(t.name)}</em>`);
      return;
    }
    for (const b of el.querySelectorAll('button')) b.disabled = true;
    const style = t.id === 'cafe' ? el.querySelector('.ft-style')?.value : undefined;   // (the café's style, from its pull-down)
    const r = await edit([{ op: 'lvl.theme', b: tg.b, f: tg.f, theme: t.id, ...(style ? { style } : {}), ...scope }]);
    close();
    if (r) app.toast(`${t.icon} ${where(tg).replace(/^./, x => x.toUpperCase())} is ${/^[aeiou]/i.test(t.name) ? 'an' : 'a'} ${t.name} now · undo with ↶`, 'good', 3600);
  });
}

/** The floor's own name (empty: none). */
export function nameFloor(tg, scope = {}) {
  const L = levelOf(tg.b, tg.f), now = String(L?.name || '');
  const { el, close } = modal('lib-save', `<h3>✏️ Name ${esc(where(tg))}</h3>
    <p class="hint">Its name shows on ${esc(tg.B.name)}'s floor buttons, when the pointer is over the floor, and on the floor control inside.</p>
    <label class="lib-field"><span>Name</span><input type="text" maxlength="${MAX_FLOOR_NAME}" value="${esc(now)}" placeholder="Arcade, Sky Lounge, Studio 5…"></label>
    <div class="lib-btns">${L?.named ? '<button type="button" class="btn" data-a="clear">Take the name off</button>' : ''}<button type="button" class="btn" data-a="cancel">Cancel</button><button type="button" class="btn primary" data-a="save">Save</button></div>`);
  const input = el.querySelector('input');
  input.focus(); input.select();
  const go = async name => {
    for (const b of el.querySelectorAll('button')) b.disabled = true;
    const r = await edit([{ op: 'lvl.name', b: tg.b, f: tg.f, name, ...scope }]);
    close();
    if (r) app.toast(name ? `Named ${where(tg)} “${name.trim()}”` : `Took the name off ${where(tg)}`, 'good', 2400);
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(input.value); });
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') close(); else if (a === 'save') go(input.value); else if (a === 'clear') go('');
  });
}
