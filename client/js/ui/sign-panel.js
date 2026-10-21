// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A sign's panel (both editions; render/signs.js opens it when someone taps a sign that shows its own design rather
// than an ad): the design as it stands, its message and "Open link" (a new tab). The sign's owner can design it from
// here (ui/sign-design.js).
import { h, esc } from '../core/util.js';
import { AD_ASPECTS, aspectOf } from '/shared/ads.js';
import { hostOf } from '../render/ad-paint.js';
import { post } from '../core/net.js';
import { paintPreviews } from './designer.js';

const ASPECT = { asset: AD_ASPECTS.wide, roof: AD_ASPECTS.wide, metro: AD_ASPECTS.portrait };

/** o: { cr (the design, or null), title, mine (the viewer owns it), kind ('asset' | 'metro' | 'roof' | 'indoor'), shape, edit() }. */
export function openSignPanel(app, o) {
  const el = document.body.appendChild(h('<div class="modal-back lib-back shop-back"><div class="panel libdlg shopdlg addlg" role="dialog" aria-modal="true" aria-label="Sign"></div></div>'));
  const box = el.querySelector('.addlg'), cr = o.cr, host = hostOf(cr?.website), asp = o.shape ? aspectOf(o.shape) : ASPECT[o.kind] || AD_ASPECTS.landscape;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  box.innerHTML = `<h3><span>🪧 ${esc(cr?.title || o.title || 'Sign')}</span><button type="button" class="btn small" data-c="close" aria-label="Close">✕</button></h3>
    ${cr ? `<canvas class="ad-big${asp < 1 ? ' tall' : ''}" data-ad="0" data-aspect="${asp}"${asp < 1 ? ` style="width:min(300px, 70%, ${Math.round(440 * asp)}px)"` : ''}></canvas>` : `<p class="hint">${o.mine ? 'Nothing on it yet: design it.' : 'Nothing on this sign yet.'}</p>`}
    ${cr?.message ? `<p class="ad-msg">${esc(cr.message)}</p>` : ''}
    ${cr?.website ? `<button type="button" class="btn primary ad-visit" data-a="visit">🌐 Open link · ${esc(host)} ↗</button>` : ''}
    <p class="hint">${esc(o.title || '')}</p>
    ${o.hide ? `<div class="shop-note">${o.hide.blocked ? `<span>Hidden by an administrator: ${esc(o.hide.blocked)}</span><div class="row"><button type="button" class="btn small" data-a="unhide">Show it again</button></div>` : '<span>Administrators: a sign that breaks the rules can be hidden (its owner reads the reason).</span><div class="row wrap"><input class="input sp-why" maxlength="200" placeholder="Why it is hidden"><button type="button" class="btn small danger" data-a="hide">Hide it</button></div>'}</div>` : ''}
    <div class="lib-btns"><button type="button" class="btn" data-c="close">Close</button>${o.mine && o.edit ? '<button type="button" class="btn" data-a="edit">✏️ Design this sign</button>' : ''}</div>`;
  if (cr) paintPreviews(box, [cr]);
  el.addEventListener('click', e => {
    if (e.target === el || e.target.closest('[data-c="close"]')) { close(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'visit') window.open(cr.website, '_blank', 'noopener,noreferrer');
    if (a === 'edit') { close(); o.edit(); }
    if (a === 'hide' || a === 'unhide') {
      const why = a === 'hide' ? box.querySelector('.sp-why').value.trim() : '';
      if (a === 'hide' && !why) { app.toast('Say why it is hidden; its owner reads it.', 'bad', 3000); return; }
      post('/api/edit', { ops: [{ ...o.hide.op, blocked: why }] }).then(r => { if (r?.ok === false) throw new Error(r.error); app.toast(why ? 'Hidden.' : 'Shown again.', 'good', 2200); close(); }).catch(x => app.toast(x.message, 'bad', 3000));
    }
  });
}
