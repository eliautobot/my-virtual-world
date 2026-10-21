// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Menus with pictures (shared/food.js; the pictures: assets/food/thumbs.webp, tools/food/thumbs.mjs): a café's or
// restaurant's menu grouped by course for ordering, and its owner's menu editor — the kind of place (a burger joint, a
// seafood restaurant, a café …: each starts with its usual menu) and any item of the whole pack added or removed, with
// prices. ui/economy.js opens these.
import { h, esc } from '../core/util.js';
import { FOOD, FOOD_BY_ID, FOOD_CATS, CAT_OF, CUISINES, CUISINE_OF, COURSES, COURSE_ORDER, MENU_MAX } from '/shared/food.js';

const SHEET = '/assets/food/thumbs.webp', COLS = 16;
/** An item's picture, px square (cell n of the sheet). */
export function thumb(n, px = 44) {
  const x = (n % COLS) * px, y = Math.floor(n / COLS) * px;
  return `<i class="fd-th" aria-hidden="true" style="width:${px}px;height:${px}px;background-size:${COLS * px}px ${COLS * px}px;background-position:-${x}px -${y}px"></i>`;
}
/** Menu lines ({ id, n, label, course, … }) grouped by course, in the courses' order. */
export function byCourse(lines) {
  const groups = new Map(COURSE_ORDER.map(c => [c, []]));
  for (const m of lines) (groups.get(FOOD_BY_ID[m.id]?.course || m.course) || groups.get('main')).push(m);
  return [...groups].filter(([, l]) => l.length).map(([c, l]) => ({ course: c, label: COURSES[c].label, lines: l }));
}
/** The kind of place a business is: its cuisine's label and icon. */
export const cuisineLabel = id => { const c = CUISINE_OF[id]; return c ? `${c.icon} ${c.label}` : ''; };

/**
 * The owner's menu editor. B: the business as its owner sees it (economy view with settings, foodPricing); vc(cents)
 * formats money; save(body) posts the change (/api/economy/business/configure) and returns the business; done() after.
 */
