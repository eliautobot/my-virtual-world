// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Small pieces the PC's apps share (client/js/ui/pc-app.js and its apps): sizes and times as people read them, a menu.
import { esc } from '../core/util.js';

/** A size people read: 12 KB, 3.4 MB. */
export const size = b => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
/** A time people read: 14:05 today, "Yesterday 9:10", "Oct 12". */
export function when(t) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  if (new Date(now - 86400000).toDateString() === d.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
/** A small menu at the pointer: items [{ label, icon, run, danger }] or '-' for a line. */
export function popMenu(at, items) {
  document.querySelector('.pc-pop')?.remove();
  const m = document.createElement('div');
  m.className = 'pc-pop';
  m.innerHTML = items.map((it, k) => (it === '-' ? '<hr>' : `<button data-k="${k}" class="${it.danger ? 'bad' : ''}${it.on ? ' on' : ''}"><span aria-hidden="true">${it.icon || ''}</span>${esc(it.label)}</button>`)).join('');
  document.body.append(m);
  const r = at.getBoundingClientRect ? at.getBoundingClientRect() : { left: at.x, bottom: at.y, top: at.y };
  const w = m.offsetWidth, hgt = m.offsetHeight;
  m.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, r.left))}px`;
  m.style.top = `${r.bottom + hgt + 6 > innerHeight ? Math.max(6, r.top - hgt - 4) : r.bottom + 4}px`;
  const close = () => { m.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); };
  const away = e => { if (!m.contains(e.target)) close(); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  m.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; close(); items[Number(b.dataset.k)].run(); });
  setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true); });
  return m;
}