export function openMenuEditor(B, { vc, save, done, toast }) {
  const fp = B.foodPricing || { pct: 100, prices: {} };
  const usual = id => { const it = FOOD_BY_ID[id]; const own = fp.prices?.[id]; return Number.isSafeInteger(own) ? own : Math.max(1, Math.round(it.price * fp.pct / 100 / 5) * 5); };
  const st = {
    cuisine: B.cuisine, menu: B.menu.map(m => m.id), price: Object.fromEntries(B.menu.map(m => [m.id, m.price])),
    cat: '', q: '', picking: false, dirty: false, note: '',
  };
  const el = document.body.appendChild(h('<div class="modal-back lib-back ec-back"><div class="panel libdlg ecdlg fm-dlg" role="dialog" aria-modal="true" aria-label="Menu"></div></div>'));
  const box = el.querySelector('.fm-dlg');
  const close = () => { el.remove(); };
  const cuisineCard = (c, on) => `<button type="button" class="fm-cu${on ? ' on' : ''}" data-cu="${c.id}" aria-pressed="${on}"><b>${esc(c.icon)} ${esc(c.label)}</b><small>${esc(c.desc)}</small></button>`;
  const lineRow = id => {
    const it = FOOD_BY_ID[id], u = usual(id), p = st.price[id] ?? u;
    return `<div class="fm-line">${thumb(it.n, 44)}<div class="fm-name"><b>${esc(it.name)}</b><small>${esc(CAT_OF[it.cat].label)}${p !== u ? ` · usual ${vc(u)}` : ''}</small></div>
      <input class="input fm-price" data-id="${id}" inputmode="decimal" value="${(p / 100).toFixed(2)}" aria-label="Price of ${esc(it.name)} (VC)"><button type="button" class="btn small fm-x" data-rm="${id}" aria-label="Take ${esc(it.name)} off the menu">✕</button></div>`;
  };
  const picker = () => {
    const q = st.q.trim().toLowerCase(), on = new Set(st.menu);
    const list = FOOD.filter(it => (!st.cat || it.cat === st.cat) && (!q || it.name.toLowerCase().includes(q) || CAT_OF[it.cat].label.toLowerCase().includes(q)));
    return `<div class="fm-cats"><button type="button" class="chip${st.cat ? '' : ' on'}" data-cat="">All</button>${FOOD_CATS.map(c => `<button type="button" class="chip${st.cat === c.id ? ' on' : ''}" data-cat="${c.id}">${esc(c.icon)} ${esc(c.label)}</button>`).join('')}</div>
      <div class="fm-grid">${list.map(it => `<button type="button" class="fm-tile${on.has(it.id) ? ' on' : ''}" data-add="${it.id}" aria-pressed="${on.has(it.id)}" title="${esc(it.name)}">${thumb(it.n, 64)}<span>${esc(it.name)}</span><small>${on.has(it.id) ? '✓ on the menu' : vc(usual(it.id))}</small></button>`).join('') || '<p class="hint">Nothing matches.</p>'}</div>`;
  };
  const render = () => {
    const c = CUISINE_OF[st.cuisine], keepScroll = box.querySelector('.fm-body')?.scrollTop || 0;
    box.innerHTML = `<h3><span>🍽️ ${esc(B.name)}'s menu</span><button type="button" class="btn small" data-b="close" aria-label="Close">✕</button></h3>
      <div class="fm-body">
        <div class="tier-head">Kind of place</div>
        <div class="fm-kind">${cuisineCard(c, true)}<button type="button" class="btn small" data-b="kinds">${st.picking ? 'Keep this kind' : 'Change the kind of place'}</button></div>
        ${st.picking ? `<p class="hint">A new kind brings its usual menu; you can still add or take off anything after.</p><div class="fm-cus">${CUISINES.filter(x => x.id !== st.cuisine).map(x => cuisineCard(x, false)).join('')}</div>` : ''}
        ${st.note ? `<p class="hint good">${esc(st.note)}</p>` : ''}
        <div class="tier-head">On the menu <span class="dim">${st.menu.length} of ${MENU_MAX}</span></div>
        ${byCourse(st.menu.map(id => ({ id }))).map(g => `<div class="fm-course">${esc(g.label)}</div>${g.lines.map(m => lineRow(m.id)).join('')}`).join('')}
        <div class="tier-head">Add from the food &amp; drink pack</div>
        <input class="input fm-q" type="search" placeholder="Search: pizza, latte, sushi…" value="${esc(st.q)}" aria-label="Search the pack">
        <div class="fm-pick">${picker()}</div>
      </div>
      <div class="lib-btns"><button type="button" class="btn" data-b="usual">Back to the usual ${esc(c.label.toLowerCase())} menu</button><span class="fm-sp"></span><button type="button" class="btn" data-b="close">Cancel</button><button type="button" class="btn primary" data-b="save"${st.dirty ? '' : ' disabled'}>Save the menu</button></div>
      <p class="hint bad fm-err" role="alert"></p>`;
    const body = box.querySelector('.fm-body'); body.scrollTop = keepScroll;
  };
  const changed = () => { st.dirty = true; };
  const repick = () => { const p = box.querySelector('.fm-pick'); if (p) p.innerHTML = picker(); };
  el.addEventListener('click', async e => {
    if (e.target === el) return close();
    const t = e.target.closest('[data-b],[data-cu],[data-rm],[data-add],[data-cat]'); if (!t) return;
    const err = box.querySelector('.fm-err');
    if (t.dataset.b === 'close') return close();
    if (t.dataset.b === 'kinds') { st.picking = !st.picking; st.note = ''; return render(); }
    if (t.dataset.cu !== undefined) {
      if (t.dataset.cu === st.cuisine) { st.picking = !st.picking; return render(); }
      const c = CUISINE_OF[t.dataset.cu];
      st.cuisine = c.id; st.menu = [...c.menu]; st.price = {}; st.picking = false; st.note = `Now a ${c.label.toLowerCase()}, with its usual menu. Add or take off anything, then save.`;
      changed(); return render();
    }
    if (t.dataset.b === 'usual') { st.menu = [...CUISINE_OF[st.cuisine].menu]; st.price = {}; st.note = 'The usual menu again (save to keep it).'; changed(); return render(); }
    if (t.dataset.rm) {
      if (st.menu.length <= 1) { err.textContent = 'A menu needs at least one item.'; return; }
      st.menu = st.menu.filter(id => id !== t.dataset.rm); delete st.price[t.dataset.rm]; changed(); return render();
    }
    if (t.dataset.add) {
      const id = t.dataset.add;
      if (st.menu.includes(id)) { if (st.menu.length > 1) { st.menu = st.menu.filter(x => x !== id); delete st.price[id]; } }
      else if (st.menu.length >= MENU_MAX) { err.textContent = `A menu has at most ${MENU_MAX} items: take one off first.`; return; }
      else { st.menu.push(id); toast?.(`${FOOD_BY_ID[id].name} added to the menu`, 'good', 1600); }
      changed(); return render();
    }
    if (t.dataset.cat !== undefined) { st.cat = t.dataset.cat; return repick(); }
    if (t.dataset.b === 'save') {
      const prices = {};
      for (const id of st.menu) { const p = st.price[id]; if (Number.isSafeInteger(p) && p !== (B.menu.find(m => m.id === id)?.price ?? usual(id))) prices[id] = p; }
      const body = { id: B.id, menu: st.menu, prices };
      if (st.cuisine !== B.cuisine) body.cuisine = st.cuisine;
      t.disabled = true;
      try { await save(body); toast?.('Menu saved.', 'good', 2200); close(); done?.(); }
      catch (x) { err.textContent = x.message; t.disabled = false; }
    }
  });
  el.addEventListener('input', e => {
    if (e.target.matches('.fm-q')) { st.q = e.target.value; repick(); return; }
    if (e.target.matches('.fm-price')) {
      const v = Math.round(parseFloat(String(e.target.value).replace(',', '.')) * 100);
      if (Number.isSafeInteger(v) && v > 0) { st.price[e.target.dataset.id] = v; changed(); const s = box.querySelector('[data-b="save"]'); if (s) s.disabled = false; }
    }
  });
  render();
}
